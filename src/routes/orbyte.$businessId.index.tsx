import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	ArrowRight,
	FileText,
	ListChecks,
	MessagesSquare,
	Package,
	PenLine,
	Plug,
	Users,
} from "lucide-react";
import { ActivityFeed } from "#/components/activity-feed";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { StatusBadge } from "#/components/status-badge";
import { formatMYR } from "#/lib/money";
import { ago } from "#/lib/time";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/")({
	component: Home,
});

function greeting() {
	const h = new Date().getHours();
	return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

function Home() {
	const { business, me } = useWorkspace();
	const input = { input: { businessId: business.id } };
	const inbox = useQuery({
		...orpc.inbox.list.queryOptions(input),
		refetchInterval: 4000,
	});
	const requests = useQuery({
		...orpc.requests.list.queryOptions(input),
		refetchInterval: 4000,
	});
	const esign = useQuery({
		...orpc.esign.list.queryOptions(input),
		refetchInterval: 4000,
	});

	const r = requests.data ?? [];
	const attention = r.filter((x) =>
		["needs_review", "draft_ready"].includes(x.status),
	);
	const awaitingSig = esign.data?.filter((q) => q.status === "approved") ?? [];
	const signed = esign.data?.filter((q) => q.status === "accepted") ?? [];
	const signedValue = signed.reduce((s, q) => s + q.totalSen, 0);

	const stats = [
		{
			label: "Chats awaiting reply",
			value: inbox.data?.filter((c) => c.awaitingReply).length ?? 0,
			to: "/orbyte/$businessId/inbox" as const,
		},
		{
			label: "Quotes to review",
			value: attention.length,
			to: "/orbyte/$businessId/quotes" as const,
		},
		{
			label: "Awaiting signature",
			value: awaitingSig.length,
			to: "/orbyte/$businessId/esign" as const,
		},
		{
			label: "Signed value",
			value: formatMYR(signedValue),
			to: "/orbyte/$businessId/esign" as const,
		},
	];

	const modules = [
		{
			to: "/orbyte/$businessId/people" as const,
			icon: Users,
			name: "People",
			text: "Leave, claims and directory",
		},
		{
			to: "/orbyte/$businessId/work" as const,
			icon: ListChecks,
			name: "Work",
			text: "Daily status and projects",
		},
		{
			to: "/orbyte/$businessId/esign" as const,
			icon: PenLine,
			name: "eSign",
			text: "Signed documents and audit log",
		},
		{
			to: "/orbyte/$businessId/connect" as const,
			icon: Plug,
			name: "Connect",
			text: "Channels and integrations",
		},
		{
			to: "/orbyte/$businessId/products" as const,
			icon: Package,
			name: "Products",
			text: "Catalog and pricing rules",
			isNew: true,
		},
		{
			to: "/orbyte/$businessId/inbox" as const,
			icon: MessagesSquare,
			name: "Quotation",
			text: "AI quotes from WhatsApp chats",
			isNew: true,
		},
	];

	return (
		<div className="p-4 sm:p-6">
			<div
				className="mb-6 overflow-hidden rounded-2xl p-6 text-white sm:p-8"
				style={{ background: "var(--orb-gradient)" }}
			>
				<p className="text-sm text-white/70">{business.name}</p>
				<h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
					{greeting()}
					{me ? `, ${me.name.split(" ")[0]}` : ""}.
				</h1>
				<p className="mt-2 max-w-xl text-sm text-white/80">
					{attention.length > 0
						? `${attention.length} quotation${attention.length > 1 ? "s" : ""} need${attention.length > 1 ? "" : "s"} your review.`
						: "Everything is up to date. New WhatsApp requests will appear in the Quotation inbox."}
				</p>
			</div>

			<div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{stats.map((s) => (
					<Link
						key={s.label}
						to={s.to}
						params={{ businessId: business.id }}
						className="rounded-xl border bg-card p-4 hover:border-[var(--orb-sky)]"
					>
						<p className="text-xs text-muted-foreground">{s.label}</p>
						<p className="mt-1 text-2xl font-semibold tabular-nums">
							{s.value}
						</p>
					</Link>
				))}
			</div>

			<div className="mt-6 grid gap-6 lg:grid-cols-5">
				<section className="rounded-xl border bg-card lg:col-span-3">
					<div className="flex items-center justify-between border-b px-4 py-3">
						<h2 className="font-semibold">Needs your attention</h2>
						<Link
							to="/orbyte/$businessId/quotes"
							params={{ businessId: business.id }}
							className="flex items-center gap-1 text-sm text-primary"
						>
							All quotes <ArrowRight className="size-3.5" />
						</Link>
					</div>
					{attention.length === 0 ? (
						<p className="p-6 text-sm text-muted-foreground">
							Nothing waiting. Send a message from the WhatsApp portal to see a
							request arrive.
						</p>
					) : (
						<ul className="divide-y">
							{attention.map((x) => (
								<li key={x.id}>
									<Link
										to="/orbyte/$businessId/quotes"
										params={{ businessId: business.id }}
										search={{ r: x.id }}
										className="flex items-center gap-3 px-4 py-3 hover:bg-muted/50"
									>
										<FileText className="size-4 shrink-0 text-muted-foreground" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{x.customerName}
												{x.quote && (
													<span className="font-normal text-muted-foreground">
														{" "}
														· {x.quote.number} · {formatMYR(x.quote.totalSen)}
													</span>
												)}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{x.brief.summary || "New enquiry"}
											</p>
										</div>
										<StatusBadge status={x.status} />
										<span className="hidden text-xs text-muted-foreground sm:inline">
											{ago(x.updatedAt)}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="rounded-xl border bg-card p-4 lg:col-span-2">
					<h2 className="mb-3 font-semibold">Activity</h2>
					<div className="max-h-96 overflow-y-auto">
						<ActivityFeed businessId={business.id} />
					</div>
				</section>
			</div>

			<div className="mt-8">
				<PageHeader title="Your modules" />
			</div>
			<div className="-mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
				{modules.map((m) => (
					<Link
						key={m.name}
						to={m.to}
						params={{ businessId: business.id }}
						className="flex items-start gap-3 rounded-xl border bg-card p-4 hover:border-[var(--orb-sky)]"
					>
						<span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
							<m.icon className="size-5" />
						</span>
						<span>
							<span className="flex items-center gap-2 font-medium">
								{m.name}
								{m.isNew && (
									<span
										className="rounded-full px-1.5 py-px text-[9px] font-semibold text-white uppercase"
										style={{ background: "var(--orb-gradient)" }}
									>
										New
									</span>
								)}
							</span>
							<span className="block text-sm text-muted-foreground">
								{m.text}
							</span>
						</span>
					</Link>
				))}
			</div>
		</div>
	);
}
