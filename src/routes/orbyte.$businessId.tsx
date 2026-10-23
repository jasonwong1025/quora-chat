import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import {
	createFileRoute,
	Link,
	Outlet,
	useLocation,
	useRouter,
} from "@tanstack/react-router";
import {
	BookOpen,
	FileText,
	LayoutDashboard,
	ListChecks,
	Menu,
	MessagesSquare,
	Package,
	PenLine,
	Plug,
	Users,
	X,
} from "lucide-react";
import { useState } from "react";
import { DemoClock } from "#/components/orbyte/demo-clock";
import { NotificationBell } from "#/components/orbyte/notification-bell";
import { useWorkspace, WorkspaceProvider } from "#/components/orbyte/workspace";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "#/components/ui/select";
import { initials } from "#/lib/time";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId")({
	loader: ({ context, params }) =>
		Promise.all([
			context.queryClient.ensureQueryData(orpc.businesses.list.queryOptions()),
			context.queryClient.ensureQueryData(
				orpc.businesses.get.queryOptions({
					input: { businessId: params.businessId },
				}),
			),
		]),
	head: () => ({ meta: [{ title: "Orbyte workspace · Quora Chat demo" }] }),
	component: OrbyteLayout,
});

function OrbyteLayout() {
	const { businessId } = Route.useParams();
	const { data: business } = useSuspenseQuery(
		orpc.businesses.get.queryOptions({ input: { businessId } }),
	);
	return (
		<WorkspaceProvider key={business.id} business={business}>
			<Shell />
		</WorkspaceProvider>
	);
}

type NavItem = {
	to:
		| "/orbyte/$businessId"
		| "/orbyte/$businessId/people"
		| "/orbyte/$businessId/work"
		| "/orbyte/$businessId/esign"
		| "/orbyte/$businessId/connect"
		| "/orbyte/$businessId/knowledge"
		| "/orbyte/$businessId/products"
		| "/orbyte/$businessId/inbox"
		| "/orbyte/$businessId/quotes";
	label: string;
	icon: typeof LayoutDashboard;
	count?: number;
	exact?: boolean;
};

function Shell() {
	const { business, me } = useWorkspace();
	const [open, setOpen] = useState(false);
	const location = useLocation();

	const inbox = useQuery({
		...orpc.inbox.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 4000,
	});
	const requests = useQuery({
		...orpc.requests.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 4000,
	});
	const jobs = useQuery({
		...orpc.jobs.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 4000,
	});
	const approvals = useQuery({
		...orpc.relays.pending.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 4000,
	});
	const myOpenJobs =
		jobs.data?.filter(
			(j) =>
				(j.picId === me?.id || (me && j.memberIds.includes(me.id))) &&
				["preparing", "upcoming", "active"].includes(j.status),
		).length ?? 0;
	const awaiting =
		(inbox.data?.filter((c) => c.awaitingReply).length ?? 0) +
		(approvals.data?.length ?? 0);
	const toReview =
		requests.data?.filter((r) =>
			["needs_review", "draft_ready"].includes(r.status),
		).length ?? 0;

	const groups: { title?: string; badge?: string; items: NavItem[] }[] = [
		{
			items: [
				{
					to: "/orbyte/$businessId",
					label: "Home",
					icon: LayoutDashboard,
					exact: true,
				},
			],
		},
		{
			title: "Modules",
			items: [
				{ to: "/orbyte/$businessId/people", label: "People", icon: Users },
				{
					to: "/orbyte/$businessId/work",
					label: "Work",
					icon: ListChecks,
					count: myOpenJobs,
				},
				{ to: "/orbyte/$businessId/esign", label: "eSign", icon: PenLine },
				{ to: "/orbyte/$businessId/connect", label: "Connect", icon: Plug },
				{
					to: "/orbyte/$businessId/knowledge",
					label: "Knowledge",
					icon: BookOpen,
				},
			],
		},
		{
			title: "Sales",
			badge: "New",
			items: [
				{
					to: "/orbyte/$businessId/products",
					label: "Products",
					icon: Package,
				},
				{
					to: "/orbyte/$businessId/inbox",
					label: "Quotation inbox",
					icon: MessagesSquare,
					count: awaiting,
				},
				{
					to: "/orbyte/$businessId/quotes",
					label: "Quotes",
					icon: FileText,
					count: toReview,
				},
			],
		},
	];

	const isActive = (item: NavItem) => {
		const path = item.to.replace("$businessId", business.id);
		return item.exact
			? location.pathname.replace(/\/$/, "") === path
			: location.pathname.startsWith(path);
	};

	const sidebar = (
		// On short screens the whole sidebar scrolls, so no menu item hides behind the demo clock.
		<nav className="flex h-full flex-col gap-1 overflow-y-auto bg-[var(--orb-navy)] p-3 text-white">
			<div className="flex items-center gap-2 px-2 py-2">
				<Link to="/" className="flex items-center gap-2">
					<span className="flex size-8 items-center justify-center rounded-lg bg-white">
						<img src="/orbyte-icon.png" alt="" className="size-6" />
					</span>
					<span className="text-lg font-semibold tracking-tight">Orbyte</span>
				</Link>
				<NotificationBell />
			</div>
			<BusinessSwitcher />
			<div className="mt-2 flex-1 space-y-4 pb-2">
				{groups.map((g) => (
					<div key={g.title ?? "top"}>
						{g.title && (
							<p className="mb-1 flex items-center gap-2 px-2 text-[11px] font-semibold tracking-wider text-white/50 uppercase">
								{g.title}
								{g.badge && (
									<span className="bg-[var(--orb-royal)] px-1 py-px text-[9px] font-semibold text-white">
										{g.badge}
									</span>
								)}
							</p>
						)}
						<ul className="space-y-0.5">
							{g.items.map((item) => (
								<li key={item.to}>
									<Link
										to={item.to}
										params={{ businessId: business.id }}
										onClick={() => setOpen(false)}
										className={cn(
											"flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-white/75 hover:bg-white/10 hover:text-white",
											isActive(item) && "bg-white/15 font-medium text-white",
										)}
									>
										<item.icon className="size-4" />
										<span className="flex-1">{item.label}</span>
										{item.count ? (
											<span className="bg-[var(--orb-cyan)] px-1.5 text-[11px] font-semibold text-[var(--orb-navy)]">
												{item.count}
											</span>
										) : null}
									</Link>
								</li>
							))}
						</ul>
					</div>
				))}
			</div>
			<DemoClock />
			<SignedInAs />
		</nav>
	);

	return (
		// `relative` on the shell and <main>: absolutely positioned bits (e.g. screen-reader
		// text in table rows) otherwise anchor to the page and stretch it past the viewport.
		<div className="orbyte relative flex h-dvh overflow-hidden">
			<aside className="hidden w-64 shrink-0 lg:block">{sidebar}</aside>
			{open && (
				<div className="fixed inset-0 z-40 flex lg:hidden">
					<div className="w-72 max-w-[85%]">{sidebar}</div>
					<button
						type="button"
						aria-label="Close menu"
						className="flex-1 bg-black/40"
						onClick={() => setOpen(false)}
					>
						<X className="mt-4 ml-4 size-6 text-white" />
					</button>
				</div>
			)}
			<div className="flex min-w-0 flex-1 flex-col">
				<header className="flex items-center gap-3 border-b bg-card px-4 py-2.5 lg:hidden">
					<button
						type="button"
						onClick={() => setOpen(true)}
						aria-label="Open menu"
						className="-m-2 rounded-md p-2 hover:bg-muted"
					>
						<Menu className="size-5" />
					</button>
					<img src="/orbyte-icon.png" alt="" className="size-6" />
					<span className="truncate font-semibold">{business.name}</span>
				</header>
				<main className="relative min-h-0 flex-1 overflow-y-auto">
					<Outlet />
				</main>
			</div>
		</div>
	);
}

function BusinessSwitcher() {
	const { business } = useWorkspace();
	const businesses = useQuery(orpc.businesses.list.queryOptions());
	const router = useRouter();
	const location = useLocation();
	return (
		<Select
			value={business.id}
			onValueChange={(id) => {
				const rest = location.pathname.split("/").slice(3).join("/");
				router.history.push(`/orbyte/${id}/${rest}`);
			}}
		>
			<SelectTrigger className="h-auto w-full border-white/15 bg-white/5 py-2 text-left text-white hover:bg-white/10 [&_svg]:text-white/60">
				<span className="min-w-0">
					<span className="block truncate text-sm font-medium">
						{business.name}
					</span>
					<span className="block truncate text-xs text-white/50">
						{business.industry} workspace
					</span>
				</span>
			</SelectTrigger>
			<SelectContent
				position="popper"
				side="bottom"
				align="start"
				className="w-72 min-w-[var(--radix-select-trigger-width)]"
			>
				{businesses.data?.map((b) => (
					<SelectItem key={b.id} value={b.id}>
						{b.name}
						<span className="text-xs text-muted-foreground">
							· {b.industry}
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function SignedInAs() {
	const { business, me, setMe } = useWorkspace();
	return (
		<Select value={me?.id} onValueChange={setMe}>
			<SelectTrigger className="h-auto w-full border-white/15 bg-white/5 py-2 text-left text-white hover:bg-white/10 [&_svg]:text-white/60">
				<span className="flex min-w-0 items-center gap-2">
					<span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--orb-royal)] text-xs font-semibold">
						{me ? initials(me.name) : "?"}
					</span>
					<span className="min-w-0">
						<span className="block truncate text-sm font-medium">
							{me?.name ?? "Choose user"}
						</span>
						<span className="block truncate text-xs text-white/50">
							{me?.role}
							{me?.canApprove ? " · can approve" : ""}
						</span>
					</span>
				</span>
			</SelectTrigger>
			<SelectContent
				position="popper"
				side="top"
				align="start"
				className="max-h-[60vh] w-72 min-w-[var(--radix-select-trigger-width)]"
			>
				{business.staff.map((s) => (
					<SelectItem key={s.id} value={s.id}>
						{s.name}
						<span className="text-xs text-muted-foreground">· {s.role}</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}
