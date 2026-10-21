import { createFileRoute } from "@tanstack/react-router";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { DemoNote } from "#/components/orbyte/demo-note";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import {
	getClaims,
	getLeaveRequests,
	type LeaveRequest,
} from "#/data/orbyte-static";
import { formatMYR } from "#/lib/money";
import { avatarHue, initials } from "#/lib/time";
import { cn } from "#/lib/utils";

export const Route = createFileRoute("/orbyte/$businessId/people")({
	component: People,
});

const pill: Record<string, string> = {
	pending: "bg-status-clarify/20 text-[#9a6a00]",
	approved: "bg-status-approved/15 text-status-approved",
	paid: "bg-status-approved/15 text-status-approved",
	rejected: "bg-muted text-muted-foreground",
};

function People() {
	const { business, me } = useWorkspace();
	const [leave, setLeave] = useState(() => getLeaveRequests(business.staff));
	const claims = getClaims(business.staff);

	const decide = (id: string, status: LeaveRequest["status"]) =>
		setLeave((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));

	return (
		<div className="mx-auto max-w-6xl p-4 sm:p-8">
			<PageHeader
				title="People"
				description="Leave, claims and the company directory."
			/>
			<DemoNote />
			<Tabs defaultValue="directory">
				<TabsList>
					<TabsTrigger value="directory">Directory</TabsTrigger>
					<TabsTrigger value="leave">Leave</TabsTrigger>
					<TabsTrigger value="claims">Claims</TabsTrigger>
				</TabsList>

				<TabsContent value="directory" className="pt-2">
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{business.staff.map((s) => {
							const hue = avatarHue(s.name);
							return (
								<div
									key={s.id}
									className="flex items-center gap-3 rounded-xl border bg-card p-4"
								>
									<span
										className="flex size-11 items-center justify-center rounded-full text-sm font-semibold"
										style={{
											background: `hsl(${hue} 70% 92%)`,
											color: `hsl(${hue} 50% 30%)`,
										}}
									>
										{initials(s.name)}
									</span>
									<div className="min-w-0">
										<p className="truncate font-medium">{s.name}</p>
										<p className="text-sm text-muted-foreground">{s.role}</p>
										{s.canApprove && (
											<p className="text-xs text-primary">
												Can approve quotations
											</p>
										)}
									</div>
								</div>
							);
						})}
					</div>
				</TabsContent>

				<TabsContent value="leave" className="pt-2">
					<div className="overflow-x-auto rounded-xl border bg-card">
						<table className="w-full text-sm">
							<thead className="border-b text-left text-xs text-muted-foreground">
								<tr>
									<th className="px-4 py-2 font-medium">Employee</th>
									<th className="px-4 py-2 font-medium">Type</th>
									<th className="px-4 py-2 font-medium">Dates</th>
									<th className="px-4 py-2 font-medium">Status</th>
									<th className="px-4 py-2" />
								</tr>
							</thead>
							<tbody className="divide-y">
								{leave.map((r) => (
									<tr key={r.id}>
										<td className="px-4 py-3 font-medium">{r.staffName}</td>
										<td className="px-4 py-3">{r.type}</td>
										<td className="px-4 py-3 text-muted-foreground">
											{r.from === r.to ? r.from : `${r.from} → ${r.to}`} (
											{r.days}d)
										</td>
										<td className="px-4 py-3">
											<span
												className={cn(
													"rounded-full px-2 py-0.5 text-xs font-medium capitalize",
													pill[r.status],
												)}
											>
												{r.status}
											</span>
										</td>
										<td className="px-4 py-3 text-right">
											{r.status === "pending" && me?.canApprove && (
												<div className="flex justify-end gap-1">
													<Button
														size="sm"
														variant="outline"
														onClick={() => decide(r.id, "rejected")}
													>
														<X className="size-4" />
													</Button>
													<Button
														size="sm"
														onClick={() => decide(r.id, "approved")}
													>
														<Check className="size-4" /> Approve
													</Button>
												</div>
											)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</TabsContent>

				<TabsContent value="claims" className="pt-2">
					<div className="overflow-x-auto rounded-xl border bg-card">
						<table className="w-full text-sm">
							<thead className="border-b text-left text-xs text-muted-foreground">
								<tr>
									<th className="px-4 py-2 font-medium">Employee</th>
									<th className="px-4 py-2 font-medium">Item</th>
									<th className="px-4 py-2 text-right font-medium">Amount</th>
									<th className="px-4 py-2 font-medium">Status</th>
								</tr>
							</thead>
							<tbody className="divide-y">
								{claims.map((c) => (
									<tr key={c.id}>
										<td className="px-4 py-3 font-medium">{c.staffName}</td>
										<td className="px-4 py-3">{c.item}</td>
										<td className="px-4 py-3 text-right tabular-nums">
											{formatMYR(c.amountSen)}
										</td>
										<td className="px-4 py-3">
											<span
												className={cn(
													"rounded-full px-2 py-0.5 text-xs font-medium capitalize",
													pill[c.status],
												)}
											>
												{c.status}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}
