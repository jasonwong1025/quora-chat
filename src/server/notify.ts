import { type Database, schema } from "#/db";

/** In-app notifications for staff (the bell). Duplicate ids are sent once. */
export async function notify(
	db: Database,
	n: {
		businessId: string;
		staffIds: (string | null | undefined)[];
		title: string;
		body: string;
		link?: string;
	},
) {
	const ids = [...new Set(n.staffIds.filter((x): x is string => Boolean(x)))];
	if (!ids.length) return;
	await db.insert(schema.notifications).values(
		ids.map((staffId) => ({
			businessId: n.businessId,
			staffId,
			title: n.title,
			body: n.body,
			link: n.link ?? null,
		})),
	);
}
