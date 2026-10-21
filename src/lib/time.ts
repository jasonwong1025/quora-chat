const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/** "9:48 AM" */
export function clock(d: Date) {
	return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** Chat-list style: time today, "Yesterday", else a short date. */
export function listTime(d: Date) {
	const now = new Date();
	if (sameDay(d, now)) return clock(d);
	const y = new Date(now);
	y.setDate(now.getDate() - 1);
	if (sameDay(d, y)) return "Yesterday";
	return d.toLocaleDateString("en-MY", { day: "numeric", month: "numeric" });
}

/** Date separator label: "Today", "Yesterday", or "21/10/2026". */
export function dayLabel(d: Date) {
	const t = listTime(d);
	if (t === "Yesterday") return t;
	if (sameDay(d, new Date())) return "Today";
	return d.toLocaleDateString("en-MY");
}

/** "3m ago", "2h ago", "5d ago" */
export function ago(d: Date) {
	const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)}m ago`;
	if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
	return `${Math.floor(s / 86400)}d ago`;
}

export function initials(name: string) {
	const parts = name
		.replace(/[^\p{L}\p{N} ]/gu, "")
		.trim()
		.split(/\s+/);
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
	return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Stable avatar colour for a name. */
export function avatarHue(name: string) {
	let h = 0;
	for (const ch of name) h = (h * 17 + (ch.codePointAt(0) ?? 0)) % 360;
	return h;
}
