import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
	AlertTriangle,
	ListChecks,
	Loader2,
	Pencil,
	Plus,
	Sparkles,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
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
import type { Charge, PriceBuilder, PriceComponent } from "#/db/schema";
import { questionsFor } from "#/lib/intake";
import { formatMYR, parseMYR } from "#/lib/money";
import { builderWarnings, emptyBuilder } from "#/lib/price-builder";
import { chargeLabel, chargeSuffix } from "#/lib/quote-lines";
import type { Product } from "#/lib/types";
import { orpc } from "#/orpc/client";

type NewQuestion = {
	key: string;
	label: string;
	type: "text" | "number" | "date" | "single" | "multi" | "yes_no" | "file";
	options: string[];
	required: boolean;
	hint: string | null;
	showIf: { key: string; equals: string } | null;
};

type QuestionInfo = {
	key: string;
	label: string;
	type: string;
	options: string[];
};

function perText(c: PriceComponent, unit: string) {
	if (c.per.kind === "quantity") return ` / ${unit}`;
	if (c.per.kind === "answer") return ` / ${c.per.unit}`;
	return "";
}

/** The price list a custom item's drafts are built from (Products → item drawer). */
export function PriceListPanel({ product }: { product: Product }) {
	const { business } = useWorkspace();
	const builder = product.priceBuilder ?? null;
	const [editing, setEditing] = useState<{
		builder: PriceBuilder;
		newQuestions: NewQuestion[];
		drafted: boolean;
	} | null>(null);
	const suggest = useMutation(
		orpc.products.suggestPriceBuilder.mutationOptions(),
	);
	const questions: QuestionInfo[] = questionsFor(product, business.questions);
	const warnings = builder ? builderWarnings(builder, questions) : [];

	async function draft() {
		try {
			const res = await suggest.mutateAsync({ productId: product.id });
			setEditing({
				builder: res.builder,
				newQuestions: res.newQuestions,
				drafted: true,
			});
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Couldn't draft it");
		}
	}

	return (
		<section>
			<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				<ListChecks className="size-3.5" /> Price list for drafts
			</h3>
			{builder?.components.length ? (
				<div className="space-y-2 text-sm">
					<ul className="divide-y rounded-lg border">
						{builder.components.map((c) => (
							<li key={c.id} className="flex justify-between gap-3 px-3 py-1.5">
								<span className="min-w-0">
									{c.label}
									<span className="block text-[11px] text-muted-foreground">
										{c.when ? `If ${c.when.key} = ${c.when.equals}` : "Always"}
										{c.charge !== "one_time" && ` · ${chargeLabel[c.charge]}`}
									</span>
								</span>
								<span className="shrink-0 tabular-nums">
									{formatMYR(c.amountSen)}
									<span className="text-xs text-muted-foreground">
										{perText(c, product.unit)}
										{chargeSuffix[c.charge]}
									</span>
								</span>
							</li>
						))}
					</ul>
					<p className="text-xs text-muted-foreground">
						{builder.rate
							? `Work not on the list: AI estimates time × ${formatMYR(builder.rate.amountSen)}/${builder.rate.unit}, marked for staff to check.`
							: "Work not on the list is left for staff to price."}
						{builder.phases.length > 0 &&
							` Timeline: ${builder.phases.map((p) => p.name).join(" → ")}.`}
						{builder.payments.length > 0 &&
							` Payments: ${builder.payments.map((p) => `${p.percent}%`).join("/")}.`}
					</p>
					{warnings.length > 0 && (
						<ul className="space-y-1 rounded-md bg-status-review/10 px-3 py-2 text-xs">
							{warnings.map((w) => (
								<li key={w} className="flex gap-1.5">
									<AlertTriangle className="mt-0.5 size-3 shrink-0 text-status-review" />
									{w}
								</li>
							))}
						</ul>
					)}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No price list yet, so drafts for this item come in at RM 0 for staff
					to price. Let the AI draft one from your questions and trade, then
					adjust the numbers.
				</p>
			)}
			<div className="mt-2 flex flex-wrap gap-2">
				<Button
					size="sm"
					variant="outline"
					onClick={draft}
					disabled={suggest.isPending}
				>
					{suggest.isPending ? (
						<Loader2 className="size-4 animate-spin" />
					) : (
						<Sparkles className="size-4" />
					)}
					{builder ? "Redraft with AI" : "Draft with AI"}
				</Button>
				<Button
					size="sm"
					variant="outline"
					onClick={() =>
						setEditing({
							builder: builder ?? emptyBuilder(),
							newQuestions: [],
							drafted: false,
						})
					}
				>
					<Pencil className="size-4" /> {builder ? "Edit" : "Build manually"}
				</Button>
			</div>
			{editing && (
				<PriceListDialog
					product={product}
					questions={questions}
					initial={editing.builder}
					newQuestions={editing.newQuestions}
					drafted={editing.drafted}
					hasSaved={Boolean(builder)}
					onClose={() => setEditing(null)}
				/>
			)}
		</section>
	);
}

const newId = () =>
	`c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const rm = (sen: number) => (sen / 100).toFixed(2).replace(/\.00$/, "");

function PriceListDialog(props: {
	product: Product;
	questions: QuestionInfo[];
	initial: PriceBuilder;
	newQuestions: NewQuestion[];
	drafted: boolean;
	hasSaved: boolean;
	onClose: () => void;
}) {
	const { me } = useWorkspace();
	const queryClient = useQueryClient();
	const save = useMutation(
		orpc.products.savePriceBuilder.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.businesses.key() }),
		}),
	);
	const [b, setB] = useState<PriceBuilder>(props.initial);
	const [extra, setExtra] = useState(
		props.newQuestions.map((q) => ({ ...q, include: true })),
	);
	// Price boxes keep what staff type until they leave the field.
	const [typed, setTyped] = useState<Record<string, string>>({});

	const allQuestions: QuestionInfo[] = useMemo(
		() => [...props.questions, ...extra.filter((q) => q.include)],
		[props.questions, extra],
	);
	const warnings = builderWarnings(b, allQuestions);
	const countable = allQuestions.filter(
		(q) => q.type === "number" || q.type === "text",
	);
	const choosable = allQuestions.filter((q) =>
		["single", "multi", "yes_no"].includes(q.type),
	);

	const setPart = (id: string, change: Partial<PriceComponent>) =>
		setB((x) => ({
			...x,
			components: x.components.map((c) =>
				c.id === id ? { ...c, ...change } : c,
			),
		}));

	async function submit(remove = false) {
		if (!me) return toast.error("Choose who you are signed in as first");
		try {
			await save.mutateAsync({
				productId: props.product.id,
				builder: remove
					? null
					: {
							...b,
							assumptions: b.assumptions.map((a) => a.trim()).filter(Boolean),
							exclusions: b.exclusions.map((a) => a.trim()).filter(Boolean),
						},
				newQuestions: remove
					? []
					: extra
							.filter((q) => q.include)
							.map(({ include: _i, ...q }) => ({ ...q, onQuote: false })),
				actor: me.name,
			});
			toast.success(remove ? "Price list removed" : "Price list saved");
			props.onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	return (
		<Dialog open onOpenChange={(o) => !o && props.onClose()}>
			<DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<DialogTitle>Price list · {props.product.name}</DialogTitle>
					<DialogDescription>
						{props.drafted
							? "Drafted by AI for your trade. Check every number; nothing is used until you save."
							: "Drafts for this item are priced from these parts using the customer's answers. Staff still review every quote."}
					</DialogDescription>
				</DialogHeader>

				<div className="space-y-5 text-sm">
					<section className="space-y-2">
						<p className="font-medium">Parts</p>
						<ul className="space-y-2">
							{b.components.map((c) => (
								<li key={c.id} className="space-y-2 rounded-lg border p-2.5">
									<div className="flex gap-2">
										<Input
											aria-label="Part name"
											value={c.label}
											onChange={(e) => setPart(c.id, { label: e.target.value })}
											className="h-8 min-w-0 flex-1"
										/>
										<Button
											variant="ghost"
											size="icon"
											className="size-8"
											aria-label={`Remove ${c.label}`}
											onClick={() =>
												setB((x) => ({
													...x,
													components: x.components.filter((y) => y.id !== c.id),
												}))
											}
										>
											<Trash2 className="size-4" />
										</Button>
									</div>
									<div className="grid gap-2 sm:grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_4.5rem]">
										<Input
											aria-label="Price (RM)"
											inputMode="decimal"
											value={typed[c.id] ?? rm(c.amountSen)}
											onChange={(e) => {
												setTyped((t) => ({ ...t, [c.id]: e.target.value }));
												setPart(c.id, {
													amountSen: parseMYR(e.target.value) ?? 0,
												});
											}}
											onBlur={() => setTyped(({ [c.id]: _d, ...rest }) => rest)}
											className="h-8 text-right"
										/>
										<Select
											value={
												c.per.kind === "answer"
													? `answer:${c.per.key}`
													: c.per.kind
											}
											onValueChange={(v) =>
												setPart(c.id, {
													per: v.startsWith("answer:")
														? {
																kind: "answer",
																key: v.slice(7),
																unit:
																	c.per.kind === "answer" ? c.per.unit : "unit",
															}
														: { kind: v as "fixed" | "quantity" },
												})
											}
										>
											<SelectTrigger
												size="sm"
												aria-label="Priced"
												className="w-full"
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent position="popper">
												<SelectItem value="fixed">Flat amount</SelectItem>
												<SelectItem value="quantity">
													Per {props.product.unit} ordered
												</SelectItem>
												{countable.map((q) => (
													<SelectItem key={q.key} value={`answer:${q.key}`}>
														Per answer: {q.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Select
											value={
												c.when
													? `${c.when.key}\u0000${c.when.equals}`
													: "always"
											}
											onValueChange={(v) => {
												if (v === "always")
													return setPart(c.id, { when: null });
												const [key, equals] = v.split("\u0000");
												setPart(c.id, { when: { key, equals } });
											}}
										>
											<SelectTrigger
												size="sm"
												aria-label="Applies"
												className="w-full"
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent position="popper" className="max-h-72">
												<SelectItem value="always">Always included</SelectItem>
												{c.when &&
													!choosable.some(
														(q) =>
															q.key === c.when?.key &&
															q.options.includes(c.when.equals),
													) && (
														<SelectItem
															value={`${c.when.key}\u0000${c.when.equals}`}
														>
															If {c.when.key} = {c.when.equals}
														</SelectItem>
													)}
												{choosable.flatMap((q) =>
													(q.type === "yes_no" ? ["yes", "no"] : q.options).map(
														(o) => (
															<SelectItem
																key={`${q.key}:${o}`}
																value={`${q.key}\u0000${o}`}
															>
																If “{q.label}” = {o}
															</SelectItem>
														),
													),
												)}
											</SelectContent>
										</Select>
										<Select
											value={c.charge}
											onValueChange={(v) =>
												setPart(c.id, {
													charge: v as Charge,
													...(v !== "one_time" ? { weeks: null } : {}),
												})
											}
										>
											<SelectTrigger
												size="sm"
												aria-label="Charged"
												className="w-full"
											>
												<SelectValue />
											</SelectTrigger>
											<SelectContent position="popper">
												{(Object.keys(chargeLabel) as Charge[]).map((k) => (
													<SelectItem key={k} value={k}>
														{chargeLabel[k]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<Input
											aria-label="Weeks it adds"
											type="number"
											min={0}
											placeholder="wk"
											title="Weeks of work this adds to the timeline"
											disabled={c.charge !== "one_time"}
											value={c.weeks ?? ""}
											onChange={(e) =>
												setPart(c.id, {
													weeks:
														e.target.value === ""
															? null
															: Math.max(0, Number(e.target.value)),
												})
											}
											className="h-8 text-right"
										/>
									</div>
									{c.per.kind === "answer" && (
										<div className="flex items-center gap-2 text-xs text-muted-foreground">
											Unit word
											<Input
												aria-label="Unit word"
												value={c.per.unit}
												onChange={(e) =>
													setPart(c.id, {
														per: {
															kind: "answer",
															key: c.per.kind === "answer" ? c.per.key : "",
															unit: e.target.value,
														},
													})
												}
												className="h-7 w-28"
											/>
											<span>e.g. screen, sqft, user</span>
										</div>
									)}
								</li>
							))}
						</ul>
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								setB((x) => ({
									...x,
									components: [
										...x.components,
										{
											id: newId(),
											label: "New part",
											charge: "one_time",
											when: null,
											amountSen: 0,
											per: { kind: "fixed" },
											weeks: null,
											note: null,
										},
									],
								}))
							}
						>
							<Plus className="size-4" /> Add part
						</Button>
					</section>

					<section className="space-y-2">
						<label className="flex items-center gap-2">
							<input
								type="checkbox"
								checked={Boolean(b.rate)}
								onChange={(e) =>
									setB((x) => ({
										...x,
										rate: e.target.checked
											? { amountSen: 10000, unit: "hour" }
											: null,
									}))
								}
								className="accent-[var(--primary)]"
							/>
							Let the AI estimate work that isn't on the list (time × your rate)
						</label>
						{b.rate && (
							<div className="flex items-center gap-2 pl-6">
								RM
								<Input
									aria-label="Rate (RM)"
									inputMode="decimal"
									value={typed.rate ?? rm(b.rate.amountSen)}
									onChange={(e) => {
										setTyped((t) => ({ ...t, rate: e.target.value }));
										const amountSen = parseMYR(e.target.value) ?? 0;
										setB((x) =>
											x.rate ? { ...x, rate: { ...x.rate, amountSen } } : x,
										);
									}}
									onBlur={() => setTyped(({ rate: _r, ...rest }) => rest)}
									className="h-8 w-24 text-right"
								/>
								per
								<Select
									value={b.rate.unit}
									onValueChange={(unit) =>
										setB((x) =>
											x.rate
												? {
														...x,
														rate: { ...x.rate, unit: unit as "hour" | "day" },
													}
												: x,
										)
									}
								>
									<SelectTrigger
										size="sm"
										className="w-24"
										aria-label="Rate unit"
									>
										<SelectValue />
									</SelectTrigger>
									<SelectContent position="popper">
										<SelectItem value="hour">hour</SelectItem>
										<SelectItem value="day">day</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</section>

					<div className="grid gap-5 sm:grid-cols-2">
						<RowsEditor
							title="Timeline phases"
							hint="Leave empty if you don't quote timelines. Extra weeks go to the longest phase."
							rows={b.phases.map((p) => ({ text: p.name, n: p.weeks }))}
							nLabel="weeks"
							onChange={(rows) =>
								setB((x) => ({
									...x,
									phases: rows.map((r) => ({
										name: r.text,
										weeks: Math.max(1, r.n),
									})),
								}))
							}
							blank={{ text: "New phase", n: 1 }}
						/>
						<RowsEditor
							title="Payment schedule"
							hint="Percents add up to 100. Leave empty for payment in full."
							rows={b.payments.map((p) => ({ text: p.label, n: p.percent }))}
							nLabel="%"
							nFirst
							onChange={(rows) =>
								setB((x) => ({
									...x,
									payments: rows.map((r) => ({ label: r.text, percent: r.n })),
								}))
							}
							blank={{
								text: "On completion",
								n: Math.max(
									1,
									100 - b.payments.reduce((s, p) => s + p.percent, 0),
								),
							}}
						/>
					</div>

					<div className="grid gap-3 sm:grid-cols-2">
						<div className="space-y-1">
							<p className="font-medium">Assumptions</p>
							<Textarea
								aria-label="Assumptions, one per line"
								rows={3}
								value={b.assumptions.join("\n")}
								onChange={(e) =>
									setB((x) => ({
										...x,
										assumptions: e.target.value.split("\n"),
									}))
								}
							/>
						</div>
						<div className="space-y-1">
							<p className="font-medium">Not included</p>
							<Textarea
								aria-label="Exclusions, one per line"
								rows={3}
								value={b.exclusions.join("\n")}
								onChange={(e) =>
									setB((x) => ({
										...x,
										exclusions: e.target.value.split("\n"),
									}))
								}
							/>
						</div>
					</div>

					{extra.length > 0 && (
						<section className="space-y-1.5 rounded-lg bg-secondary/60 p-3">
							<p className="font-medium">Questions this price list needs</p>
							<p className="text-xs text-muted-foreground">
								Ticked ones are added to this item's questions, so the AI asks
								them before drafting.
							</p>
							{extra.map((q, i) => (
								<label key={q.key} className="flex items-start gap-2">
									<input
										type="checkbox"
										checked={q.include}
										onChange={(e) =>
											setExtra((xs) =>
												xs.map((x, idx) =>
													idx === i ? { ...x, include: e.target.checked } : x,
												),
											)
										}
										className="mt-1 accent-[var(--primary)]"
									/>
									<span>
										{q.label}
										<span className="block text-xs text-muted-foreground">
											{q.type}
											{q.options.length ? `: ${q.options.join(" / ")}` : ""}
										</span>
									</span>
								</label>
							))}
						</section>
					)}

					{warnings.length > 0 && (
						<ul className="space-y-1 rounded-md bg-status-review/10 px-3 py-2 text-xs">
							{warnings.map((w) => (
								<li key={w} className="flex gap-1.5">
									<AlertTriangle className="mt-0.5 size-3 shrink-0 text-status-review" />
									{w}
								</li>
							))}
						</ul>
					)}

					<div className="flex flex-wrap justify-between gap-2">
						{props.hasSaved ? (
							<Button
								variant="ghost"
								onClick={() => submit(true)}
								disabled={save.isPending}
							>
								Remove price list
							</Button>
						) : (
							<span />
						)}
						<div className="flex gap-2">
							<Button variant="ghost" onClick={props.onClose}>
								Cancel
							</Button>
							<Button
								onClick={() => submit()}
								disabled={save.isPending || b.components.length === 0}
							>
								{save.isPending && <Loader2 className="size-4 animate-spin" />}
								Save price list
							</Button>
						</div>
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}

/** Simple "name + number" rows, for phases and payments. */
function RowsEditor(props: {
	title: string;
	hint: string;
	rows: { text: string; n: number }[];
	nLabel: string;
	nFirst?: boolean;
	blank: { text: string; n: number };
	onChange: (rows: { text: string; n: number }[]) => void;
}) {
	const set = (i: number, change: Partial<{ text: string; n: number }>) =>
		props.onChange(
			props.rows.map((r, idx) => (idx === i ? { ...r, ...change } : r)),
		);
	return (
		<section className="space-y-1.5">
			<p className="font-medium">{props.title}</p>
			<p className="text-xs text-muted-foreground">{props.hint}</p>
			{props.rows.map((r, i) => {
				const n = (
					<Input
						aria-label={`${props.title} ${i + 1} ${props.nLabel}`}
						type="number"
						min={1}
						value={r.n}
						onChange={(e) =>
							set(i, {
								n: Math.max(1, Math.round(Number(e.target.value)) || 1),
							})
						}
						className="h-8 w-16 text-right"
					/>
				);
				return (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows have no id; order is the identity
					<div key={i} className="flex items-center gap-2">
						{props.nFirst && n}
						{props.nFirst && (
							<span className="text-xs text-muted-foreground">
								{props.nLabel}
							</span>
						)}
						<Input
							aria-label={`${props.title} ${i + 1}`}
							value={r.text}
							onChange={(e) => set(i, { text: e.target.value })}
							className="h-8 min-w-0 flex-1"
						/>
						{!props.nFirst && n}
						{!props.nFirst && (
							<span className="text-xs text-muted-foreground">
								{props.nLabel}
							</span>
						)}
						<Button
							variant="ghost"
							size="icon"
							className="size-8"
							aria-label={`Remove ${props.title} ${i + 1}`}
							onClick={() =>
								props.onChange(props.rows.filter((_, idx) => idx !== i))
							}
						>
							<Trash2 className="size-4" />
						</Button>
					</div>
				);
			})}
			<Button
				variant="outline"
				size="sm"
				onClick={() => props.onChange([...props.rows, props.blank])}
			>
				<Plus className="size-4" /> Add
			</Button>
		</section>
	);
}
