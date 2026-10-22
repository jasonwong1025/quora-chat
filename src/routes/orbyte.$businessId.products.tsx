import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	Eye,
	EyeOff,
	ImagePlus,
	Loader2,
	MoreHorizontal,
	PackageSearch,
	Pencil,
	Plus,
	Search,
	Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
	fileToThumb,
	ProductThumb,
	productImageUrl,
} from "#/components/orbyte/product-image";
import { QuestionList, questionsOf } from "#/components/orbyte/question-editor";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import { Input } from "#/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetTitle,
} from "#/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { Textarea } from "#/components/ui/textarea";
import type { PricingRuleConfig } from "#/db/schema";
import { formatMYR, parseMYR } from "#/lib/money";
import { suggestSku, uniqueSku } from "#/lib/sku";
import type { PricingRule, Product } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/products")({
	// ?p=<productId> opens that product's detail drawer.
	validateSearch: z.object({ p: z.string().optional() }),
	component: Products,
});

const available = (p: Product) => p.stockOnHand - p.stockReserved;

function useRefreshBusiness() {
	const queryClient = useQueryClient();
	return () =>
		queryClient.invalidateQueries({ queryKey: orpc.businesses.key() });
}

// --- Page ------------------------------------------------------------------------

type SortKey =
	| "name"
	| "sku"
	| "category"
	| "price"
	| "onHand"
	| "reserved"
	| "available";

const sortValue: Record<SortKey, (p: Product) => string | number> = {
	name: (p) => p.name.toLowerCase(),
	sku: (p) => p.sku,
	category: (p) => p.category.toLowerCase(),
	price: (p) => p.unitPriceSen,
	// Services have no stock; keep them below every stock item.
	onHand: (p) => (p.type === "stock" ? p.stockOnHand : -Infinity),
	reserved: (p) => (p.type === "stock" ? p.stockReserved : -Infinity),
	available: (p) => (p.type === "stock" ? available(p) : -Infinity),
};

function Products() {
	const { business } = useWorkspace();
	const { p: openId } = Route.useSearch();
	const navigate = Route.useNavigate();
	const [editing, setEditing] = useState<Product | "new" | null>(null);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("all");
	const [unit, setUnit] = useState("all");
	const [type, setType] = useState("all");
	const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({
		key: "sku",
		dir: 1,
	});

	const products = business.products;
	const categories = useMemo(
		() => [...new Set(products.map((p) => p.category))].sort(),
		[products],
	);
	const units = useMemo(
		() => [...new Set(products.map((p) => p.unit))].sort(),
		[products],
	);

	const rows = useMemo(() => {
		const q = query.trim().toLowerCase();
		const get = sortValue[sort.key];
		return products
			.filter(
				(p) =>
					(!q ||
						[p.name, p.sku, p.category, p.description].some((s) =>
							s.toLowerCase().includes(q),
						)) &&
					(category === "all" || p.category === category) &&
					(unit === "all" || p.unit === unit) &&
					(type === "all" || p.type === type),
			)
			.sort((a, b) => {
				const x = get(a);
				const y = get(b);
				return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
			});
	}, [products, query, category, unit, type, sort]);

	const open = products.find((p) => p.id === openId);
	const setOpen = (id: string | undefined) =>
		navigate({ search: { p: id }, replace: true });
	const toggleSort = (key: SortKey) =>
		setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }));

	const stockItems = products.filter((p) => p.type === "stock");
	const outOfStock = stockItems.filter((p) => available(p) <= 0).length;

	return (
		<div className="p-4 sm:p-6">
			<PageHeader
				title="Products"
				badge="New module"
				description="Items and services with SKUs, prices and stock. Quotations only use this list, and prices always come from here, never from the AI."
				actions={
					<Button onClick={() => setEditing("new")}>
						<Plus className="size-4" /> Add product
					</Button>
				}
			/>

			<Tabs defaultValue="items">
				<TabsList>
					<TabsTrigger value="items">Item list ({products.length})</TabsTrigger>
					<TabsTrigger value="questions">
						Questions ({business.questions.length})
					</TabsTrigger>
					<TabsTrigger value="rules">
						Pricing rules ({business.rules.length})
					</TabsTrigger>
				</TabsList>

				<TabsContent value="items" className="space-y-4 pt-2">
					<div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted-foreground">
						<span>
							<b className="text-foreground">{stockItems.length}</b> stock items
						</span>
						<span>
							<b className="text-foreground">
								{products.length - stockItems.length}
							</b>{" "}
							services
						</span>
						{outOfStock > 0 && (
							<span className="text-red-600">
								<b>{outOfStock}</b> out of stock
							</span>
						)}
					</div>

					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
						<FilterField label="Search" htmlFor="product-search">
							<div className="relative">
								<Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
								<Input
									id="product-search"
									value={query}
									onChange={(e) => setQuery(e.target.value)}
									placeholder="Search SKU, name, category, description"
									className="bg-card pl-9"
								/>
							</div>
						</FilterField>
						<FilterSelect
							label="Category"
							value={category}
							onChange={setCategory}
							all="All categories"
							options={categories.map((c) => [c, c])}
						/>
						<FilterSelect
							label="Type"
							value={type}
							onChange={setType}
							all="All types"
							options={[
								["stock", "Stock items"],
								["service", "Services"],
							]}
						/>
						<FilterSelect
							label="Unit"
							value={unit}
							onChange={setUnit}
							all="All units"
							options={units.map((u) => [u, u])}
						/>
					</div>

					<div className="overflow-x-auto rounded-xl border bg-card">
						{/* The fixed columns add up to ~910px; the minimum width leaves the
						    Name column ~250px so names don't wrap one letter per line. */}
						<table className="w-full min-w-[1160px] table-fixed text-sm">
							<colgroup>
								<col className="w-20" />
								<col />
								<col className="w-40" />
								<col className="w-48" />
								<col className="w-36" />
								<col className="w-24" />
								<col className="w-24" />
								<col className="w-24" />
								<col className="w-16" />
							</colgroup>
							<thead className="border-b text-left text-xs text-muted-foreground">
								<tr>
									<th className="px-4 py-3 font-medium">Image</th>
									<SortHeader k="name" sort={sort} onSort={toggleSort}>
										Name
									</SortHeader>
									<SortHeader k="sku" sort={sort} onSort={toggleSort}>
										SKU
									</SortHeader>
									<SortHeader k="category" sort={sort} onSort={toggleSort}>
										Category
									</SortHeader>
									<SortHeader k="price" sort={sort} onSort={toggleSort}>
										Selling price
									</SortHeader>
									<SortHeader k="onHand" sort={sort} onSort={toggleSort}>
										Inventory
									</SortHeader>
									<SortHeader k="reserved" sort={sort} onSort={toggleSort}>
										Reserved
									</SortHeader>
									<SortHeader k="available" sort={sort} onSort={toggleSort}>
										Available
									</SortHeader>
									<th className="px-2 py-3 text-center font-medium">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{rows.map((p) => (
									<ProductRow
										key={p.id}
										product={p}
										categories={categories}
										onOpen={() => setOpen(p.id)}
										onEdit={() => setEditing(p)}
									/>
								))}
								{rows.length === 0 && (
									<tr>
										<td
											colSpan={9}
											className="p-10 text-center text-sm text-muted-foreground"
										>
											<PackageSearch className="mx-auto mb-2 size-8" />
											No products match these filters.
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
					<p className="text-xs text-muted-foreground">
						Showing {rows.length} of {products.length}. Click a row for details,
						stock moves and pricing rules.
					</p>
				</TabsContent>

				<TabsContent value="questions" className="pt-2">
					<QuestionsTab categories={categories} onOpenProduct={setOpen} />
				</TabsContent>

				<TabsContent value="rules" className="pt-2">
					<RuleList rules={business.rules} products={products} />
				</TabsContent>
			</Tabs>

			<ProductSheet
				key={open?.id ?? "none"}
				product={open}
				onClose={() => setOpen(undefined)}
				onEdit={(p) => setEditing(p)}
			/>
			<ProductDialog
				key={editing === "new" ? "new" : (editing?.id ?? "none")}
				product={editing}
				categories={categories}
				onClose={() => setEditing(null)}
			/>
		</div>
	);
}

/** Business-wide and per-category questions. Product questions live in each product's panel. */
function QuestionsTab(props: {
	categories: string[];
	onOpenProduct: (id: string) => void;
}) {
	const { business } = useWorkspace();
	return (
		<div className="space-y-6">
			<p className="max-w-3xl text-sm text-muted-foreground">
				Before drafting a quote, the AI gathers answers to these questions in
				WhatsApp, a couple at a time, in the customer's own language. It first
				works out what they want, then asks that product's questions, then the
				category's, then the business-wide ones, and finally sends a summary for
				the customer to confirm. When the customer signs, the job goes to the
				category's default PIC in Work.
			</p>
			<section className="rounded-xl border bg-card p-4">
				<h2 className="font-semibold">Every enquiry</h2>
				<p className="mb-3 text-xs text-muted-foreground">
					Asked once we know what the customer wants, whatever they buy.
				</p>
				<QuestionList target={{ scope: "business" }} />
			</section>
			<div className="grid gap-4 lg:grid-cols-2">
				{props.categories.map((category) => {
					const inCat = business.products.filter(
						(p) => p.category === category,
					);
					const own = (id: string) =>
						business.questions.filter((q) => q.productId === id).length;
					return (
						<section key={category} className="rounded-xl border bg-card p-4">
							<div className="flex flex-wrap items-start justify-between gap-2">
								<div>
									<h2 className="font-semibold">{category}</h2>
									<p className="mb-3 text-xs text-muted-foreground">
										Shared by every product in this category.
									</p>
								</div>
								<DefaultPic category={category} />
							</div>
							<QuestionList
								target={{ scope: "category", category }}
								emptyText="No shared questions."
							/>
							<div className="mt-3 border-t pt-3">
								<p className="mb-1.5 text-xs text-muted-foreground">
									Product-specific questions
								</p>
								<ul className="flex flex-wrap gap-1.5">
									{inCat.map((p) => (
										<li key={p.id}>
											<button
												type="button"
												onClick={() => props.onOpenProduct(p.id)}
												className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted"
											>
												{p.name}{" "}
												<span className="text-muted-foreground">
													({own(p.id)})
												</span>
											</button>
										</li>
									))}
								</ul>
							</div>
						</section>
					);
				})}
			</div>
		</div>
	);
}

/** Who gets the job when a quote for this category is signed. */
function DefaultPic({ category }: { category: string }) {
	const { business } = useWorkspace();
	const refresh = useRefreshBusiness();
	const setPic = useMutation(
		orpc.categories.setPic.mutationOptions({ onSuccess: refresh }),
	);
	const current = business.categoryPics.find((c) => c.category === category);
	return (
		<div className="space-y-0.5">
			<p className="text-[11px] text-muted-foreground">
				Default PIC after signing
			</p>
			<Select
				value={current?.defaultPicId ?? "none"}
				disabled={setPic.isPending}
				onValueChange={(v) =>
					setPic.mutate({
						businessId: business.id,
						category,
						staffId: v === "none" ? null : v,
					})
				}
			>
				<SelectTrigger size="sm" className="w-52 bg-card">
					<SelectValue />
				</SelectTrigger>
				<SelectContent position="popper">
					<SelectItem value="none">Not set (first approver)</SelectItem>
					{business.staff.map((s) => (
						<SelectItem key={s.id} value={s.id}>
							{s.name} · {s.role}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}

function FilterField(props: {
	label: string;
	htmlFor?: string;
	children: React.ReactNode;
}) {
	return (
		<div className="min-w-0 space-y-1.5">
			<label htmlFor={props.htmlFor} className="text-sm font-medium">
				{props.label}
			</label>
			{props.children}
		</div>
	);
}

function FilterSelect(props: {
	label: string;
	value: string;
	onChange: (v: string) => void;
	all: string;
	options: [string, string][];
}) {
	return (
		<FilterField label={props.label}>
			<Select value={props.value} onValueChange={props.onChange}>
				<SelectTrigger className="w-full bg-card">
					<SelectValue />
				</SelectTrigger>
				<SelectContent position="popper">
					<SelectItem value="all">{props.all}</SelectItem>
					{props.options.map(([value, label]) => (
						<SelectItem key={value} value={value}>
							{label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</FilterField>
	);
}

function SortHeader(props: {
	k: SortKey;
	sort: { key: SortKey; dir: 1 | -1 };
	onSort: (k: SortKey) => void;
	children: React.ReactNode;
}) {
	const active = props.sort.key === props.k;
	const Icon = !active
		? ArrowUpDown
		: props.sort.dir === 1
			? ArrowUp
			: ArrowDown;
	return (
		<th className="px-4 py-3 font-medium">
			<button
				type="button"
				onClick={() => props.onSort(props.k)}
				className={cn(
					"inline-flex items-center gap-1 hover:text-foreground",
					active && "text-foreground",
				)}
			>
				{props.children}
				<Icon className={cn("size-3.5", !active && "opacity-40")} />
			</button>
		</th>
	);
}

// --- Table row -------------------------------------------------------------------

/** Stops a click inside a cell (or its popup) from opening the row's drawer. */
function StopRowClick(props: { children: React.ReactNode }) {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: only blocks row clicks
		// biome-ignore lint/a11y/useKeyWithClickEvents: only blocks row clicks
		<div onClick={(e) => e.stopPropagation()}>{props.children}</div>
	);
}

function ProductRow(props: {
	product: Product;
	categories: string[];
	onOpen: () => void;
	onEdit: () => void;
}) {
	const { product: p } = props;
	const { me } = useWorkspace();
	const refresh = useRefreshBusiness();
	const update = useMutation(
		orpc.products.update.mutationOptions({ onSuccess: refresh }),
	);
	const save = (product: { category?: string; active?: boolean }) =>
		update
			.mutateAsync({ productId: p.id, product, actor: me?.name ?? "Staff" })
			.catch((err) =>
				toast.error(err instanceof Error ? err.message : "Save failed"),
			);
	const avail = available(p);

	return (
		<tr
			onClick={props.onOpen}
			className={cn(
				"cursor-pointer hover:bg-muted/50",
				!p.active && "opacity-60",
			)}
		>
			<td className="px-4 py-2">
				<ProductThumb product={p} />
			</td>
			<td className="px-4 py-2">
				<p className="line-clamp-2 font-medium">{p.name}</p>
				<p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
					{p.type === "stock" ? "Stock item" : "Service"}
					{!p.active && (
						<span className="rounded bg-muted px-1.5 text-[10px] font-medium">
							Hidden from AI
						</span>
					)}
				</p>
			</td>
			<td className="px-4 py-2 font-mono text-xs break-all text-muted-foreground">
				{p.sku}
			</td>
			<td className="px-4 py-2">
				<StopRowClick>
					<Select
						value={p.category}
						onValueChange={(category) => save({ category })}
						disabled={update.isPending}
					>
						<SelectTrigger className="w-full bg-card" size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent position="popper">
							{props.categories.map((c) => (
								<SelectItem key={c} value={c}>
									{c}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</StopRowClick>
			</td>
			<td className="px-4 py-2 whitespace-nowrap tabular-nums">
				{p.pricingMode === "custom" ? (
					<span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-primary">
						Custom quote
					</span>
				) : p.unitPriceSen > 0 ? (
					<>
						{formatMYR(p.unitPriceSen)}
						<span className="text-xs text-muted-foreground"> / {p.unit}</span>
					</>
				) : (
					<span className="text-xs text-muted-foreground">On request</span>
				)}
			</td>
			{p.type === "stock" ? (
				<>
					<td className="px-4 py-2 tabular-nums">{p.stockOnHand}</td>
					<td className="px-4 py-2 tabular-nums">{p.stockReserved}</td>
					<td
						className={cn(
							"px-4 py-2 font-medium tabular-nums",
							avail <= 0 && "text-red-600",
						)}
					>
						{avail}
					</td>
				</>
			) : (
				<>
					<td className="px-4 py-2 text-muted-foreground">—</td>
					<td className="px-4 py-2 text-muted-foreground">—</td>
					<td className="px-4 py-2 text-muted-foreground">—</td>
				</>
			)}
			<td className="px-2 py-2 text-center">
				<StopRowClick>
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="ghost" size="icon" className="size-8">
								<MoreHorizontal className="size-4" />
								<span className="sr-only">Actions for {p.name}</span>
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent>
							<DropdownMenuItem onSelect={props.onOpen}>
								<PackageSearch /> View details
							</DropdownMenuItem>
							<DropdownMenuItem onSelect={props.onEdit}>
								<Pencil /> Edit
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem onSelect={() => save({ active: !p.active })}>
								{p.active ? (
									<>
										<EyeOff /> Hide from AI quotes
									</>
								) : (
									<>
										<Eye /> Show to AI quotes
									</>
								)}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</StopRowClick>
			</td>
		</tr>
	);
}

// --- Detail drawer ---------------------------------------------------------------

function ProductSheet(props: {
	product: Product | undefined;
	onClose: () => void;
	onEdit: (p: Product) => void;
}) {
	const { business, me } = useWorkspace();
	const refresh = useRefreshBusiness();
	const setImage = useMutation(
		orpc.products.setImage.mutationOptions({ onSuccess: refresh }),
	);
	const p = props.product;

	async function pick(file: File | undefined) {
		if (!file || !p) return;
		try {
			const image = await fileToThumb(file);
			await setImage.mutateAsync({
				productId: p.id,
				image,
				actor: me?.name ?? "Staff",
			});
			toast.success("Image updated");
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Upload failed");
		}
	}

	const rules = p
		? business.rules.filter((r) => r.productId === p.id || r.productId === null)
		: [];

	return (
		<Sheet open={Boolean(p)} onOpenChange={(o) => !o && props.onClose()}>
			<SheetContent className="orbyte">
				{p && (
					<>
						<div className="bg-[var(--orb-gray)] p-6 pb-4">
							<ProductThumb
								product={p}
								className="mx-auto size-40 rounded-xl [&_svg]:size-16"
							/>
							<div className="mt-3 flex justify-center gap-2">
								<Button asChild size="sm" variant="outline" className="bg-card">
									<label className="cursor-pointer">
										{setImage.isPending ? (
											<Loader2 className="size-4 animate-spin" />
										) : (
											<ImagePlus className="size-4" />
										)}
										{p.imageVersion ? "Change image" : "Upload image"}
										<input
											type="file"
											accept="image/*"
											className="sr-only"
											onChange={(e) => {
												pick(e.target.files?.[0]);
												e.target.value = "";
											}}
										/>
									</label>
								</Button>
								{p.imageVersion && (
									<Button
										size="sm"
										variant="ghost"
										disabled={setImage.isPending}
										onClick={() =>
											setImage.mutate({
												productId: p.id,
												image: null,
												actor: me?.name ?? "Staff",
											})
										}
									>
										Remove
									</Button>
								)}
							</div>
						</div>

						<div className="space-y-5 p-6 pt-4">
							<div>
								<p className="font-mono text-xs text-muted-foreground">
									{p.sku}
								</p>
								<SheetTitle className="text-lg font-semibold">
									{p.name}
								</SheetTitle>
								<SheetDescription className="text-sm text-muted-foreground">
									{p.description || "No description."}
								</SheetDescription>
								<div className="mt-2 flex flex-wrap gap-1.5">
									<Chip>{p.category}</Chip>
									<Chip>{p.type === "stock" ? "Stock item" : "Service"}</Chip>
									<Chip
										className={
											p.active
												? "bg-status-approved/15 text-status-approved"
												: undefined
										}
									>
										{p.active ? "Quotable by AI" : "Hidden from AI"}
									</Chip>
								</div>
							</div>

							<Section title="Selling price">
								<p className="text-2xl font-semibold tabular-nums">
									{p.pricingMode === "custom"
										? "Custom quote"
										: p.unitPriceSen > 0
											? formatMYR(p.unitPriceSen)
											: "On request"}
									<span className="text-sm font-normal text-muted-foreground">
										{" "}
										/ {p.unit}
									</span>
								</p>
								{rules.length > 0 && (
									<ul className="mt-2 space-y-1.5">
										{rules.map((r) => (
											<li
												key={r.id}
												className="rounded-md bg-muted px-2.5 py-1.5 text-xs"
											>
												<span className="font-medium">
													{ruleKind[r.config.kind]}
													{r.productId === null && " · all products"}:
												</span>{" "}
												{ruleDetail(r.config)}
											</li>
										))}
									</ul>
								)}
							</Section>

							{p.type === "stock" ? (
								<StockPanel product={p} />
							) : (
								<Section title="Stock">
									<p className="text-sm text-muted-foreground">
										Not tracked. This is a service or made-to-order item.
									</p>
								</Section>
							)}

							<Section title="What the AI asks before quoting">
								<p className="mb-2 text-xs text-muted-foreground">
									The AI gathers these in WhatsApp before a quote is drafted.
									{p.pricingMode === "fixed"
										? " It also asks for the quantity."
										: " Custom-priced: staff set the price from the answers."}
								</p>
								<QuestionList
									target={{ scope: "product", productId: p.id }}
									inherited={{
										title: `Also asked, from the ${p.category} category and business-wide`,
										questions: [
											...questionsOf(business.questions, {
												scope: "category",
												category: p.category,
											}),
											...questionsOf(business.questions, { scope: "business" }),
										],
									}}
									emptyText="No questions of its own yet."
								/>
							</Section>

							<Button
								className="w-full"
								variant="outline"
								onClick={() => props.onEdit(p)}
							>
								<Pencil className="size-4" /> Edit product
							</Button>
						</div>
					</>
				)}
			</SheetContent>
		</Sheet>
	);
}

const stockActions = {
	receive: {
		label: "Receive stock",
		hint: "New stock arrived: adds to inventory.",
	},
	deliver: {
		label: "Deliver reserved",
		hint: "Reserved goods handed to the customer: leaves inventory and reserved.",
	},
	release: {
		label: "Release reservation",
		hint: "Order cancelled: frees reserved stock.",
	},
	count: { label: "Stock count", hint: "Set inventory to the counted number." },
} as const;

function StockPanel({ product: p }: { product: Product }) {
	const { me } = useWorkspace();
	const refresh = useRefreshBusiness();
	const adjust = useMutation(
		orpc.products.adjustStock.mutationOptions({ onSuccess: refresh }),
	);
	const [action, setAction] = useState<keyof typeof stockActions>("receive");
	const [qty, setQty] = useState("");
	const avail = available(p);

	async function apply() {
		const quantity = Number(qty);
		if (qty === "" || !Number.isInteger(quantity))
			return toast.error("Enter a whole number");
		try {
			await adjust.mutateAsync({
				productId: p.id,
				action,
				quantity,
				actor: me?.name ?? "Staff",
			});
			setQty("");
			toast.success(`${stockActions[action].label}: done`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Not saved");
		}
	}

	const stats = [
		{ label: "Inventory", n: p.stockOnHand, tone: "" },
		{ label: "Reserved", n: p.stockReserved, tone: "" },
		{ label: "Available", n: avail, tone: avail <= 0 ? "text-red-600" : "" },
	];

	return (
		<Section title="Stock">
			<div className="grid grid-cols-3 gap-2 text-center">
				{stats.map((s) => (
					<div key={s.label} className="rounded-lg border p-2">
						<p className={cn("text-xl font-semibold tabular-nums", s.tone)}>
							{s.n}
						</p>
						<p className="text-[11px] text-muted-foreground">{s.label}</p>
					</div>
				))}
			</div>
			<p className="mt-2 text-xs text-muted-foreground">
				Signed quotations reserve stock automatically. Quotes asking for more
				than is available are flagged for staff review.
			</p>
			<div className="mt-3 space-y-2 rounded-lg bg-muted/60 p-3">
				<div className="flex gap-2">
					<Select
						value={action}
						onValueChange={(v) => setAction(v as keyof typeof stockActions)}
					>
						<SelectTrigger className="flex-1 bg-card" size="sm">
							<SelectValue />
						</SelectTrigger>
						<SelectContent position="popper">
							{Object.entries(stockActions).map(([k, a]) => (
								<SelectItem key={k} value={k}>
									{a.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<Input
						inputMode="numeric"
						placeholder="Qty"
						value={qty}
						onChange={(e) => setQty(e.target.value.replace(/\D/g, ""))}
						className="h-8 w-20 bg-card"
					/>
					<Button size="sm" onClick={apply} disabled={adjust.isPending || !qty}>
						{adjust.isPending && <Loader2 className="size-4 animate-spin" />}
						Apply
					</Button>
				</div>
				<p className="text-xs text-muted-foreground">
					{stockActions[action].hint}
				</p>
			</div>
		</Section>
	);
}

function Section(props: { title: string; children: React.ReactNode }) {
	return (
		<section>
			<h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{props.title}
			</h3>
			{props.children}
		</section>
	);
}

function Chip(props: { className?: string; children: React.ReactNode }) {
	return (
		<span
			className={cn(
				"rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium",
				props.className,
			)}
		>
			{props.children}
		</span>
	);
}

// --- Add / edit dialog -----------------------------------------------------------

function ProductDialog(props: {
	product: Product | "new" | null;
	categories: string[];
	onClose: () => void;
}) {
	const { business, me } = useWorkspace();
	const refresh = useRefreshBusiness();
	const existing = props.product === "new" ? null : props.product;
	const [form, setForm] = useState({
		name: existing?.name ?? "",
		sku: existing?.sku ?? "",
		type: existing?.type ?? ("stock" as "stock" | "service"),
		category: existing?.category ?? props.categories[0] ?? "",
		description: existing?.description ?? "",
		unit: existing?.unit ?? "pc",
		price: existing ? (existing.unitPriceSen / 100).toFixed(2) : "",
		pricingMode: existing?.pricingMode ?? ("fixed" as "fixed" | "custom"),
		openingStock: "0",
		active: existing?.active ?? true,
	});
	// New products get a suggested SKU until staff type their own.
	const [skuTouched, setSkuTouched] = useState(Boolean(existing));
	// undefined = unchanged, null = removed, string = new picture
	const [image, setImage] = useState<string | null | undefined>(undefined);

	const create = useMutation(orpc.products.create.mutationOptions());
	const update = useMutation(orpc.products.update.mutationOptions());
	const upload = useMutation(orpc.products.setImage.mutationOptions());
	const pending = create.isPending || update.isPending || upload.isPending;

	const suggested = uniqueSku(
		suggestSku(
			business.quotePrefix,
			form.category || "General",
			form.name || "Item",
		),
		business.products.filter((p) => p.id !== existing?.id).map((p) => p.sku),
	);
	const sku = skuTouched ? form.sku : form.name ? suggested : "";
	const showOpening = !existing && form.type === "stock";

	async function save() {
		const unitPriceSen =
			form.pricingMode === "custom" && !form.price.trim()
				? 0
				: parseMYR(form.price);
		if (!form.name.trim() || unitPriceSen === null)
			return toast.error("Name and a valid price are required");
		const product = {
			name: form.name.trim(),
			sku: sku.trim().toUpperCase(),
			type: form.type,
			category: form.category.trim() || "General",
			description: form.description.trim(),
			unit: form.unit.trim() || "pc",
			unitPriceSen,
			pricingMode: form.pricingMode,
			active: form.active,
		};
		const actor = me?.name ?? "Staff";
		try {
			const row = existing
				? await update.mutateAsync({ productId: existing.id, product, actor })
				: await create.mutateAsync({
						businessId: business.id,
						product,
						openingStock: Number(form.openingStock) || 0,
						actor,
					});
			if (image !== undefined)
				await upload.mutateAsync({ productId: row.id, image, actor });
			toast.success(`${product.name} ${existing ? "updated" : "added"}`);
			await refresh();
			props.onClose();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : "Save failed");
		}
	}

	const set = (patch: Partial<typeof form>) =>
		setForm((f) => ({ ...f, ...patch }));
	const preview =
		image !== undefined ? image : existing ? productImageUrl(existing) : null;

	return (
		<Dialog
			open={props.product !== null}
			onOpenChange={(o) => !o && props.onClose()}
		>
			<DialogContent className="orbyte max-w-2xl">
				<DialogHeader>
					<DialogTitle>{existing ? "Edit product" : "Add product"}</DialogTitle>
					<DialogDescription>
						The AI matches customer messages to these products. Prices are only
						ever taken from here.
					</DialogDescription>
				</DialogHeader>

				<div className="flex gap-4">
					<div className="w-24 shrink-0 space-y-1.5 text-center">
						<ProductThumb
							product={{
								name: form.name,
								category: form.category,
								type: form.type,
							}}
							src={preview}
							className="size-24 [&_svg]:size-10"
						/>
						<label className="block cursor-pointer text-xs text-primary">
							{preview ? "Change image" : "Add image"}
							<input
								type="file"
								accept="image/*"
								className="sr-only"
								onChange={async (e) => {
									const file = e.target.files?.[0];
									e.target.value = "";
									if (!file) return;
									try {
										setImage(await fileToThumb(file));
									} catch (err) {
										toast.error(
											err instanceof Error
												? err.message
												: "Could not read image",
										);
									}
								}}
							/>
						</label>
						{preview && (
							<button
								type="button"
								className="block w-full text-xs text-muted-foreground"
								onClick={() => setImage(null)}
							>
								Remove
							</button>
						)}
					</div>

					<div className="grid flex-1 gap-3 sm:grid-cols-2">
						<Field label="Name" className="sm:col-span-2">
							<Input
								value={form.name}
								onChange={(e) => set({ name: e.target.value })}
							/>
						</Field>
						<Field label="SKU">
							<Input
								value={sku}
								className="font-mono uppercase"
								placeholder="Auto"
								onChange={(e) => {
									setSkuTouched(true);
									set({ sku: e.target.value });
								}}
							/>
						</Field>
						<Field label="Type">
							<div className="flex h-9 rounded-md border p-0.5">
								{(["stock", "service"] as const).map((t) => (
									<button
										key={t}
										type="button"
										onClick={() => set({ type: t })}
										className={cn(
											"flex-1 rounded px-2 text-xs",
											form.type === t &&
												"bg-primary font-medium text-primary-foreground",
										)}
									>
										{t === "stock" ? "Stock item" : "Service"}
									</button>
								))}
							</div>
						</Field>
					</div>
				</div>

				<div className="grid gap-3 sm:grid-cols-4">
					<Field label="Category" className="sm:col-span-2">
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
					<Field label="Price (RM)">
						<Input
							inputMode="decimal"
							value={form.price}
							onChange={(e) => set({ price: e.target.value })}
						/>
					</Field>
					<Field label="Per (unit)">
						<Input
							value={form.unit}
							onChange={(e) => set({ unit: e.target.value })}
						/>
					</Field>
					{showOpening && (
						<Field label="Opening stock">
							<Input
								inputMode="numeric"
								value={form.openingStock}
								onChange={(e) =>
									set({ openingStock: e.target.value.replace(/\D/g, "") })
								}
							/>
						</Field>
					)}
					<Field
						label="Description"
						className={showOpening ? "sm:col-span-3" : "sm:col-span-4"}
					>
						<Textarea
							rows={2}
							value={form.description}
							onChange={(e) => set({ description: e.target.value })}
						/>
					</Field>
				</div>
				{existing?.type === "stock" && (
					<p className="-mt-2 text-xs text-muted-foreground">
						Change stock levels from the product's detail panel.
					</p>
				)}

				<div className="space-y-1.5">
					<p className="text-sm text-muted-foreground">Pricing</p>
					<div className="grid gap-2 sm:grid-cols-2">
						{(
							[
								[
									"fixed",
									"Fixed price",
									"Priced by the price above and the pricing rules.",
								],
								[
									"custom",
									"Custom quote",
									"Staff set the price from the customer's answers.",
								],
							] as const
						).map(([mode, title, text]) => (
							<button
								key={mode}
								type="button"
								onClick={() => set({ pricingMode: mode })}
								className={cn(
									"rounded-lg border p-3 text-left text-sm",
									form.pricingMode === mode &&
										"border-primary ring-1 ring-primary",
								)}
							>
								<span className="font-medium">{title}</span>
								<span className="block text-xs text-muted-foreground">
									{text}
								</span>
							</button>
						))}
					</div>
					<p className="text-xs text-muted-foreground">
						Questions the AI asks are set in the product's detail panel.
					</p>
				</div>

				<label className="flex items-center gap-2 text-sm">
					<input
						type="checkbox"
						checked={form.active}
						onChange={(e) => set({ active: e.target.checked })}
						className="accent-[var(--primary)]"
					/>
					Quotable by AI (untick to hide it from quotes)
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

// --- Pricing rules ---------------------------------------------------------------

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
	const refresh = useRefreshBusiness();
	const remove = useMutation(
		orpc.rules.delete.mutationOptions({ onSuccess: refresh }),
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
