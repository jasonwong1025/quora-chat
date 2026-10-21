import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import type { PricingRuleConfig, RequiredField } from "#/db/schema";
import { formatMYR, parseMYR } from "#/lib/money";
import type { PricingRule, Product } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/products")({
	component: Products,
});

function Products() {
	const { business } = useWorkspace();
	const [editing, setEditing] = useState<Product | "new" | null>(null);

	const categories = [...new Set(business.products.map((p) => p.category))];

	return (
		<div className="mx-auto max-w-6xl p-4 sm:p-8">
			<PageHeader
				title="Products"
				badge="New module"
				description="Your catalog and pricing rules. The Quotation module reads prices from here. The AI never sets prices."
				actions={
					<Button onClick={() => setEditing("new")}>
						<Plus className="size-4" /> Add product
					</Button>
				}
			/>

			<Tabs defaultValue="catalog">
				<TabsList>
					<TabsTrigger value="catalog">
						Catalog ({business.products.length})
					</TabsTrigger>
					<TabsTrigger value="rules">
						Pricing rules ({business.rules.length})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="catalog" className="space-y-6 pt-2">
					{categories.map((cat) => (
						<section key={cat}>
							<h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
								{cat}
							</h2>
							<div className="overflow-x-auto rounded-xl border bg-card">
								<table className="w-full min-w-[560px] table-fixed text-sm">
									<colgroup>
										<col />
										<col className="w-36" />
										<col className="w-[30%]" />
										<col className="w-24" />
										<col className="w-12" />
									</colgroup>
									<thead className="border-b text-left text-xs text-muted-foreground">
										<tr>
											<th className="px-4 py-2 font-medium">Product</th>
											<th className="px-4 py-2 text-right font-medium">
												Price
											</th>
											<th className="px-4 py-2 font-medium">
												Customer must tell us
											</th>
											<th className="px-4 py-2 font-medium">Status</th>
											<th className="w-10" />
										</tr>
									</thead>
									<tbody className="divide-y">
										{business.products
											.filter((p) => p.category === cat)
											.map((p) => (
												<ProductRow
													key={p.id}
													product={p}
													onEdit={() => setEditing(p)}
												/>
											))}
									</tbody>
								</table>
							</div>
						</section>
					))}
				</TabsContent>

				<TabsContent value="rules" className="pt-2">
					<RuleList rules={business.rules} products={business.products} />
				</TabsContent>
			</Tabs>

			<ProductDialog
				key={editing === "new" ? "new" : (editing?.id ?? "none")}
				product={editing}
				categories={categories}
				onClose={() => setEditing(null)}
			/>
		</div>
	);
}

function ProductRow({
	product: p,
	onEdit,
}: {
	product: Product;
	onEdit: () => void;
}) {
	const { me } = useWorkspace();
	const queryClient = useQueryClient();
	const update = useMutation(
		orpc.products.update.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.businesses.key() }),
		}),
	);
	return (
		<tr className={cn("align-top", !p.active && "opacity-55")}>
			<td className="px-4 py-3">
				<p className="font-medium">{p.name}</p>
				<p className="text-xs text-muted-foreground">{p.description}</p>
			</td>
			<td className="px-4 py-3 text-right whitespace-nowrap tabular-nums">
				{formatMYR(p.unitPriceSen)}
				<span className="text-xs text-muted-foreground"> / {p.unit}</span>
			</td>
			<td className="px-4 py-3">
				<div className="flex flex-wrap gap-1">
					{p.requiredFields.length === 0 && (
						<span className="text-xs text-muted-foreground">Nothing extra</span>
					)}
					{p.requiredFields.map((f) => (
						<span
							key={f.key}
							title={f.options?.join(" / ")}
							className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
						>
							{f.label}
							{f.options && ` (${f.options.length})`}
						</span>
					))}
				</div>
			</td>
			<td className="px-4 py-3">
				<button
					type="button"
					disabled={update.isPending}
					onClick={() =>
						update.mutate({
							productId: p.id,
							product: { active: !p.active },
							actor: me?.name ?? "Staff",
						})
					}
					className={cn(
						"rounded-full px-2 py-0.5 text-xs font-medium",
						p.active
							? "bg-status-approved/15 text-status-approved"
							: "bg-muted text-muted-foreground",
					)}
				>
					{p.active ? "Active" : "Hidden"}
				</button>
			</td>
			<td className="py-2 pr-2">
				<Button variant="ghost" size="icon" className="size-8" onClick={onEdit}>
					<Pencil className="size-4" />
				</Button>
			</td>
		</tr>
	);
}

type FieldDraft = { key: string; label: string; options: string };

function toKey(label: string) {
	return label
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_|_$/g, "");
}

function ProductDialog(props: {
	product: Product | "new" | null;
	categories: string[];
	onClose: () => void;
}) {
	const { business, me } = useWorkspace();
	const queryClient = useQueryClient();
	const existing = props.product === "new" ? null : props.product;
	const [form, setForm] = useState({
		name: existing?.name ?? "",
		category: existing?.category ?? props.categories[0] ?? "",
		description: existing?.description ?? "",
		unit: existing?.unit ?? "pc",
		price: existing ? (existing.unitPriceSen / 100).toFixed(2) : "",
		active: existing?.active ?? true,
	});
	const [fields, setFields] = useState<FieldDraft[]>(
		existing?.requiredFields.map((f) => ({
			key: f.key,
			label: f.label,
			options: f.options?.join(", ") ?? "",
		})) ?? [],
	);

	const onSuccess = () => {
		queryClient.invalidateQueries({ queryKey: orpc.businesses.key() });
		props.onClose();
	};
	const create = useMutation(
		orpc.products.create.mutationOptions({ onSuccess }),
	);
	const update = useMutation(
		orpc.products.update.mutationOptions({ onSuccess }),
	);
	const pending = create.isPending || update.isPending;

	async function save() {
		const unitPriceSen = parseMYR(form.price);
		if (!form.name.trim() || unitPriceSen === null)
			return toast.error("Name and a valid price are required");
		const requiredFields: RequiredField[] = fields
			.filter((f) => f.label.trim())
			.map((f) => {
				const options = f.options
					.split(",")
					.map((o) => o.trim())
					.filter(Boolean);
				return {
					key: f.key || toKey(f.label),
					label: f.label.trim(),
					...(options.length ? { options } : {}),
				};
			});
		const product = {
			name: form.name.trim(),
			category: form.category.trim() || "General",
			description: form.description.trim(),
			unit: form.unit.trim() || "pc",
			unitPriceSen,
			requiredFields,
			active: form.active,
		};
		const actor = me?.name ?? "Staff";
		try {
			if (existing) {
				await update.mutateAsync({ productId: existing.id, product, actor });
				toast.success(`${product.name} updated`);
			} else {
				await create.mutateAsync({ businessId: business.id, product, actor });
				toast.success(`${product.name} added`);
			}
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Save failed");
		}
	}

	const set = (patch: Partial<typeof form>) =>
		setForm((f) => ({ ...f, ...patch }));

	return (
		<Dialog
			open={props.product !== null}
			onOpenChange={(o) => !o && props.onClose()}
		>
			<DialogContent className="orbyte max-w-xl">
				<DialogHeader>
					<DialogTitle>{existing ? "Edit product" : "Add product"}</DialogTitle>
					<DialogDescription>
						The AI matches customer messages to these products. Prices are only
						ever taken from here.
					</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3 sm:grid-cols-2">
					<Field label="Name" className="sm:col-span-2">
						<Input
							value={form.name}
							onChange={(e) => set({ name: e.target.value })}
						/>
					</Field>
					<Field label="Category">
						<Input
							value={form.category}
							list="product-categories"
							onChange={(e) => set({ category: e.target.value })}
						/>
						<datalist id="product-categories">
							{props.categories.map((c) => (
								<option key={c} value={c} />
							))}
						</datalist>
					</Field>
					<div className="grid grid-cols-2 gap-3">
						<Field label="Price (RM)">
							<Input
								inputMode="decimal"
								value={form.price}
								onChange={(e) => set({ price: e.target.value })}
							/>
						</Field>
						<Field label="Per">
							<Input
								value={form.unit}
								onChange={(e) => set({ unit: e.target.value })}
							/>
						</Field>
					</div>
					<Field label="Description" className="sm:col-span-2">
						<Textarea
							rows={2}
							value={form.description}
							onChange={(e) => set({ description: e.target.value })}
						/>
					</Field>
				</div>

				<div>
					<p className="text-sm font-medium">Details the customer must give</p>
					<p className="mb-2 text-xs text-muted-foreground">
						If a customer leaves one out, the AI asks for it before quoting.
						Options are comma-separated.
					</p>
					<div className="space-y-2">
						{fields.map((f, i) => (
							<div key={`${f.key}-${i}`} className="flex gap-2">
								<Input
									placeholder="e.g. Paper type"
									value={f.label}
									onChange={(e) =>
										setFields((fs) =>
											fs.map((x, j) =>
												j === i ? { ...x, label: e.target.value } : x,
											),
										)
									}
								/>
								<Input
									placeholder="Options (optional)"
									value={f.options}
									onChange={(e) =>
										setFields((fs) =>
											fs.map((x, j) =>
												j === i ? { ...x, options: e.target.value } : x,
											),
										)
									}
								/>
								<Button
									variant="ghost"
									size="icon"
									className="shrink-0"
									onClick={() =>
										setFields((fs) => fs.filter((_, j) => j !== i))
									}
								>
									<Trash2 className="size-4" />
								</Button>
							</div>
						))}
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								setFields((fs) => [...fs, { key: "", label: "", options: "" }])
							}
						>
							<Plus className="size-4" /> Add detail
						</Button>
					</div>
				</div>

				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={form.active}
						onChange={(e) => set({ active: e.target.checked })}
						className="accent-[var(--primary)]"
					/>
					Active (the AI can quote it)
				</label>

				<div className="flex justify-end gap-2">
					<Button variant="ghost" onClick={props.onClose}>
						Cancel
					</Button>
					<Button onClick={save} disabled={pending}>
						{pending && <Loader2 className="size-4 animate-spin" />}
						Save
					</Button>
				</div>
			</DialogContent>
		</Dialog>
	);
}

function Field(props: {
	label: string;
	className?: string;
	children: React.ReactNode;
}) {
	return (
		<div className={cn("space-y-1 text-sm", props.className)}>
			<span className="text-muted-foreground">{props.label}</span>
			{props.children}
		</div>
	);
}

const ruleKind: Record<PricingRuleConfig["kind"], string> = {
	tier: "Volume pricing",
	minimum_charge: "Minimum charge",
	surcharge: "Surcharge",
	requires_assessment: "Needs assessment",
};

function ruleDetail(c: PricingRuleConfig) {
	switch (c.kind) {
		case "tier":
			return c.tiers
				.map((t) => `${t.minQty}+ → ${formatMYR(t.unitPriceSen)}`)
				.join(" · ");
		case "minimum_charge":
			return `At least ${formatMYR(c.minSen)} per line`;
		case "surcharge":
			return `${c.label}: when ${c.when.field} = ${c.when.equals}, ${
				c.amountSen ? `+${formatMYR(c.amountSen)}` : ""
			}${c.perUnitSen ? `+${formatMYR(c.perUnitSen)} per unit` : ""}`;
		case "requires_assessment":
			return c.when
				? "field" in c.when
					? `When ${c.when.field} = ${c.when.equals}: ${c.reason}`
					: `Above ${c.when.quantityAbove} units: ${c.reason}`
				: c.reason;
	}
}

function RuleList(props: { rules: PricingRule[]; products: Product[] }) {
	const queryClient = useQueryClient();
	const remove = useMutation(
		orpc.rules.delete.mutationOptions({
			onSuccess: () =>
				queryClient.invalidateQueries({ queryKey: orpc.businesses.key() }),
		}),
	);
	return (
		<div className="grid gap-3 md:grid-cols-2">
			{props.rules.map((r) => (
				<div key={r.id} className="rounded-xl border bg-card p-4">
					<div className="flex items-start justify-between gap-2">
						<div>
							<span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-primary">
								{ruleKind[r.config.kind]}
							</span>
							<p className="mt-2 text-sm font-medium">{r.description}</p>
							<p className="text-xs text-muted-foreground">
								{props.products.find((p) => p.id === r.productId)?.name ??
									"All products"}
							</p>
						</div>
						<Button
							variant="ghost"
							size="icon"
							className="size-8 shrink-0"
							disabled={remove.isPending}
							onClick={() => remove.mutate({ ruleId: r.id })}
							title="Delete rule"
						>
							<Trash2 className="size-4" />
						</Button>
					</div>
					<p className="mt-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
						{ruleDetail(r.config)}
					</p>
				</div>
			))}
		</div>
	);
}
