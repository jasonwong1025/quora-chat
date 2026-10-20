/** Format sen (1/100 MYR) as "RM 1,234.50". */
export function formatMYR(sen: number) {
	return `RM ${(sen / 100).toLocaleString("en-MY", {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
	})}`;
}

/** Parse a ringgit string like "12.50" into sen. Returns null if invalid. */
export function parseMYR(value: string): number | null {
	const n = Number(value.replace(/[^\d.]/g, ""));
	return Number.isFinite(n) ? Math.round(n * 100) : null;
}
