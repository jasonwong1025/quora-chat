/**
 * Tags in the job team chat. "@AI" asks the assistant; "@Full Name" (or a first
 * name no other member shares) tags a teammate. Shared by the server and the UI.
 */

export const AI_MENTION = "ai";
export const AI_HANDLE = "AI";

type Member = { id: string; name: string };

export const escapeRegExp = (s: string) =>
	s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A tag ends at whitespace, punctuation or the end of the message.
const tag = (handle: string) =>
	new RegExp(
		`(^|[^\\p{L}\\p{N}_@])@${escapeRegExp(handle)}(?![\\p{L}\\p{N}_])`,
		"iu",
	);

export function mentionsAi(body: string) {
	return tag(AI_HANDLE).test(body);
}

/** The handles to offer in the picker: full names, plus first names nobody else shares. */
export function handlesFor(members: Member[]) {
	const first = (m: Member) => m.name.trim().split(/\s+/)[0];
	return members.flatMap((m) => {
		const handles = [m.name.trim()];
		const f = first(m);
		if (
			f &&
			f !== handles[0] &&
			members.filter((o) => first(o).toLowerCase() === f.toLowerCase())
				.length === 1
		)
			handles.push(f);
		return handles.map((handle) => ({ id: m.id, handle }));
	});
}

/** Everyone a message tags, as staff ids plus "ai". */
export function findMentions(body: string, members: Member[]) {
	const found = new Set<string>();
	if (mentionsAi(body)) found.add(AI_MENTION);
	for (const { id, handle } of handlesFor(members))
		if (tag(handle).test(body)) found.add(id);
	return [...found];
}

/** The message without the "@AI" tag, for the assistant to read as a question. */
export function withoutAiTag(body: string) {
	return body
		.replace(
			new RegExp(
				`(^|[^\\p{L}\\p{N}_@])@${AI_HANDLE}(?![\\p{L}\\p{N}_])[,:]?`,
				"giu",
			),
			"$1",
		)
		.replace(/\s+/g, " ")
		.trim();
}
