/**
 * The flagship demo: one Kilat Print Studio enquiry from first message to signed
 * job. Synthetic, team-written lines. The WhatsApp portal offers them in order as
 * "next demo message"; in replay mode (AI_MODE=replay) the AI's reading of each
 * line is scripted, everything else (pricing, approvals, signing, jobs) runs for real.
 */
export const flagshipScenario = {
	businessId: "kilat-print",
	customerName: "Kak Ros",
	steps: [
		{
			say: "Saya nak buat flyer untuk kedai kek saya, berapa harga?",
			note: "Vague request: no size or quantity. The AI asks which flyer.",
		},
		{
			say: "A5. 1000 keping. Saya ada design dari Canva, nak hantar file apa?",
			note: "Size and quantity, plus a question the public FAQ answers.",
		},
		{
			say: "157gsm, dua belah.",
			note: "Paper and sides ('dua belah' = double sided).",
		},
		{
			say: "Jumaat depan. Saya ambil sendiri di kedai.",
			note: "Deadline and self pickup. The AI recaps for confirmation.",
		},
		{
			say: "Ya betul.",
			note: "Confirmed: code drafts the quote for staff approval.",
		},
		{
			say: "Eh sorry, boss saya nak 2000 keping, bukan 1000.",
			note: "A change before approval: the draft becomes outdated.",
		},
		{
			say: "Ya, 2000. Terima kasih!",
			note: "Confirmed again: the draft is re-prepared for 2000 pcs.",
		},
	],
} as const;

export type ScenarioStep = (typeof flagshipScenario.steps)[number];

/** Lowercase, collapsed whitespace: how script lines are matched. */
export const scriptKey = (text: string) =>
	text.trim().replace(/\s+/g, " ").toLowerCase();
