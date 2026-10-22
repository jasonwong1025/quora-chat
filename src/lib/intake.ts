/**
 * Requirement gathering rules, shared by the server (to decide what to ask
 * next) and the staff UI (to show the brief and its progress).
 * Plain code, no AI: the AI only reads answers and words the questions.
 */
import type {
	Answer,
	Brief,
	BriefItem,
	FollowUp,
	intakeQuestions,
	Language,
} from "#/db/schema";

export type Question = typeof intakeQuestions.$inferSelect;

/** The product fields the intake rules need. */
export type IntakeProduct = {
	id: string;
	name: string;
	category: string;
	unit: string;
	pricingMode: "fixed" | "custom";
	/** Switched off in Products: we tell the customer and don't ask about it. */
	active?: boolean;
};

export function emptyBrief(language: Language = "en"): Brief {
	return {
		language,
		summary: "",
		items: [],
		general: {},
		followUps: [],
		reasoning: [],
		asked: [],
	};
}

const byPosition = (a: Question, b: Question) =>
	a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime();

/** Questions one item sees: its own first, then its category's (own wins on the same key). */
export function questionsFor(
	product: Pick<IntakeProduct, "id" | "category">,
	questions: Question[],
) {
	const own = questions
		.filter((q) => q.scope === "product" && q.productId === product.id)
		.sort(byPosition);
	const ownKeys = new Set(own.map((q) => q.key));
	const shared = questions
		.filter(
			(q) =>
				q.scope === "category" &&
				q.category === product.category &&
				!ownKeys.has(q.key),
		)
		.sort(byPosition);
	return [...own, ...shared];
}

export function businessQuestions(questions: Question[]) {
	return questions.filter((q) => q.scope === "business").sort(byPosition);
}

const same = (a: string, b: string) =>
	a.trim().toLowerCase() === b.trim().toLowerCase();

/** A question with `showIf` is only asked when that other answer matches. */
export function isVisible(q: Question, answers: Record<string, Answer>) {
	if (!q.showIf) return true;
	const a = answers[q.showIf.key];
	const target = q.showIf.equals;
	return Boolean(
		a && a.source !== "skipped" && a.values.some((v) => same(v, target)),
	);
}

const uncertain =
	/^(?:\(?no clear answer\)?|not sure|unsure|unknown|don'?t know|i don'?t know|tbd|to be confirmed|tak pasti|tidak pasti|tak tahu|tidak tahu|不知道|不确定|不確定|待定)[.!。！]?$/i;

export function answerIssue(
	a: Answer | undefined,
	q?: Pick<Question, "type" | "options">,
): string | null {
	if (!a) return "Not answered";
	if (a.source === "skipped")
		return a.waiverReason?.trim() ? null : "Waiver needs a reason";
	if (a.state === "conflicting")
		return "Conflicting details need clarification";
	if (a.state === "ambiguous") return "Answer needs clarification";
	const values = a.values.map((v) => v.trim()).filter(Boolean);
	if (!values.length || values.some((v) => uncertain.test(v)))
		return "Answer is still uncertain";
	if (
		q?.type === "number" &&
		values.some((v) => !/\d/u.test(v) || /(?:^|\s)-\d/u.test(v))
	)
		return "A number or numeric range is needed";
	if (q && ["single", "multi", "yes_no"].includes(q.type)) {
		const options = q.type === "yes_no" ? ["yes", "no"] : q.options;
		if (
			(q.type !== "multi" && values.length !== 1) ||
			values.some((v) => !options.some((o) => same(o, v)))
		)
			return "Choose from the available options";
	}
	if (q?.type === "file" && !a.fileMessageId)
		return "Attach a file or explicitly waive this requirement";
	return null;
}

export function isAnswered(
	a: Answer | undefined,
	q?: Pick<Question, "type" | "options">,
) {
	return answerIssue(a, q) === null;
}

export function followUpResolved(f: FollowUp) {
	return Boolean(
		(f.waivedBy && f.waiverReason?.trim()) ||
			(f.answer?.trim() && !uncertain.test(f.answer.trim())),
	);
}

export function answerText(a: Answer | undefined) {
	if (!a) return "";
	if (a.source === "skipped")
		return `(waived: ${a.waiverReason ?? "no reason recorded"})`;
	return a.values.join(", ");
}

/** Something still to find out. `id` is stable, so we can remember what was asked. */
export type Missing =
	| { id: string; kind: "need"; required: true }
	| {
			id: string;
			kind: "identify";
			required: true;
			item: BriefItem;
			candidates: IntakeProduct[];
	  }
	| {
			id: string;
			kind: "quantity";
			required: true;
			item: BriefItem;
			product: IntakeProduct;
	  }
	| {
			id: string;
			kind: "question";
			required: boolean;
			item: BriefItem | null; // null = business-wide question
			product: IntakeProduct | null;
			question: Question;
	  }
	| { id: string; kind: "follow_up"; required: true; followUp: FollowUp };

export const missingId = {
	need: () => "need",
	identify: (itemId: string) => `${itemId}:product`,
	quantity: (itemId: string) => `${itemId}:quantity`,
	question: (itemId: string | null, key: string) =>
		`${itemId ?? "general"}:${key}`,
	followUp: (id: string) => `followup:${id}`,
};

export type ItemView = {
	item: BriefItem;
	product: IntakeProduct | null;
	candidates: IntakeProduct[];
	questions: Question[]; // visible ones, in order
};

export type Assessment = {
	items: ItemView[];
	general: Question[]; // visible business-wide questions
	/** Everything not yet known, in the order it should be asked. */
	missing: Missing[];
	/** Required things only: what blocks drafting. */
	blocking: Missing[];
	requiredTotal: number;
	requiredAnswered: number;
};

/**
 * What is known and what is still missing. Required gaps block drafting.
 * Optional questions count as missing only until they have been asked once.
 */
export function assess(
	brief: Brief,
	products: IntakeProduct[],
	questions: Question[],
): Assessment {
	const byId = new Map(products.map((p) => [p.id, p]));
	const asked = new Set(brief.asked);
	const missing: Missing[] = [];
	const items: ItemView[] = [];
	let requiredTotal = 0;
	let requiredAnswered = 0;

	if (brief.items.length === 0) {
		missing.push({ id: missingId.need(), kind: "need", required: true });
	}

	for (const item of brief.items) {
		const product = item.productId ? byId.get(item.productId) : undefined;
		const candidates = item.candidateProductIds
			.map((id) => byId.get(id))
			.filter((p): p is IntakeProduct => Boolean(p));

		if (item.match === "ambiguous" || (item.match === "exact" && !product)) {
			requiredTotal++;
			missing.push({
				id: missingId.identify(item.id),
				kind: "identify",
				required: true,
				item,
				candidates,
			});
			items.push({ item, product: null, candidates, questions: [] });
			continue;
		}
		if (!product) {
			// Not in the catalog: staff decide; it does not block the others.
			items.push({ item, product: null, candidates, questions: [] });
			continue;
		}
		if (product.active === false) {
			// Not available right now: nothing to ask, staff follow up.
			items.push({ item, product, candidates, questions: [] });
			continue;
		}

		if (product.pricingMode === "fixed") {
			requiredTotal++;
			if (item.quantity !== null && item.quantity > 0) requiredAnswered++;
			else
				missing.push({
					id: missingId.quantity(item.id),
					kind: "quantity",
					required: true,
					item,
					product,
				});
		}

		const visible = questionsFor(product, questions).filter((q) =>
			isVisible(q, item.answers),
		);
		for (const q of visible) {
			const done = isAnswered(item.answers[q.key], q);
			if (q.required) {
				requiredTotal++;
				if (done) requiredAnswered++;
			}
			const id = missingId.question(item.id, q.key);
			if (!done && (q.required || !asked.has(id))) {
				missing.push({
					id,
					kind: "question",
					required: q.required,
					item,
					product,
					question: q,
				});
			}
		}
		items.push({ item, product, candidates, questions: visible });
	}

	for (const f of brief.followUps) {
		if (followUpResolved(f)) continue;
		missing.push({
			id: missingId.followUp(f.id),
			kind: "follow_up",
			required: true,
			followUp: f,
		});
	}

	const general = businessQuestions(questions).filter((q) =>
		isVisible(q, brief.general),
	);
	// Business-wide questions only once we know what they want.
	if (brief.items.length > 0) {
		for (const q of general) {
			const done = isAnswered(brief.general[q.key], q);
			if (q.required) {
				requiredTotal++;
				if (done) requiredAnswered++;
			}
			const id = missingId.question(null, q.key);
			if (!done && (q.required || !asked.has(id))) {
				missing.push({
					id,
					kind: "question",
					required: q.required,
					item: null,
					product: null,
					question: q,
				});
			}
		}
	}

	// Required things first; optional ones only once everything required is in.
	const ordered = [
		...missing.filter((m) => m.required),
		...missing.filter((m) => !m.required),
	];
	return {
		items,
		general,
		missing: ordered,
		blocking: ordered.filter((m) => m.required),
		requiredTotal,
		requiredAnswered,
	};
}

/** The next one or two things to ask, keeping questions about the same item together. */
export function nextToAsk(missing: Missing[], max = 2): Missing[] {
	const first = missing[0];
	if (!first) return [];
	if (first.kind === "need" || first.kind === "identify") return [first];
	const group = (m: Missing) =>
		m.kind === "question" || m.kind === "quantity"
			? (m.item?.id ?? "general")
			: m.kind;
	// Two questions with long option lists in one message is too much.
	const heavy = (m: Missing) =>
		m.kind === "question" &&
		(m.question.type === "file" || m.question.options.length > 4);
	const picked: Missing[] = [first];
	for (const m of missing.slice(1)) {
		if (picked.length >= max) break;
		if (group(m) !== group(first) || heavy(m) || heavy(first)) break;
		picked.push(m);
	}
	return picked;
}
