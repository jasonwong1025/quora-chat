import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Database, Loader2, MessagesSquare } from "lucide-react";
import { z } from "zod";
import { CustomerChat } from "#/components/customer-chat";
import { ReviewerPanel } from "#/components/reviewer-panel";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select";
import { orpc } from "#/orpc/client";

const searchSchema = z.object({
	b: z.string().optional(), // business
	c: z.string().optional(), // conversation
	r: z.string().optional(), // request open in reviewer
	as: z.string().optional(), // staff member acting
});

export const Route = createFileRoute("/")({
	validateSearch: searchSchema,
	component: Workspace,
});

function Workspace() {
	const search = Route.useSearch();
	const navigate = Route.useNavigate();
	const setSearch = (patch: Partial<z.infer<typeof searchSchema>>) =>
		navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

	const businesses = useQuery(orpc.businesses.list.queryOptions());
	const businessId = search.b ?? businesses.data?.[0]?.id;
	const business = useQuery({
		...orpc.businesses.get.queryOptions({
			input: { businessId: businessId ?? "" },
		}),
		enabled: Boolean(businessId),
	});

	const staff = business.data?.staff ?? [];
	const actingAs =
		staff.find((s) => s.id === search.as) ?? staff.find((s) => s.canApprove);

	return (
		<div className="flex h-dvh flex-col">
			<header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b bg-card px-4 py-2.5">
				<div className="flex items-center gap-2">
					<MessagesSquare className="size-5 text-primary" />
					<span className="font-semibold">Quora Chat</span>
					<span className="hidden rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline">
						Demo · synthetic data
					</span>
				</div>

				<div className="ml-auto flex flex-wrap items-center gap-2">
					{businesses.data && businesses.data.length > 0 && (
						<Select
							value={businessId}
							onValueChange={(b) =>
								setSearch({ b, c: undefined, r: undefined, as: undefined })
							}
						>
							<SelectTrigger size="sm" className="w-56">
								<SelectValue placeholder="Business" />
							</SelectTrigger>
							<SelectContent>
								{businesses.data.map((b) => (
									<SelectItem key={b.id} value={b.id}>
										{b.name}
										<span className="text-xs text-muted-foreground">
											· {b.industry}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
					{staff.length > 0 && (
						<Select
							value={actingAs?.id}
							onValueChange={(as) => setSearch({ as })}
						>
							<SelectTrigger size="sm" className="w-52">
								<span className="text-xs text-muted-foreground">Acting as</span>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{staff.map((s) => (
									<SelectItem key={s.id} value={s.id}>
										{s.name}
										<span className="text-xs text-muted-foreground">
											· {s.role}
										</span>
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					)}
				</div>
			</header>

			{businesses.isError ? (
				<SetupNotice error={businesses.error.message} />
			) : businesses.data?.length === 0 ? (
				<SetupNotice error="The database has no businesses yet." />
			) : !business.data ? (
				<div className="flex flex-1 items-center justify-center text-muted-foreground">
					<Loader2 className="size-5 animate-spin" />
				</div>
			) : (
				<main className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-2 [&>*]:min-h-[32rem] lg:[&>*]:min-h-0">
					<CustomerChat
						business={business.data}
						conversationId={search.c}
						onSelectConversation={(c) => setSearch({ c })}
					/>
					<ReviewerPanel
						business={business.data}
						actingAs={actingAs}
						requestId={search.r}
						onSelectRequest={(r, c) => setSearch(c ? { r, c } : { r })}
					/>
				</main>
			)}
		</div>
	);
}

function SetupNotice({ error }: { error: string }) {
	return (
		<div className="flex flex-1 items-center justify-center p-6">
			<div className="max-w-md rounded-xl border bg-card p-6">
				<Database className="mb-3 size-6 text-primary" />
				<h1 className="font-semibold">Database not ready</h1>
				<p className="mt-1 text-sm text-muted-foreground">{error}</p>
				<ol className="mt-4 list-decimal space-y-1 pl-5 text-sm">
					<li>
						Copy <code>.env.example</code> to <code>.env</code> and set{" "}
						<code>DATABASE_URL</code>.
					</li>
					<li>
						Run <code>pnpm db:push</code> to create tables.
					</li>
					<li>
						Run <code>pnpm db:seed</code> to load the demo businesses.
					</li>
				</ol>
			</div>
		</div>
	);
}
