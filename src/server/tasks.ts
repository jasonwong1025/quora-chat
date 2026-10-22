import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { type Database, getDb, schema } from "#/db";

export type TaskKind = "create_handover" | "prepare_handover";
export type TaskClaim = { id: string; token: string };

export async function enqueueTask(
	db: Database,
	kind: TaskKind,
	entityId: string,
	generation?: string,
) {
	await db
		.insert(schema.workflowTasks)
		.values({
			key: `${kind}:${entityId}${generation ? `:${generation}` : ""}`,
			kind,
			entityId,
			generation,
		})
		.onConflictDoNothing();
}

export async function claimTask() {
	return getDb().transaction(async (tx) => {
		const now = new Date();
		await tx
			.update(schema.workflowTasks)
			.set({
				status: "failed",
				claimToken: null,
				lockedUntil: null,
				lastError: "Worker stopped repeatedly before completing this task",
				updatedAt: now,
			})
			.where(
				and(
					eq(schema.workflowTasks.status, "pending"),
					sql`${schema.workflowTasks.attempts} >= 5`,
					or(
						isNull(schema.workflowTasks.lockedUntil),
						lte(schema.workflowTasks.lockedUntil, now),
					),
				),
			);
		const [task] = await tx
			.select()
			.from(schema.workflowTasks)
			.where(
				and(
					eq(schema.workflowTasks.status, "pending"),
					lte(schema.workflowTasks.runAfter, now),
					or(
						isNull(schema.workflowTasks.lockedUntil),
						lte(schema.workflowTasks.lockedUntil, now),
					),
				),
			)
			.orderBy(schema.workflowTasks.createdAt)
			.limit(1)
			.for("update", { skipLocked: true });
		if (!task) return null;
		const token = crypto.randomUUID();
		const [claimed] = await tx
			.update(schema.workflowTasks)
			.set({
				claimToken: token,
				lockedUntil: new Date(Date.now() + 300_000),
				attempts: task.attempts + 1,
				updatedAt: now,
			})
			.where(eq(schema.workflowTasks.id, task.id))
			.returning();
		return { ...claimed, token };
	});
}

/** A stale worker cannot commit effects after another worker reclaimed its lease. */
export async function finishTask(db: Database, claim: TaskClaim) {
	const [row] = await db
		.update(schema.workflowTasks)
		.set({
			status: "done",
			claimToken: null,
			lockedUntil: null,
			lastError: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(schema.workflowTasks.id, claim.id),
				eq(schema.workflowTasks.claimToken, claim.token),
				eq(schema.workflowTasks.status, "pending"),
			),
		)
		.returning();
	if (!row)
		throw new Error(
			"Background task lease was replaced; discarding this result",
		);
}

export async function failTask(claim: TaskClaim, error: unknown) {
	await getDb()
		.update(schema.workflowTasks)
		.set({
			status: sql`CASE WHEN ${schema.workflowTasks.attempts} >= 5 THEN 'failed' ELSE 'pending' END`,
			lastError: (error instanceof Error ? error.message : String(error)).slice(
				0,
				1000,
			),
			lockedUntil: null,
			claimToken: null,
			runAfter: new Date(Date.now() + 15_000),
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(schema.workflowTasks.id, claim.id),
				eq(schema.workflowTasks.claimToken, claim.token),
			),
		);
}
