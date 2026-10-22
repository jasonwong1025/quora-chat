/**
 * Turns common relative day phrases (English, Malay, Chinese) into a calendar
 * date, so a deadline like "Jumaat depan" is stored as a real date by code rather
 * than left to the model. Anything it doesn't recognise is returned as null.
 */

const weekdays: [number, RegExp][] = [
	[1, /\b(monday|mon|isnin)\b|星期一|周一|礼拜一/],
	[2, /\b(tuesday|tue|tues|selasa)\b|星期二|周二|礼拜二/],
	[3, /\b(wednesday|wed|rabu)\b|星期三|周三|礼拜三/],
	[4, /\b(thursday|thu|thurs|khamis)\b|星期四|周四|礼拜四/],
	[5, /\b(friday|fri|jumaat|jumat)\b|星期五|周五|礼拜五/],
	[6, /\b(saturday|sat|sabtu)\b|星期六|周六|礼拜六/],
	[0, /\b(sunday|sun|ahad|minggu)\b|星期日|星期天|周日|礼拜天/],
];

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `today` is YYYY-MM-DD (Malaysia time). */
export function resolveRelativeDate(
	text: string,
	today: string,
): string | null {
	const t = text.trim().toLowerCase();
	if (!t || /^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
	const base = new Date(`${today}T00:00:00Z`);
	if (Number.isNaN(base.getTime())) return null;
	const plus = (days: number) => {
		const d = new Date(base);
		d.setUTCDate(d.getUTCDate() + days);
		return iso(d);
	};
	if (/^(today|hari ini|今天)$/.test(t)) return plus(0);
	if (/^(tomorrow|esok|besok|明天)$/.test(t)) return plus(1);
	if (/^(day after tomorrow|lusa|后天)$/.test(t)) return plus(2);

	const day = weekdays.find(([, re]) => re.test(t))?.[0];
	if (day === undefined) return null;
	// Only phrases that are just "(next/this) weekday", nothing else that could change it.
	const rest = t
		.replace(weekdays.find(([d]) => d === day)?.[1] ?? /$^/, "")
		.replace(/[.,!。！，]/g, " ")
		.trim();
	const next = /^(next|depan|hadapan|下个|下|下週|下周)$/.test(
		rest.replace(/\s+/g, " "),
	);
	const coming = /^(this|ini|这个|这|本|)$/.test(rest.replace(/\s+/g, " "));
	if (!next && !coming) return null;
	const todayDay = base.getUTCDay();
	if (next) {
		// "Next Friday": that weekday in the following Monday-to-Sunday week.
		const sinceMonday = (todayDay + 6) % 7;
		return plus(-sinceMonday + 7 + ((day + 6) % 7));
	}
	// "Friday" / "this Friday": the coming one (today counts).
	return plus((day - todayDay + 7) % 7);
}
