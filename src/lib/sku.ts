/**
 * Suggests a SKU like "KP-FLY-FA5" from the quote prefix, category and name.
 * Staff can change it; it only has to be unique within the business.
 */
export function suggestSku(prefix: string, category: string, name: string) {
	const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ");
	const cat = clean(category).replace(/ /g, "").slice(0, 3) || "GEN";
	const code =
		clean(name)
			.split(/\s+/)
			.filter(Boolean)
			// Words with digits (A5, 10X4, 1.5HP) are kept whole; others give their first letter.
			.map((w) => (/\d/.test(w) ? w : w[0]))
			.join("")
			.slice(0, 8) || "ITEM";
	return `${prefix.toUpperCase()}-${cat}-${code}`;
}

/** Adds -2, -3… until the SKU is not in `taken` (case-insensitive). */
export function uniqueSku(base: string, taken: Iterable<string>) {
	const used = new Set([...taken].map((s) => s.toUpperCase()));
	if (!used.has(base.toUpperCase())) return base;
	for (let n = 2; ; n++) {
		const next = `${base}-${n}`;
		if (!used.has(next.toUpperCase())) return next;
	}
}
