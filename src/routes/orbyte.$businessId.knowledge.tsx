import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	BookOpen,
	Bot,
	Globe,
	Loader2,
	Lock,
	Plus,
	Search,
	ShieldCheck,
	Trash2,
	Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { Textarea } from "#/components/ui/textarea";
import type { Passage } from "#/lib/knowledge";
import { dayLabel } from "#/lib/time";
import type { KnowledgeDocRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/knowledge")({
	validateSearch: z.object({ d: z.string().optional() }),
	component: Knowledge,
});

type Visibility = "internal" | "public";
type Draft = {
	id?: string;
	title: string;
	category: string;
	visibility: Visibility;
	body: string;
};

function VisibilityChip({ visibility }: { visibility: Visibility }) {
	return visibility === "public" ? (
		<span className="inline-flex items-center gap-1 bg-status-approved/15 px-2 py-0.5 text-[11px] font-medium text-status-approved">
			<Globe className="size-3" /> Public
		</span>
	) : (
		<span className="inline-flex items-center gap-1 bg-[var(--orb-navy)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--orb-navy)]">
			<Lock className="size-3" /> Internal
		</span>
	);
}

function Knowledge() {
	const { business, me } = useWorkspace();
	const { d } = Route.useSearch();
	const navigate = Route.useNavigate();
	const docs = useQuery(
		orpc.knowledge.list.queryOptions({ input: { businessId: business.id } }),
	);
	const [filter, setFilter] = useState("");
	const [only, setOnly] = useState<"all" | Visibility>("all");
	const canEdit = Boolean(me?.canApprove);
	const all = docs.data ?? [];
	const shown = all.filter(
		(doc) =>
			(only === "all" || doc.visibility === only) &&
			`${doc.title} ${doc.category} ${doc.body}`
				.toLowerCase()
				.includes(filter.trim().toLowerCase()),
	);
	const count = (v: Visibility) => all.filter((x) => x.visibility === v).length;
	const categories = [...new Set(shown.map((doc) => doc.category))];
	const selected = d === "new" ? null : (all.find((x) => x.id === d) ?? null);
	const open = (id: string | undefined) =>
		navigate({ search: id ? { d: id } : {}, replace: true });

	return (
		<div className="p-4 sm:p-6">
			<PageHeader
				title="Knowledge base"
				badge="New"
				description="SOPs, policies and specs the AI uses when your team tags @AI in a job chat. Internal documents never reach customers. Mark a document Public to let the WhatsApp assistant answer customers from it."
				actions={
					canEdit ? (
						<Button onClick={() => open("new")}>
							<Plus className="size-4" /> Add document
						</Button>
					) : undefined
				}
			/>

			<Boundary businessId={business.id} />

			<div className="mt-4 grid gap-4 lg:grid-cols-5">
				<section
					className={cn(
						"min-w-0 space-y-3 lg:col-span-2",
						d && "hidden lg:block",
					)}
					aria-label="Documents"
				>
					<div className="relative">
						<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
						<Input
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
							placeholder="Filter documents"
							aria-label="Filter documents"
							className="bg-card pl-9"
						/>
					</div>
					<fieldset className="flex flex-wrap gap-1.5">
						<legend className="sr-only">Show documents</legend>
						{(
							[
								["all", `All ${all.length}`],
								["internal", `Internal ${count("internal")}`],
								["public", `Public ${count("public")}`],
							] as const
						).map(([v, label]) => (
							<button
								key={v}
								type="button"
								aria-pressed={only === v}
								onClick={() => setOnly(v)}
								className={cn(
									"border px-3 py-1 text-xs",
									only === v
										? "border-primary bg-primary text-primary-foreground"
										: "bg-card hover:bg-muted",
								)}
							>
								{label}
							</button>
						))}
					</fieldset>
					{docs.isPending ? (
						<p className="flex items-center gap-2 text-sm text-muted-foreground">
							<Loader2 className="size-4 animate-spin" /> Loading…
						</p>
					) : shown.length === 0 ? (
						<div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
							<BookOpen className="mx-auto mb-2 size-8" />
							{all.length
								? "No documents match."
								: canEdit
									? "No documents yet. Add your SOPs and policies so the team AI can use them."
									: "No documents yet. An approver can add them."}
						</div>
					) : (
						categories.map((category) => (
							<div key={category}>
								<h2 className="mb-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
									{category}
								</h2>
								<ul className="divide-y overflow-hidden rounded-xl border bg-card">
									{shown
										.filter((doc) => doc.category === category)
										.map((doc) => (
											<li key={doc.id}>
												<button
													type="button"
													onClick={() => open(doc.id)}
													aria-current={doc.id === d ? "true" : undefined}
													className={cn(
														"flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-muted/60",
														doc.id === d && "bg-secondary",
													)}
												>
													<BookOpen className="mt-0.5 size-4 shrink-0 text-primary" />
													<span className="min-w-0 flex-1">
														<span className="block truncate text-sm font-medium">
															{doc.title}
														</span>
														<span className="line-clamp-1 text-xs text-muted-foreground">
															{doc.body}
														</span>
													</span>
													<VisibilityChip visibility={doc.visibility} />
												</button>
											</li>
										))}
								</ul>
							</div>
						))
					)}
				</section>

				<section
					className={cn("min-w-0 lg:col-span-3", !d && "hidden lg:block")}
					aria-label="Document"
				>
					{d === "new" && canEdit ? (
						<DocEditor
							key="new"
							initial={{
								title: "",
								category: "",
								visibility: "internal",
								body: "",
							}}
							categories={[...new Set(all.map((doc) => doc.category))]}
							onDone={(id) => open(id)}
							onCancel={() => open(undefined)}
						/>
					) : selected ? (
						<DocView
							key={selected.id}
							doc={selected}
							canEdit={canEdit}
							categories={[...new Set(all.map((doc) => doc.category))]}
							onBack={() => open(undefined)}
						/>
					) : (
						<div className="flex h-full min-h-40 items-center justify-center rounded-xl border border-dashed bg-card p-8 text-sm text-muted-foreground">
							Select a document to read it.
						</div>
					)}
				</section>
			</div>
		</div>
	);
}

/** Shows, for a sample question, what each AI is allowed to read. */
function Boundary({ businessId }: { businessId: string }) {
	const [query, setQuery] = useState("");
	const preview = useMutation(orpc.knowledge.preview.mutationOptions());
	return (
		<section className="rounded-xl border bg-card p-4">
			<h2 className="flex items-center gap-2 text-sm font-semibold">
				<ShieldCheck className="size-4 text-primary" /> Who can read what
			</h2>
			<p className="mt-1 text-xs text-muted-foreground">
				Type a question to see what each assistant would be given. The
				customer's assistant only ever receives Public documents; this is
				enforced in code, not by asking the AI nicely.
			</p>
			<form
				className="mt-3 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (query.trim()) preview.mutate({ businessId, query });
				}}
			>
				<Input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="e.g. what is our refund policy?"
					aria-label="Test question"
				/>
				<Button
					type="submit"
					variant="outline"
					disabled={!query.trim() || preview.isPending}
				>
					{preview.isPending && <Loader2 className="size-4 animate-spin" />}
					Test
				</Button>
			</form>
			{preview.data && (
				<div className="mt-3 grid gap-3 md:grid-cols-2">
					<Seen
						title="Team AI (job chat)"
						icon={<Users className="size-3.5" />}
						passages={preview.data.team}
					/>
					<Seen
						title="Customer AI (WhatsApp)"
						icon={<Bot className="size-3.5" />}
						passages={preview.data.customer}
					/>
				</div>
			)}
		</section>
	);
}

function Seen(props: {
	title: string;
	icon: React.ReactNode;
	passages: Passage[];
}) {
	return (
		<div className="min-w-0 rounded-lg bg-muted/50 p-3">
			<p className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
				{props.icon} {props.title}
			</p>
			{props.passages.length === 0 ? (
				<p className="text-xs text-muted-foreground">Nothing it may use.</p>
			) : (
				<ul className="space-y-2">
					{props.passages.map((p) => (
						<li key={`${p.docId}-${p.text.slice(0, 20)}`} className="text-xs">
							<span className="font-medium">{p.title}</span>
							<span className="line-clamp-2 text-muted-foreground">
								{p.text}
							</span>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function DocView(props: {
	doc: KnowledgeDocRow;
	canEdit: boolean;
	categories: string[];
	onBack: () => void;
}) {
	const { doc } = props;
	const [editing, setEditing] = useState(false);
	if (editing)
		return (
			<DocEditor
				initial={doc}
				categories={props.categories}
				onDone={() => setEditing(false)}
				onCancel={() => setEditing(false)}
			/>
		);
	return (
		<article className="space-y-3 rounded-xl border bg-card p-5">
			<button
				type="button"
				onClick={props.onBack}
				className="text-sm text-primary lg:hidden"
			>
				← Documents
			</button>
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<p className="text-xs text-muted-foreground">{doc.category}</p>
					<h2 className="text-lg font-semibold break-words">{doc.title}</h2>
					<p className="text-xs text-muted-foreground">
						Updated {dayLabel(doc.updatedAt)}
						{doc.updatedBy ? ` by ${doc.updatedBy}` : ""}
					</p>
				</div>
				<div className="flex items-center gap-2">
					<VisibilityChip visibility={doc.visibility} />
					{props.canEdit && (
						<Button
							size="sm"
							variant="outline"
							onClick={() => setEditing(true)}
						>
							Edit
						</Button>
					)}
				</div>
			</div>
			<div className="text-sm leading-relaxed whitespace-pre-wrap">
				{doc.body}
			</div>
		</article>
	);
}

function DocEditor(props: {
	initial: Draft;
	categories: string[];
	onDone: (id: string) => void;
	onCancel: () => void;
}) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const refresh = () =>
		queryClient.invalidateQueries({ queryKey: orpc.knowledge.key() });
	const save = useMutation(
		orpc.knowledge.save.mutationOptions({ onSuccess: refresh }),
	);
	const remove = useMutation(
		orpc.knowledge.delete.mutationOptions({ onSuccess: refresh }),
	);
	const [draft, setDraft] = useState<Draft>({
		id: props.initial.id,
		title: props.initial.title,
		category: props.initial.category,
		visibility: props.initial.visibility,
		body: props.initial.body,
	});
	const set = (patch: Partial<Draft>) => setDraft((x) => ({ ...x, ...patch }));
	const listId = "knowledge-categories";

	async function submit() {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			const row = await save.mutateAsync({
				businessId: business.id,
				staffId: me.id,
				...draft,
			});
			toast.success("Saved");
			props.onDone(row.id);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	return (
		<form
			className="space-y-3 rounded-xl border bg-card p-5"
			onSubmit={(e) => {
				e.preventDefault();
				submit();
			}}
		>
			<h2 className="font-semibold">
				{draft.id ? "Edit document" : "New document"}
			</h2>
			<div className="space-y-1.5">
				<label htmlFor="kb-title" className="text-sm font-medium">
					Title
				</label>
				<Input
					id="kb-title"
					value={draft.title}
					onChange={(e) => set({ title: e.target.value })}
					placeholder="e.g. Artwork checks before printing"
					required
				/>
			</div>
			<div className="grid gap-3 sm:grid-cols-2">
				<div className="space-y-1.5">
					<label htmlFor="kb-category" className="text-sm font-medium">
						Category
					</label>
					<Input
						id="kb-category"
						list={listId}
						value={draft.category}
						onChange={(e) => set({ category: e.target.value })}
						placeholder="SOP, Policy, FAQ…"
					/>
					<datalist id={listId}>
						{props.categories.map((c) => (
							<option key={c} value={c} />
						))}
					</datalist>
				</div>
				<div className="space-y-1.5">
					<label htmlFor="kb-visibility" className="text-sm font-medium">
						Who can use it
					</label>
					<Select
						value={draft.visibility}
						onValueChange={(v) => set({ visibility: v as Visibility })}
					>
						<SelectTrigger id="kb-visibility" className="w-full">
							<SelectValue />
						</SelectTrigger>
						<SelectContent position="popper">
							<SelectItem value="internal">Internal: team AI only</SelectItem>
							<SelectItem value="public">
								Public: customer AI can use it too
							</SelectItem>
						</SelectContent>
					</Select>
					{draft.visibility === "public" && (
						<p className="flex items-start gap-1.5 rounded-md bg-status-review/10 px-2 py-1.5 text-xs">
							<Globe className="mt-0.5 size-3.5 shrink-0" />
							Customers' WhatsApp assistant may quote this to anyone. Keep
							prices, margins, discounts and internal steps out of it.
						</p>
					)}
				</div>
			</div>
			<div className="space-y-1.5">
				<label htmlFor="kb-body" className="text-sm font-medium">
					Content
				</label>
				<Textarea
					id="kb-body"
					value={draft.body}
					onChange={(e) => set({ body: e.target.value })}
					rows={12}
					placeholder="Write it the way you'd brief a new colleague. Blank lines separate sections."
					required
				/>
			</div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				{draft.id && me ? (
					<Button
						type="button"
						variant="ghost"
						className="text-destructive"
						disabled={remove.isPending}
						onClick={async () => {
							if (!draft.id) return;
							try {
								await remove.mutateAsync({
									businessId: business.id,
									staffId: me.id,
									id: draft.id,
								});
								toast.success("Deleted");
								props.onCancel();
							} catch (err) {
								toast.error(err instanceof Error ? err.message : "Failed");
							}
						}}
					>
						<Trash2 className="size-4" /> Delete
					</Button>
				) : (
					<span />
				)}
				<div className="flex gap-2">
					<Button type="button" variant="ghost" onClick={props.onCancel}>
						Cancel
					</Button>
					<Button type="submit" disabled={save.isPending}>
						{save.isPending && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</div>
			</div>
		</form>
	);
}
