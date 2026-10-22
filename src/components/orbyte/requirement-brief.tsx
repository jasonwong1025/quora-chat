import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	Bot,
	Check,
	CircleDashed,
	FilePlus2,
	FileText,
	Loader2,
	MessageCircleQuestion,
	Pencil,
	Plus,
	RotateCcw,
	SendHorizontal,
	SkipForward,
	Sparkles,
	UserRound,
	X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import type { Answer, FollowUp } from "#/db/schema";
import { quoteAgreementIssue } from "#/lib/agreements";
import {
	answerIssue,
	answerText,
	assess,
	followUpResolved,
	type ItemView,
	isAnswered,
	type Question,
} from "#/lib/intake";
import { clock } from "#/lib/time";
import type { RequestRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

type Edit = Parameters<
	ReturnType<typeof useBriefActions>["edit"]["mutateAsync"]
>[0]["edit"];

function useBriefActions() {
	const queryClient = useQueryClient();
	const onSuccess = () =>
		queryClient.invalidateQueries({ queryKey: orpc.key() });
	return {
		edit: useMutation(orpc.requests.editBrief.mutationOptions({ onSuccess })),
		ask: useMutation(orpc.requests.askNow.mutationOptions({ onSuccess })),
		draft: useMutation(orpc.requests.draftNow.mutationOptions({ onSuccess })),
	};
}

const OPEN = ["gathering", "confirming", "needs_review", "draft_ready"];

/** What the AI has gathered for a request, what's still missing, and staff controls. */
export function RequirementBrief({ request }: { request: RequestRow }) {
	const { business, me } = useWorkspace();
	const actions = useBriefActions();
	const brief = request.brief;
	const a = assess(brief, business.products, business.questions);
	const open = OPEN.includes(request.status);
	const drafted = Boolean(
		request.quote?.status === "draft" &&
			!quoteAgreementIssue(request.quote, request),
	);
	const pct = a.requiredTotal
		? Math.round((a.requiredAnswered / a.requiredTotal) * 100)
		: 0;

	async function run(
		fn: () => Promise<unknown>,
		success?: string,
	): Promise<boolean> {
		if (!me) {
			toast.error("Choose who you are signed in as first");
			return false;
		}
		try {
			await fn();
			if (success) toast.success(success);
			return true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Failed");
			return false;
		}
	}
	const edit = (e: Edit, success?: string) =>
		run(
			() =>
				actions.edit.mutateAsync({
					requestId: request.id,
					staffId: me?.id ?? "",
					edit: e,
					expectedVersion: request.briefVersion,
				}),
			success,
		);

	const next = a.missing[0];
	const stageText =
		request.status === "gathering"
			? next
				? `AI is asking the customer. Next: ${describeNext(next)}`
				: "AI is gathering details."
			: request.status === "confirming"
				? "All details in. Waiting for the customer to confirm the summary."
				: drafted
					? "The draft captures the requirements below. Review it before sending."
					: open
						? "Review the requirements and prepare a current draft."
						: request.status === "approved"
							? "Quotation sent."
							: "Closed.";

	return (
		<section className="space-y-3">
			<div className="flex items-center justify-between gap-2">
				<h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					Requirement brief · version {request.briefVersion}
				</h3>
				{a.requiredTotal > 0 && (
					<span className="text-xs text-muted-foreground tabular-nums">
						{a.requiredAnswered}/{a.requiredTotal} required
					</span>
				)}
			</div>
			{a.requiredTotal > 0 && (
				<div className="h-1.5 overflow-hidden rounded-full bg-muted">
					<div
						className="h-full rounded-full bg-[var(--orb-royal)] transition-all"
						style={{ width: `${pct}%` }}
					/>
				</div>
			)}
			{brief.revisionOf && (
				<p className="flex items-center gap-2 rounded-md bg-status-draft/10 px-3 py-2 text-xs">
					<RotateCcw className="size-3.5 text-status-draft" /> The customer is
					changing a quotation that was already sent. Confirming creates a new
					revision.
				</p>
			)}
			<p className="text-sm">
				{brief.summary || "Waiting for the first details."}
			</p>
			<p className="flex items-start gap-1.5 text-xs text-muted-foreground">
				<Bot className="mt-px size-3.5 shrink-0" /> {stageText}
			</p>

			{a.items.map((view) => (
				<ItemCard
					key={view.item.id}
					view={view}
					open={open}
					onEdit={edit}
					busy={actions.edit.isPending}
				/>
			))}

			{a.general.length > 0 && brief.items.length > 0 && (
				<div className="rounded-lg border">
					<p className="border-b px-3 py-2 text-sm font-medium">
						About the customer
					</p>
					<ul className="divide-y">
						{a.general.map((q) => (
							<AnswerRow
								key={q.id}
								question={q}
								answer={brief.general[q.key]}
								open={open}
								onSave={(values) =>
									edit({ kind: "answer", itemId: null, key: q.key, values })
								}
								onSkip={(reason) =>
									edit({ kind: "skip", itemId: null, key: q.key, reason })
								}
								onClear={() =>
									edit({ kind: "clear", itemId: null, key: q.key })
								}
							/>
						))}
					</ul>
				</div>
			)}

			{brief.followUps.length > 0 && (
				<div className="rounded-lg border">
					<p className="border-b px-3 py-2 text-sm font-medium">Follow-ups</p>
					<ul className="divide-y">
						{brief.followUps.map((f) => (
							<FollowUpRow
								key={f.id}
								followUp={f}
								open={open}
								onAnswer={(answer) =>
									edit({ kind: "answer_follow_up", id: f.id, answer })
								}
								onRemove={(reason) =>
									edit({ kind: "remove_follow_up", id: f.id, reason })
								}
							/>
						))}
					</ul>
				</div>
			)}

			{open && (
				<StaffControls
					busy={actions.ask.isPending || actions.draft.isPending}
					canDraft={Boolean(me?.canApprove && !a.blocking.length)}
					asking={actions.ask.isPending}
					drafting={actions.draft.isPending}
					drafted={drafted}
					onAdd={(question) =>
						edit(
							{ kind: "add_follow_up", question },
							"Added. The AI will ask it next.",
						)
					}
					onAsk={() =>
						run(
							() =>
								actions.ask.mutateAsync({
									requestId: request.id,
									staffId: me?.id ?? "",
								}),
							"Sent the next question to the customer",
						)
					}
					onDraft={() =>
						run(
							() =>
								actions.draft.mutateAsync({
									requestId: request.id,
									staffId: me?.id ?? "",
								}),
							"Draft created from what we know so far",
						)
					}
				/>
			)}
		</section>
	);
}

function describeNext(m: ReturnType<typeof assess>["missing"][number]) {
	switch (m.kind) {
		case "need":
			return "what they need";
		case "identify":
			return `which product "${m.item.rawText}" is`;
		case "quantity":
			return `quantity of ${m.product.name}`;
		case "question":
			return m.question.label;
		case "follow_up":
			return m.followUp.question;
	}
}

function ItemCard(props: {
	view: ItemView;
	open: boolean;
	busy: boolean;
	onEdit: (e: Edit, success?: string) => Promise<boolean>;
}) {
	const { business } = useWorkspace();
	const { item, product, candidates, questions } = props.view;
	const [qtyDraft, setQtyDraft] = useState<string | null>(null);
	const fullProduct = business.products.find((p) => p.id === product?.id);

	return (
		<div className="rounded-lg border">
			<div className="flex items-start justify-between gap-2 border-b px-3 py-2">
				<div className="min-w-0">
					<p className="text-sm font-medium">
						{product?.name ??
							(item.match === "ambiguous" ? (
								<span className="text-status-clarify">
									Not sure which product
								</span>
							) : (
								<span className="text-status-review">Not in the catalog</span>
							))}
					</p>
					<p className="truncate text-xs text-muted-foreground">
						“{item.rawText}”
					</p>
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{product?.pricingMode === "custom" && (
						<span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium text-primary">
							Custom-priced
						</span>
					)}
					{product &&
						(qtyDraft !== null ? (
							<form
								className="flex items-center gap-1"
								onSubmit={async (e) => {
									e.preventDefault();
									const n = Number(qtyDraft);
									if (
										await props.onEdit({
											kind: "quantity",
											itemId: item.id,
											quantity: n > 0 ? n : null,
										})
									)
										setQtyDraft(null);
								}}
							>
								<Input
									autoFocus
									inputMode="decimal"
									value={qtyDraft}
									onChange={(e) => setQtyDraft(e.target.value)}
									className="h-7 w-20 text-xs"
								/>
								<Button size="icon" variant="ghost" className="size-7">
									<Check className="size-3.5" />
								</Button>
							</form>
						) : (
							<button
								type="button"
								disabled={!props.open}
								onClick={() => setQtyDraft(String(item.quantity ?? ""))}
								className={cn(
									"rounded px-1.5 py-0.5 text-xs tabular-nums",
									props.open && "hover:bg-muted",
									item.quantity === null &&
										product.pricingMode === "fixed" &&
										"bg-status-clarify/15 text-status-clarify",
								)}
							>
								{item.quantity !== null
									? `× ${item.quantity} ${fullProduct?.unit ?? ""}`
									: product.pricingMode === "fixed"
										? "qty ?"
										: "qty 1"}
							</button>
						))}
				</div>
			</div>

			{item.match === "ambiguous" && candidates.length > 0 && (
				<div className="flex flex-wrap items-center gap-1.5 px-3 py-2 text-xs">
					<span className="text-muted-foreground">Could be:</span>
					{candidates.map((c) => (
						<button
							key={c.id}
							type="button"
							disabled={!props.open || props.busy}
							onClick={() =>
								props.onEdit(
									{ kind: "product", itemId: item.id, productId: c.id },
									`Matched to ${c.name}`,
								)
							}
							className="rounded-full border px-2 py-0.5 hover:bg-muted"
						>
							{c.name}
						</button>
					))}
				</div>
			)}

			{questions.length > 0 && (
				<ul className="divide-y">
					{questions.map((q) => (
						<AnswerRow
							key={q.id}
							question={q}
							answer={item.answers[q.key]}
							open={props.open}
							onSave={(values) =>
								props.onEdit({
									kind: "answer",
									itemId: item.id,
									key: q.key,
									values,
								})
							}
							onSkip={(reason) =>
								props.onEdit({
									kind: "skip",
									itemId: item.id,
									key: q.key,
									reason,
								})
							}
							onClear={() =>
								props.onEdit({ kind: "clear", itemId: item.id, key: q.key })
							}
						/>
					))}
				</ul>
			)}
			{item.reason && (
				<p className="border-t px-3 py-1.5 text-[11px] text-muted-foreground">
					AI: {item.reason}
				</p>
			)}
		</div>
	);
}

function sourceText(a: Answer) {
	const at = clock(new Date(a.at));
	if (a.source === "skipped") return `waived by ${a.by ?? "staff"} · ${at}`;
	if (a.source === "staff") return `${a.by ?? "staff"} · ${at}`;
	return `customer · ${at}`;
}

function AnswerRow(props: {
	question: Question;
	answer: Answer | undefined;
	open: boolean;
	onSave: (values: string[]) => Promise<boolean>;
	onSkip: (reason: string) => Promise<boolean>;
	onClear: () => Promise<boolean>;
}) {
	const { question: q, answer } = props;
	const [editing, setEditing] = useState(false);
	const [waiving, setWaiving] = useState(false);
	const { me } = useWorkspace();
	const done = isAnswered(answer, q);
	return (
		<li
			className={cn(
				"px-3 py-2 text-sm",
				!done && q.required && "bg-status-clarify/5",
			)}
		>
			<div className="flex items-start gap-2">
				{done ? (
					<Check className="mt-0.5 size-3.5 shrink-0 text-status-approved" />
				) : (
					<CircleDashed
						className={cn(
							"mt-0.5 size-3.5 shrink-0",
							q.required ? "text-status-clarify" : "text-muted-foreground",
						)}
					/>
				)}
				<div className="min-w-0 flex-1">
					<p className="text-xs text-muted-foreground">
						{q.label}
						{!q.required && " (optional)"}
					</p>
					{editing ? (
						<AnswerEditor
							question={q}
							initial={
								answer?.source === "skipped" ? [] : (answer?.values ?? [])
							}
							onCancel={() => setEditing(false)}
							onSave={async (values) => {
								if (await props.onSave(values)) setEditing(false);
							}}
						/>
					) : done && answer ? (
						<p className="flex flex-wrap items-baseline gap-x-2">
							{answer.fileMessageId ? (
								<a
									href={`/api/messages/${answer.fileMessageId}/attachment`}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-primary hover:underline"
								>
									<FileText className="size-3.5" /> {answer.values[0]}
								</a>
							) : (
								<span
									className={cn(
										"font-medium",
										answer.source === "skipped" &&
											"font-normal text-muted-foreground italic",
									)}
								>
									{answerText(answer)}
								</span>
							)}
							<span className="text-[10px] text-muted-foreground">
								{sourceText(answer)}
								{answer.waiverReason && ` · ${answer.waiverReason}`}
							</span>
						</p>
					) : (
						<p className="text-xs text-muted-foreground italic">
							{answer
								? `${answerText(answer)} — ${answerIssue(answer, q)}`
								: q.type === "file"
									? "No file yet"
									: "Not answered yet"}
						</p>
					)}
				</div>
				{props.open && !editing && (
					<div className="flex shrink-0 gap-0.5">
						{q.type !== "file" && (
							<IconButton title="Edit answer" onClick={() => setEditing(true)}>
								<Pencil />
							</IconButton>
						)}
						{!done && me?.canApprove && (
							<IconButton
								title="Waive with a reason"
								onClick={() => setWaiving(true)}
							>
								<SkipForward />
							</IconButton>
						)}
						{answer && (
							<IconButton title="Clear answer" onClick={props.onClear}>
								<X />
							</IconButton>
						)}
					</div>
				)}
			</div>
			{waiving && (
				<WaiverEditor
					onCancel={() => setWaiving(false)}
					onSave={async (reason) => {
						if (await props.onSkip(reason)) setWaiving(false);
					}}
				/>
			)}
		</li>
	);
}

function IconButton(props: {
	title: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={props.title}
			onClick={props.onClick}
			className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground [&_svg]:size-3.5"
		>
			{props.children}
			<span className="sr-only">{props.title}</span>
		</button>
	);
}

function AnswerEditor(props: {
	question: Question;
	initial: string[];
	onSave: (values: string[]) => void;
	onCancel: () => void;
}) {
	const q = props.question;
	const [text, setText] = useState(props.initial.join(", "));
	const [picked, setPicked] = useState<string[]>(props.initial);
	const choices = q.type === "yes_no" ? ["yes", "no"] : q.options;

	if (q.type === "single" || q.type === "yes_no" || q.type === "multi") {
		const multi = q.type === "multi";
		return (
			<div className="mt-1 space-y-1.5">
				<div className="flex flex-wrap gap-1">
					{choices.map((o) => {
						const on = picked.includes(o);
						return (
							<button
								key={o}
								type="button"
								onClick={() =>
									setPicked((p) =>
										multi ? (on ? p.filter((x) => x !== o) : [...p, o]) : [o],
									)
								}
								className={cn(
									"rounded-full border px-2 py-0.5 text-xs",
									on && "border-primary bg-primary text-primary-foreground",
								)}
							>
								{o}
							</button>
						);
					})}
				</div>
				<div className="flex gap-1">
					<Button
						size="sm"
						className="h-7"
						disabled={picked.length === 0}
						onClick={() => props.onSave(picked)}
					>
						Save
					</Button>
					<Button
						size="sm"
						variant="ghost"
						className="h-7"
						onClick={props.onCancel}
					>
						Cancel
					</Button>
				</div>
			</div>
		);
	}
	return (
		<form
			className="mt-1 flex gap-1"
			onSubmit={(e) => {
				e.preventDefault();
				if (text.trim()) props.onSave([text.trim()]);
			}}
		>
			<Input
				autoFocus
				value={text}
				onChange={(e) => setText(e.target.value)}
				inputMode={q.type === "number" ? "decimal" : undefined}
				placeholder={q.type === "date" ? "e.g. 15 Dec, end of March" : ""}
				className="h-7 text-xs"
			/>
			<Button size="sm" className="h-7">
				Save
			</Button>
			<Button
				type="button"
				size="sm"
				variant="ghost"
				className="h-7"
				onClick={props.onCancel}
			>
				Cancel
			</Button>
		</form>
	);
}

function FollowUpRow(props: {
	followUp: FollowUp;
	open: boolean;
	onAnswer: (answer: string) => Promise<boolean>;
	onRemove: (reason: string) => Promise<boolean>;
}) {
	const f = props.followUp;
	const [editing, setEditing] = useState(false);
	const [text, setText] = useState(f.answer ?? "");
	const [waiving, setWaiving] = useState(false);
	const { me } = useWorkspace();
	return (
		<li
			className={cn(
				"px-3 py-2 text-sm",
				!followUpResolved(f) && "bg-status-clarify/5",
			)}
		>
			<div className="flex items-start gap-2">
				{f.from === "staff" ? (
					<UserRound className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
				) : (
					<Sparkles className="mt-0.5 size-3.5 shrink-0 text-[var(--orb-royal)]" />
				)}
				<div className="min-w-0 flex-1">
					<p className="text-xs text-muted-foreground">
						{f.question}{" "}
						<span className="text-[10px]">
							·{" "}
							{f.from === "staff"
								? `added by ${f.by ?? "staff"}`
								: "asked by AI"}
						</span>
					</p>
					{editing ? (
						<form
							className="mt-1 flex gap-1"
							onSubmit={async (e) => {
								e.preventDefault();
								if (await props.onAnswer(text)) setEditing(false);
							}}
						>
							<Input
								autoFocus
								value={text}
								onChange={(e) => setText(e.target.value)}
								className="h-7 text-xs"
							/>
							<Button size="sm" className="h-7">
								Save
							</Button>
						</form>
					) : f.waivedBy ? (
						<p className="text-xs text-muted-foreground">
							Waived by {f.waivedBy}: {f.waiverReason}
						</p>
					) : f.answer ? (
						<p className="font-medium">{f.answer}</p>
					) : (
						<p className="text-xs text-muted-foreground italic">
							{f.asked ? "Asked, waiting for an answer" : "Will be asked next"}
						</p>
					)}
				</div>
				{props.open && !editing && (
					<div className="flex shrink-0 gap-0.5">
						<IconButton title="Answer it" onClick={() => setEditing(true)}>
							<Pencil />
						</IconButton>
						{me?.canApprove && !f.waivedBy && (
							<IconButton
								title="Waive with a reason"
								onClick={() => setWaiving(true)}
							>
								<SkipForward />
							</IconButton>
						)}
					</div>
				)}
			</div>
			{waiving && (
				<WaiverEditor
					onCancel={() => setWaiving(false)}
					onSave={async (reason) => {
						if (await props.onRemove(reason)) setWaiving(false);
					}}
				/>
			)}
		</li>
	);
}

function WaiverEditor(props: {
	onSave: (reason: string) => void;
	onCancel: () => void;
}) {
	const [reason, setReason] = useState("");
	return (
		<form
			className="mt-2 flex gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				if (reason.trim()) props.onSave(reason.trim());
			}}
		>
			<Input
				aria-label="Reason for waiving this requirement"
				placeholder="Why can this requirement be waived?"
				value={reason}
				onChange={(e) => setReason(e.target.value)}
				maxLength={500}
			/>
			<Button size="sm" disabled={!reason.trim()}>
				Waive
			</Button>
			<Button type="button" size="sm" variant="ghost" onClick={props.onCancel}>
				Cancel
			</Button>
		</form>
	);
}

function StaffControls(props: {
	busy: boolean;
	canDraft: boolean;
	asking: boolean;
	drafting: boolean;
	drafted: boolean;
	onAdd: (question: string) => Promise<boolean>;
	onAsk: () => void;
	onDraft: () => void;
}) {
	const [question, setQuestion] = useState("");
	return (
		<div className="space-y-2 rounded-lg bg-muted/60 p-3">
			<form
				className="flex gap-2"
				onSubmit={async (e) => {
					e.preventDefault();
					if (question.trim() && (await props.onAdd(question))) setQuestion("");
				}}
			>
				<Input
					value={question}
					onChange={(e) => setQuestion(e.target.value)}
					placeholder="Also ask the customer about…"
					className="h-8 bg-card text-sm"
				/>
				<Button
					size="sm"
					variant="outline"
					className="h-8 bg-card"
					disabled={!question.trim()}
				>
					<Plus className="size-4" /> Add
				</Button>
			</form>
			<div className="flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					className="bg-card"
					disabled={props.busy}
					onClick={props.onAsk}
				>
					{props.asking ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<SendHorizontal className="size-4" />
					)}
					Ask now
				</Button>
				{!props.drafted && (
					<Button
						size="sm"
						variant="outline"
						className="bg-card"
						disabled={props.busy || !props.canDraft}
						onClick={props.onDraft}
					>
						{props.drafting ? (
							<Loader2 className="size-4 animate-spin" />
						) : (
							<FilePlus2 className="size-4" />
						)}
						Draft now
					</Button>
				)}
			</div>
			<p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
				<MessageCircleQuestion className="mt-px size-3.5 shrink-0" />
				"Ask now" sends the AI's next question (or the recap) without waiting
				for the customer. An approver can use "Draft now" once required details
				are resolved or explicitly waived. It prepares a draft from what we
				know.
			</p>
		</div>
	);
}
