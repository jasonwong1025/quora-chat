import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import {
	Download,
	ExternalLink,
	FileSignature,
	ShieldCheck,
} from "lucide-react";
import { z } from "zod";
import { PageHeader, useWorkspace } from "#/components/orbyte/workspace";
import { Button } from "#/components/ui/button";
import { formatMYR } from "#/lib/money";
import type { EsignRow } from "#/lib/types";
import { cn } from "#/lib/utils";
import { orpc } from "#/orpc/client";

export const Route = createFileRoute("/orbyte/$businessId/esign")({
	validateSearch: z.object({ d: z.string().optional() }),
	component: Esign,
});

function envelopeStatus(q: EsignRow) {
	if (q.status === "accepted")
		return {
			label: "Signed",
			className: "bg-status-approved/15 text-status-approved",
		};
	if (q.status === "superseded")
		return { label: "Replaced", className: "bg-muted text-muted-foreground" };
	if (q.viewedAt)
		return {
			label: "Viewed",
			className: "bg-status-clarify/20 text-[#9a6a00]",
		};
	return { label: "Sent", className: "bg-status-draft/15 text-status-draft" };
}

function Esign() {
	const { business } = useWorkspace();
	const { d } = Route.useSearch();
	const navigate = Route.useNavigate();
	const docs = useQuery({
		...orpc.esign.list.queryOptions({ input: { businessId: business.id } }),
		refetchInterval: 3000,
	});
	const selected = docs.data?.find((x) => x.id === d) ?? docs.data?.[0];
	const signed = docs.data?.filter((x) => x.status === "accepted").length ?? 0;

	return (
		<div className="p-4 sm:p-6">
			<PageHeader
				title="eSign"
				description={`Documents sent for signature. ${signed} of ${docs.data?.length ?? 0} signed.`}
			/>

			{docs.data?.length === 0 ? (
				<div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground">
					<FileSignature className="mx-auto mb-2 size-8" />
					No documents yet. Approving a quotation sends it here for the
					customer's signature.
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-5">
					<ul className="divide-y overflow-hidden rounded-xl border bg-card lg:col-span-2">
						{docs.data?.map((q) => {
							const s = envelopeStatus(q);
							return (
								<li key={q.id}>
									<button
										type="button"
										onClick={() => navigate({ search: { d: q.id } })}
										className={cn(
											"flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/60",
											selected?.id === q.id && "bg-secondary",
										)}
									>
										<FileSignature className="size-5 shrink-0 text-primary" />
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-medium">
												{q.number} · {q.customerName}
											</p>
											<p className="text-xs text-muted-foreground">
												{formatMYR(q.totalSen)} · sent{" "}
												{q.decidedAt?.toLocaleDateString("en-MY")}
											</p>
										</div>
										<span
											className={cn(
												"px-2 py-0.5 text-xs font-semibold",
												s.className,
											)}
										>
											{s.label}
										</span>
									</button>
								</li>
							);
						})}
					</ul>

					{selected && <EnvelopeDetail q={selected} />}
				</div>
			)}
		</div>
	);
}

function EnvelopeDetail({ q }: { q: EsignRow }) {
	return (
		<section className="space-y-4 rounded-xl border bg-card p-5 lg:col-span-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<h2 className="font-semibold">Quotation {q.number}</h2>
					<p className="text-sm text-muted-foreground">
						{q.customerName}
						{q.customerPhone && ` · ${q.customerPhone}`} ·{" "}
						{formatMYR(q.totalSen)}
					</p>
				</div>
				<div className="flex gap-2">
					<Button asChild size="sm" variant="outline">
						<a
							href={`/api/quotes/${q.id}/pdf`}
							target="_blank"
							rel="noreferrer"
						>
							<Download className="size-4" /> PDF
						</a>
					</Button>
					<Button asChild size="sm" variant="outline">
						<a href={`/sign/${q.id}`} target="_blank" rel="noreferrer">
							<ExternalLink className="size-4" /> Signing page
						</a>
					</Button>
				</div>
			</div>

			<div className="rounded-lg border p-4">
				<p className="text-xs text-muted-foreground">Signature</p>
				{q.signatureImage ? (
					<>
						<img
							src={q.signatureImage}
							alt={`Signature of ${q.signerName}`}
							className="my-2 h-20 w-auto"
						/>
						<p className="text-sm font-medium">{q.signerName}</p>
						<p className="text-xs text-muted-foreground">
							{q.signedAt?.toLocaleString("en-MY")}
						</p>
					</>
				) : (
					<p className="py-6 text-center text-sm text-muted-foreground">
						Waiting for {q.customerName} to sign
						{q.viewedAt ? " — they have opened it." : "."}
					</p>
				)}
			</div>

			<div>
				<h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
					<ShieldCheck className="size-3.5" /> Audit log
				</h3>
				<ol className="relative space-y-3 border-l pl-4">
					{q.audit.map((e) => (
						<li key={e.id} className="relative">
							<span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full bg-primary ring-2 ring-card" />
							<p className="text-sm">{e.summary}</p>
							<p className="text-xs text-muted-foreground">
								{e.actor} · {e.createdAt.toLocaleString("en-MY")}
							</p>
						</li>
					))}
				</ol>
			</div>
		</section>
	);
}
