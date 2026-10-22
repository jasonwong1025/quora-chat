import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	ArrowDown,
	ArrowUp,
	Calendar,
	CheckSquare,
	CircleDot,
	FileUp,
	Hash,
	Loader2,
	Pencil,
	Plus,
	Sparkles,
	ToggleLeft,
	Trash2,
	Type,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import type { Question } from "#/lib/intake";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export type QuestionTarget =
	| { scope: "business" }
	| { scope: "category"; category: string }
	| { scope: "product"; productId: string };

type QType = Question["type"];

export const typeInfo: Record<QType, { label: string; icon: typeof Type }> = {
	text: { label: "Text", icon: Type },
	number: { label: "Number", icon: Hash },
	date: { label: "Date", icon: Calendar },
	single: { label: "Pick one", icon: CircleDot },
	multi: { label: "Pick any", icon: CheckSquare },
	yes_no: { label: "Yes / no", icon: ToggleLeft },
	file: { label: "Photo / file", icon: FileUp },
};

type Draft = {
	key: string;
	label: string;
	type: QType;
	options: string[];
	required: boolean;
	hint: string | null;
	showIf: { key: string; equals: string } | null;
	onQuote: boolean;
};

export function questionsOf(questions: Question[], t: QuestionTarget) {
	return questions
		.filter(
			(q) =>
				q.scope === t.scope &&
				(t.scope !== "category" || q.category === t.category) &&
				(t.scope !== "product" || q.productId === t.productId),
		)
		.sort(
			(a, b) =>
				a.position - b.position ||
				a.createdAt.getTime() - b.createdAt.getTime(),
		);
}

function toKey(label: string) {
	return (
		label
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "")
			.split("_")
			.filter(
				(w) =>
					![
						"what",
						"which",
						"is",
						"the",
						"do",
						"you",
						"a",
						"an",
						"are",
						"how",
						"your",
						"of",
						"to",
						"for",
						"it",
					].includes(w),
			)
			.slice(0, 3)
			.join("_") || "question"
	);
}

function useRefresh() {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ queryKey: orpc.businesses.key() });
}

/** One list of preset questions (a product's, a category's, or the business-wide ones). */
export function QuestionList(props: {
	target: QuestionTarget;
	/** Shown read-only above, e.g. category questions inside a product. */
	inherited?: { title: string; questions: Question[] };
	compact?: boolean;
	emptyText?: string;
}) {
	const { business } = useWorkspace();
	const refresh = useRefresh();
	const questions = questionsOf(business.questions, props.target);
	const [editing, setEditing] = useState<Question | "new" | null>(null);
	const [suggesting, setSuggesting] = useState(false);
	const move = useMutation(
		orpc.questions.move.mutationOptions({ onSuccess: refresh }),
	);
	const remove = useMutation(
		orpc.questions.delete.mutationOptions({ onSuccess: refresh }),
	);
	// Keys this list's questions can depend on (for "only ask if").
	const siblings = [...(props.inherited?.questions ?? []), ...questions];

	return (
		<div className="space-y-2">
			{questions.length === 0 ? (
				<p className="text-sm text-muted-foreground">
					{props.emptyText ?? "No questions yet."}
				</p>
			) : (
				<ol className="divide-y rounded-lg border">
					{questions.map((q, i) => (
						<li key={q.id} className="flex items-start gap-2 px-3 py-2">
							<TypeIcon type={q.type} className="mt-0.5" />
							<div className="min-w-0 flex-1">
								<p className="text-sm">
									{q.label}
									{!q.required && (
										<span className="text-xs text-muted-foreground">
											{" "}
											(optional)
										</span>
									)}
								</p>
								<p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
									<span className="font-mono">{q.key}</span>
									<span>{typeInfo[q.type].label}</span>
									{q.options.length > 0 && q.type !== "yes_no" && (
										<span className="truncate">{q.options.join(" / ")}</span>
									)}
									{q.showIf && (
										<span>
											only if {q.showIf.key} = {q.showIf.equals}
										</span>
									)}
									{q.onQuote && <span>shown on quote</span>}
									{q.source === "ai" && (
										<span className="inline-flex items-center gap-0.5 text-[var(--orb-royal)]">
											<Sparkles className="size-3" /> AI-drafted
										</span>
									)}
								</p>
							</div>
							<div className="flex shrink-0 items-center">
								<SmallButton
									title="Move up"
									disabled={i === 0 || move.isPending}
									onClick={() =>
										move.mutate({ questionId: q.id, direction: "up" })
									}
								>
									<ArrowUp />
								</SmallButton>
								<SmallButton
									title="Move down"
									disabled={i === questions.length - 1 || move.isPending}
									onClick={() =>
										move.mutate({ questionId: q.id, direction: "down" })
									}
								>
									<ArrowDown />
								</SmallButton>
								<SmallButton title="Edit" onClick={() => setEditing(q)}>
									<Pencil />
								</SmallButton>
								<SmallButton
									title="Delete"
									disabled={remove.isPending}
									onClick={() => remove.mutate({ questionId: q.id })}
								>
									<Trash2 />
								</SmallButton>
							</div>
						</li>
					))}
				</ol>
			)}

			{props.inherited && props.inherited.questions.length > 0 && (
				<div className="rounded-lg border border-dashed px-3 py-2">
					<p className="mb-1 text-[11px] font-medium text-muted-foreground">
						{props.inherited.title}
					</p>
					<ul className="space-y-1">
						{props.inherited.questions.map((q) => (
							<li
								key={q.id}
								className="flex items-center gap-2 text-xs text-muted-foreground"
							>
								<TypeIcon type={q.type} /> {q.label}
							</li>
						))}
					</ul>
				</div>
			)}

			<div className="flex flex-wrap gap-2">
				<Button size="sm" variant="outline" onClick={() => setEditing("new")}>
					<Plus className="size-4" /> Add question
				</Button>
				<Button size="sm" variant="outline" onClick={() => setSuggesting(true)}>
					<Sparkles className="size-4 text-[var(--orb-royal)]" /> Suggest with
					AI
				</Button>
			</div>

			<QuestionDialog
				key={editing === "new" ? "new" : (editing?.id ?? "none")}
				open={editing !== null}
				question={editing === "new" ? null : editing}
				target={props.target}
				siblings={siblings}
				onClose={() => setEditing(null)}
			/>
			{suggesting && (
				<SuggestDialog
					target={props.target}
					existingKeys={new Set(siblings.map((q) => q.key))}
					onClose={() => setSuggesting(false)}
				/>
			)}
		</div>
	);
}

function TypeIcon({ type, className }: { type: QType; className?: string }) {
	const Icon = typeInfo[type].icon;
	return (
		<Icon
			className={cn("size-3.5 shrink-0 text-muted-foreground", className)}
			aria-label={typeInfo[type].label}
		/>
	);
}

function SmallButton(props: {
	title: string;
	disabled?: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={props.title}
			disabled={props.disabled}
			onClick={props.onClick}
			className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30 [&_svg]:size-3.5"
		>
			{props.children}
			<span className="sr-only">{props.title}</span>
		</button>
	);
}

/** Add or edit one question. */
function QuestionDialog(props: {
	open: boolean;
	question: Question | null;
	target: QuestionTarget;
	siblings: Question[];
	onClose: () => void;
}) {
	const { business, me } = useWorkspace();
	const refresh = useRefresh();
	const q = props.question;
	const [draft, setDraft] = useState<Draft>({
		key: q?.key ?? "",
		label: q?.label ?? "",
		type: q?.type ?? "single",
		options: q?.options ?? [],
		required: q?.required ?? true,
		hint: q?.hint ?? null,
		showIf: q?.showIf ?? null,
		onQuote: q?.onQuote ?? false,
	});
	const [keyTouched, setKeyTouched] = useState(Boolean(q));
	const add = useMutation(orpc.questions.add.mutationOptions());
	const update = useMutation(orpc.questions.update.mutationOptions());
	const pending = add.isPending || update.isPending;
	const key = keyTouched ? draft.key : toKey(draft.label);
	const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));
	const parents = props.siblings.filter(
		(s) => s.id !== q?.id && ["single", "yes_no", "multi"].includes(s.type),
	);
	const parent = parents.find((p) => p.key === draft.showIf?.key);
	const choice = draft.type === "single" || draft.type === "multi";

	async function save() {
		const question = { ...draft, key };
		try {
			if (q) await update.mutateAsync({ questionId: q.id, question });
			else
				await add.mutateAsync({
					businessId: business.id,
					target: props.target,
					questions: [question],
					actor: me?.name ?? "Staff",
				});
			await refresh();
			toast.success(q ? "Question updated" : "Question added");
			props.onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	return (
		<Dialog open={props.open} onOpenChange={(o) => !o && props.onClose()}>
			<DialogContent className="orbyte max-w-lg">
				<DialogHeader>
					<DialogTitle>{q ? "Edit question" : "Add question"}</DialogTitle>
					<DialogDescription>
						The AI asks this naturally in WhatsApp, in the customer's language,
						before a quote is drafted.
					</DialogDescription>
				</DialogHeader>

				<Labeled label="Question">
					<Input
						value={draft.label}
						placeholder="e.g. Which paper would you like?"
						onChange={(e) => set({ label: e.target.value })}
					/>
				</Labeled>
				<div className="grid grid-cols-2 gap-3">
					<Labeled label="Answer type">
						<Select
							value={draft.type}
							onValueChange={(v) => set({ type: v as QType })}
						>
							<SelectTrigger className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent position="popper">
								{Object.entries(typeInfo).map(([t, info]) => (
									<SelectItem key={t} value={t}>
										{info.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Labeled>
					<Labeled label="Key (used by pricing rules)">
						<Input
							value={key}
							className="font-mono text-xs"
							onChange={(e) => {
								setKeyTouched(true);
								set({
									key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"),
								});
							}}
						/>
					</Labeled>
				</div>
				{choice && (
					<Labeled label="Options (one per line)">
						<Textarea
							rows={4}
							value={draft.options.join("\n")}
							onChange={(e) =>
								set({
									options: e.target.value.split("\n").map((o) => o.trimStart()),
								})
							}
						/>
					</Labeled>
				)}
				<Labeled label="Note for the AI (optional)">
					<Input
						value={draft.hint ?? ""}
						placeholder="e.g. A rough range is fine"
						onChange={(e) => set({ hint: e.target.value || null })}
					/>
				</Labeled>
				{parents.length > 0 && (
					<div className="grid grid-cols-2 gap-3">
						<Labeled label="Only ask if…">
							<Select
								value={draft.showIf?.key ?? "always"}
								onValueChange={(v) =>
									set({
										showIf:
											v === "always"
												? null
												: { key: v, equals: draft.showIf?.equals ?? "" },
									})
								}
							>
								<SelectTrigger className="w-full">
									<SelectValue />
								</SelectTrigger>
								<SelectContent position="popper">
									<SelectItem value="always">Always ask</SelectItem>
									{parents.map((p) => (
										<SelectItem key={p.id} value={p.key}>
											{p.label}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</Labeled>
						{parent && (
							<Labeled label="…the answer is">
								<Select
									value={draft.showIf?.equals || undefined}
									onValueChange={(v) =>
										set({ showIf: { key: parent.key, equals: v } })
									}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Pick an answer" />
									</SelectTrigger>
									<SelectContent position="popper">
										{(parent.type === "yes_no"
											? ["yes", "no"]
											: parent.options
										).map((o) => (
											<SelectItem key={o} value={o}>
												{o}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Labeled>
						)}
					</div>
				)}
				<div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={draft.required}
							onChange={(e) => set({ required: e.target.checked })}
							className="accent-[var(--primary)]"
						/>
						Required before quoting
					</label>
					<label className="flex items-center gap-2">
						<input
							type="checkbox"
							checked={draft.onQuote}
							onChange={(e) => set({ onQuote: e.target.checked })}
							className="accent-[var(--primary)]"
						/>
						Show answer on the quotation line
					</label>
				</div>
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={props.onClose}>
						Cancel
					</Button>
					<Button
						disabled={
							pending ||
							!draft.label.trim() ||
							(Boolean(draft.showIf) && !draft.showIf?.equals)
						}
						onClick={save}
					>
						{pending && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** AI proposes questions; staff tick the ones to keep, tweak the wording, then add them. */
function SuggestDialog(props: {
	target: QuestionTarget;
	existingKeys: Set<string>;
	onClose: () => void;
}) {
	const { business, me } = useWorkspace();
	const refresh = useRefresh();
	const suggest = useMutation(orpc.questions.suggest.mutationOptions());
	const add = useMutation(orpc.questions.add.mutationOptions());
	const [items, setItems] = useState<(Draft & { keep: boolean })[] | null>(
		null,
	);
	const started = useRef(false);

	async function run() {
		try {
			const result = await suggest.mutateAsync({
				businessId: business.id,
				target: props.target,
			});
			setItems(
				(result ?? [])
					.filter((s) => !props.existingKeys.has(s.key))
					.map((s) => ({
						...s,
						onQuote: s.type === "single" || s.type === "multi",
						keep: true,
					})),
			);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "AI suggestion failed");
			props.onClose();
		}
	}
	// biome-ignore lint/correctness/useExhaustiveDependencies: ask once when the dialog opens
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		void run();
	}, []);

	async function accept() {
		const keep = (items ?? []).filter((i) => i.keep);
		if (!keep.length) return props.onClose();
		// Follow-ups may only point at questions that are being added or already exist.
		const keys = new Set([...props.existingKeys, ...keep.map((k) => k.key)]);
		try {
			await add.mutateAsync({
				businessId: business.id,
				target: props.target,
				source: "ai",
				actor: me?.name ?? "Staff",
				questions: keep.map(({ keep: _k, ...q }) => ({
					...q,
					showIf: q.showIf && keys.has(q.showIf.key) ? q.showIf : null,
				})),
			});
			await refresh();
			toast.success(
				`Added ${keep.length} question${keep.length === 1 ? "" : "s"}`,
			);
			props.onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	const targetName =
		props.target.scope === "business"
			? "every enquiry"
			: props.target.scope === "category"
				? `the ${props.target.category} category`
				: (business.products.find(
						(p) =>
							props.target.scope === "product" &&
							p.id === props.target.productId,
					)?.name ?? "this product");

	return (
		<Dialog open onOpenChange={(o) => !o && props.onClose()}>
			<DialogContent className="orbyte max-w-xl">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<Sparkles className="size-4 text-[var(--orb-royal)]" /> Suggested
						questions
					</DialogTitle>
					<DialogDescription>
						What the AI thinks you need to ask for {targetName} before quoting.
						Untick what you don't want and fix the wording.
					</DialogDescription>
				</DialogHeader>
				{items === null ? (
					<p className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
						<Loader2 className="size-4 animate-spin" /> Thinking about what a
						good salesperson would ask…
					</p>
				) : items.length === 0 ? (
					<p className="py-6 text-sm text-muted-foreground">
						Nothing new to suggest. Your questions already cover it.
					</p>
				) : (
					<ul className="max-h-[55vh] space-y-2 overflow-y-auto">
						{items.map((it, i) => (
							<li
								key={it.key}
								className={cn(
									"rounded-lg border p-3",
									!it.keep && "opacity-50",
								)}
							>
								<div className="flex items-start gap-2">
									<input
										type="checkbox"
										checked={it.keep}
										onChange={(e) =>
											setItems((xs) =>
												(xs ?? []).map((x, j) =>
													j === i ? { ...x, keep: e.target.checked } : x,
												),
											)
										}
										className="mt-2 accent-[var(--primary)]"
										aria-label={`Keep: ${it.label}`}
									/>
									<div className="min-w-0 flex-1 space-y-1">
										<Input
											value={it.label}
											onChange={(e) =>
												setItems((xs) =>
													(xs ?? []).map((x, j) =>
														j === i ? { ...x, label: e.target.value } : x,
													),
												)
											}
											className="h-8 text-sm"
										/>
										<p className="flex flex-wrap gap-x-2 text-[11px] text-muted-foreground">
											<span className="inline-flex items-center gap-1">
												<TypeIcon type={it.type} /> {typeInfo[it.type].label}
											</span>
											{it.options.length > 0 && it.type !== "yes_no" && (
												<span>{it.options.join(" / ")}</span>
											)}
											{!it.required && <span>optional</span>}
											{it.showIf && (
												<span>
													only if {it.showIf.key} = {it.showIf.equals}
												</span>
											)}
										</p>
										{it.hint && (
											<p className="text-[11px] text-muted-foreground italic">
												Note for AI: {it.hint}
											</p>
										)}
									</div>
								</div>
							</li>
						))}
					</ul>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={props.onClose}>
						Cancel
					</Button>
					<Button
						disabled={!items?.some((i) => i.keep) || add.isPending}
						onClick={accept}
					>
						{add.isPending && <Loader2 className="size-4 animate-spin" />}
						Add {items?.filter((i) => i.keep).length ?? 0} questions
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Labeled(props: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-1 text-sm">
			<span className="text-muted-foreground">{props.label}</span>
			{props.children}
		</div>
	);
}
