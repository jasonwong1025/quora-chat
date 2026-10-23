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
import { lostLabel } from "#/components/orbyte/follow-up-panel";
import { useWorkspace } from "#/components/orbyte/workspace";
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
	const lost = r.filter((x) => x.quote?.status === "lost");
	const reasons = Object.entries(
		lost.reduce<Record<string, number>>((acc, x) => {
			const k = x.quote?.lostReason ?? "other";
			acc[k] = (acc[k] ?? 0) + 1;
			return acc;
		}, {}),
	).sort((a, b) => b[1] - a[1]);
	const decided = signed.length + lost.length;

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
			label: "Won (signed value)",
			value: formatMYR(signedValue),
			hint: decided
				? `${Math.round((signed.length / decided) * 100)}% of decided quotes`
				: undefined,
			to: "/orbyte/$businessId/esign" as const,
		},
		{
			label: "Lost",
			value: lost.length,
			hint: reasons.length
				? `Top reason: ${(lostLabel as Record<string, string>)[reasons[0][0]] ?? reasons[0][0]}`
				: undefined,
			to: "/orbyte/$businessId/quotes" as const,
		},
	] as {
		label: string;
		value: string | number;
		hint?: string;
		to:
			| "/orbyte/$businessId/inbox"
			| "/orbyte/$businessId/quotes"
			| "/orbyte/$businessId/esign";
	}[];

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
			text: "Jobs handed over after signing",
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
		<div className="space-y-6 p-4 sm:p-6">
			<header className="flex flex-wrap items-end justify-between gap-3 border-b pb-4">
				<div>
					<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
						{business.name}
					</p>
					<h1 className="mt-1 text-2xl font-semibold tracking-tight">
						{greeting()}
						{me ? `, ${me.name.split(" ")[0]}` : ""}
					</h1>
				</div>
				<p className="text-sm text-muted-foreground">
					{attention.length > 0
						? `${attention.length} quotation${attention.length > 1 ? "s" : ""} to review`
						: "All up to date"}
				</p>
			</header>

			<div className="grid grid-cols-2 gap-px border bg-border sm:grid-cols-5">
				{stats.map((s) => (
					<Link
						key={s.label}
						to={s.to}
						params={{ businessId: business.id }}
						className="bg-card px-4 py-3 transition-colors last:col-span-2 hover:bg-muted/40 sm:last:col-span-1"
					>
						<p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
							{s.label}
						</p>
						<p className="mt-1 text-2xl font-semibold tabular-nums">
							{s.value}
						</p>
						<p className="mt-0.5 min-h-4 text-[11px] text-muted-foreground">
							{s.hint ?? ""}
						</p>
					</Link>
				))}
			</div>

			<div className="grid gap-6 lg:grid-cols-5">
				<section className="border bg-card lg:col-span-3 lg:self-start">
					<SectionHead title="Needs your attention">
						<Link
							to="/orbyte/$businessId/quotes"
							params={{ businessId: business.id }}
							className="flex items-center gap-1 text-xs font-medium text-primary"
						>
							All quotes <ArrowRight className="size-3.5" />
						</Link>
					</SectionHead>
					{attention.length === 0 ? (
						<p className="px-4 py-6 text-sm text-muted-foreground">
							Nothing waiting
						</p>
					) : (
						<ul className="divide-y">
							{attention.map((x) => (
								<li key={x.id}>
									<Link
										to="/orbyte/$businessId/quotes"
										params={{ businessId: business.id }}
										search={{ r: x.id }}
										className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40"
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
										<span className="hidden w-16 text-right text-xs text-muted-foreground sm:inline">
											{ago(x.updatedAt)}
										</span>
									</Link>
								</li>
							))}
						</ul>
					)}
				</section>

				<section className="border bg-card lg:col-span-2">
					<SectionHead title="Activity" />
					<div className="max-h-96 overflow-y-auto p-4">
						<ActivityFeed businessId={business.id} />
					</div>
				</section>
			</div>

			<section className="border bg-card">
				<SectionHead title="Modules" />
				<div className="grid gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
					{modules.map((m) => (
						<Link
							key={m.name}
							to={m.to}
							params={{ businessId: business.id }}
							className="group flex items-center gap-3 bg-card px-4 py-3 hover:bg-muted/40"
						>
							<m.icon className="size-4 shrink-0 text-[var(--orb-royal)]" />
							<span className="min-w-0 flex-1">
								<span className="flex items-center gap-2 text-sm font-medium">
									{m.name}
									{m.isNew && (
										<span className="bg-[var(--orb-royal)] px-1 py-px text-[9px] font-semibold text-white uppercase">
											New
										</span>
									)}
								</span>
								<span className="block truncate text-xs text-muted-foreground">
									{m.text}
								</span>
							</span>
							<ArrowRight className="size-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
						</Link>
					))}
				</div>
			</section>
		</div>
	);
}

function SectionHead(props: { title: string; children?: React.ReactNode }) {
	return (
		<div className="flex h-11 items-center justify-between border-b px-4">
			<h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
				{props.title}
			</h2>
			{props.children}
		</div>
	);
}
