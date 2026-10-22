/**
 * Finding the parts of the knowledge base that matter for a question.
 * Plain keyword ranking: deterministic, explainable, and needs no extra service.
 */

export type KnowledgeDoc = {
	id: string;
	title: string;
	category: string;
	body: string;
};

export type Passage = {
	docId: string;
	title: string;
	category: string;
	text: string;
	score: number;
};

const MAX_PASSAGE = 700;

// Words too common to tell docs apart (English and Malay).
const stop = new Set(
	"a an and are as at be but by can do does for from has have how i if in is it its me my of on or our so that the their them they this to us was we what when where which who why will with you your yang dan di ke dari untuk ini itu ada tak tidak boleh nak saya kami kita dengan pada ya je lah".split(
		" ",
	),
);

/** Words, plus two-character pieces of Chinese text (it has no spaces). */
export function terms(text: string) {
	const out: string[] = [];
	for (const raw of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
		if (/\p{Script=Han}/u.test(raw)) {
			for (let i = 0; i < raw.length - 1; i++) out.push(raw.slice(i, i + 2));
			continue;
		}
		if (raw.length < 2 || stop.has(raw)) continue;
		// Light stemming so "flyers" finds "flyer", "servicing" finds "service".
		out.push(raw.replace(/(?:ing|es|s)$/u, "") || raw);
	}
	return out;
}

/** Splits a doc into passages of a few paragraphs, each knowing its doc. */
export function passages(doc: KnowledgeDoc): Omit<Passage, "score">[] {
	const parts = doc.body
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	const out: Omit<Passage, "score">[] = [];
	let current = "";
	for (const part of parts) {
		if (current && current.length + part.length > MAX_PASSAGE) {
			out.push({
				docId: doc.id,
				title: doc.title,
				category: doc.category,
				text: current,
			});
			current = "";
		}
		current = current ? `${current}\n\n${part}` : part;
	}
	if (current)
		out.push({
			docId: doc.id,
			title: doc.title,
			category: doc.category,
			text: current,
		});
	return out;
}

/** The best-matching passages for `query`, most relevant first. Nothing if nothing matches. */
export function searchKnowledge(
	docs: KnowledgeDoc[],
	query: string,
	limit = 4,
): Passage[] {
	const wanted = [...new Set(terms(query))];
	if (!wanted.length || !docs.length) return [];
	const all = docs.flatMap(passages).map((p) => ({
		...p,
		words: new Set(terms(`${p.title} ${p.text}`)),
		titleWords: new Set(terms(`${p.title} ${p.category}`)),
	}));
	// Rare words count for more than words every passage has.
	const idf = new Map(
		wanted.map((t) => {
			const df = all.filter((p) => p.words.has(t)).length;
			return [t, df ? Math.log(1 + all.length / df) : 0];
		}),
	);
	return all
		.map(({ words, titleWords, ...p }) => ({
			...p,
			score: wanted.reduce(
				(sum, t) =>
					sum +
					(words.has(t) ? (idf.get(t) ?? 0) : 0) +
					(titleWords.has(t) ? 0.5 * (idf.get(t) ?? 0) : 0),
				0,
			),
		}))
		.filter((p) => p.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, limit);
}
