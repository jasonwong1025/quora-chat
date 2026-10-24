import { quoteBadge, StatusBadge } from "#/components/status-badge";
import { agreementLines } from "#/lib/agreements";
import { triggerLabel } from "#/lib/billing";
import { formatMYR } from "#/lib/money";
import {
	chargeLabel,
	chargeSuffix,
	groupLines,
	hasTerms,
	paymentAmounts,
	totalWeeks,
} from "#/lib/quote-lines";
import type { QuoteDetail } from "#/lib/types";

/** The quotation as the customer sees it (web view of the PDF). */
export function QuoteDocument({ q }: { q: QuoteDetail }) {
	const business = q.business;
	return (
		<article className="rounded-xl border bg-card p-6 sm:p-8">
			<header className="flex flex-wrap justify-between gap-4">
				<div className="flex items-start gap-3">
					<img src="/orbyte-icon.png" alt="Orbyte" className="mt-0.5 size-9" />
					<div>
						<h1 className="text-xl font-bold">{business?.name}</h1>
						<p className="text-sm text-muted-foreground">{business?.address}</p>
						<p className="text-sm text-muted-foreground">{business?.phone}</p>
					</div>
				</div>
				<div className="sm:text-right">
					<p className="text-xl font-bold tracking-wide">QUOTATION</p>
					<p className="font-medium">{q.number}</p>
					<div className="mt-1">
						<StatusBadge status={quoteBadge(q.status)} />
					</div>
				</div>
			</header>

			<div className="mt-8 flex flex-wrap justify-between gap-4 text-sm">
				<div>
					<p className="text-muted-foreground">Prepared for</p>
					<p className="font-semibold">{q.conversation?.customerName}</p>
					{q.conversation?.customerPhone && (
						<p className="text-muted-foreground">
							{q.conversation.customerPhone}
						</p>
					)}
				</div>
				<div className="text-muted-foreground sm:text-right">
					<p>
						Date: {(q.decidedAt ?? q.createdAt).toLocaleDateString("en-MY")}
					</p>
					<p>Valid until: {q.validUntil.toLocaleDateString("en-MY")}</p>
					{q.decidedBy && q.decidedAt && (
						<p>
							{q.status === "rejected" ? "Rejected" : "Approved"} by{" "}
							{q.decidedBy.name}, {q.decidedAt.toLocaleDateString("en-MY")}
						</p>
					)}
				</div>
			</div>

			{groupLines(q.lineItems).map((group) => (
				<div key={group.charge} className="mt-8 overflow-x-auto">
					{group.charge !== "one_time" && (
						<h2 className="mb-1 text-sm font-semibold">
							{group.charge === "optional"
								? "Optional add-ons (not included in the total)"
								: `${chargeLabel[group.charge]} fees (not included in the total)`}
						</h2>
					)}
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left text-muted-foreground">
								<th className="py-2 font-medium">Description</th>
								<th className="py-2 text-right font-medium">Qty</th>
								<th className="py-2 text-right font-medium">Unit price</th>
								<th className="py-2 text-right font-medium">Amount</th>
							</tr>
						</thead>
						<tbody>
							{group.lines.map(({ line: l, index }) => (
								<tr
									key={`${index}-${l.description}`}
									className="border-b align-top"
								>
									<td className="py-2 pr-2">
										{l.description}
										{l.notes && (
											<p className="text-xs text-muted-foreground">{l.notes}</p>
										)}
									</td>
									<td className="py-2 text-right whitespace-nowrap">
										{l.quantity} {l.unit}
									</td>
									<td className="py-2 pl-2 text-right whitespace-nowrap tabular-nums">
										{formatMYR(l.unitPriceSen)}
									</td>
									<td className="py-2 pl-2 text-right whitespace-nowrap tabular-nums">
										{formatMYR(l.amountSen)}
										{chargeSuffix[group.charge]}
									</td>
								</tr>
							))}
						</tbody>
					</table>
					{group.charge === "one_time" && (
						<dl className="mt-4 ml-auto w-full max-w-64 space-y-1 text-sm">
							<div className="flex justify-between text-muted-foreground">
								<dt>Subtotal</dt>
								<dd className="tabular-nums">{formatMYR(q.subtotalSen)}</dd>
							</div>
							{business?.sstRegistered && (
								<div className="flex justify-between text-muted-foreground">
									<dt>SST ({business.sstRateBps / 100}%)</dt>
									<dd className="tabular-nums">{formatMYR(q.sstSen)}</dd>
								</div>
							)}
							<div className="flex justify-between border-t pt-1 text-base font-semibold">
								<dt>Total</dt>
								<dd className="tabular-nums">{formatMYR(q.totalSen)}</dd>
							</div>
						</dl>
					)}
				</div>
			))}

			{hasTerms(q.terms) && (
				<QuoteTermsView terms={q.terms} totalSen={q.totalSen} />
			)}

			{q.notes && (
				<section className="mt-8 text-sm">
					<h2 className="font-semibold">Notes</h2>
					<p className="whitespace-pre-wrap text-muted-foreground">{q.notes}</p>
				</section>
			)}
			{q.requirementsSnapshot && (
				<section className="mt-8 border-t pt-4 text-sm">
					<h2 className="font-semibold">
						Requirements included in this quotation
					</h2>
					<ul className="mt-2 space-y-1">
						{agreementLines(q.requirementsSnapshot).map((line, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: read-only list that never reorders; entries can repeat, so the position is the identity
							<li key={`${i}:${line}`}>{line}</li>
						))}
					</ul>
				</section>
			)}

			{q.status === "accepted" && q.signatureImage && (
				<section className="mt-8 border-t pt-4 text-sm">
					<p className="text-muted-foreground">Accepted and signed by</p>
					<img
						src={q.signatureImage}
						alt={`Signature of ${q.signerName}`}
						className="my-1 h-16 w-auto"
					/>
					<p className="font-semibold">{q.signerName}</p>
					{q.signedAt && (
						<p className="text-xs text-muted-foreground">
							{q.signedAt.toLocaleString("en-MY")} · via Orbyte eSign
						</p>
					)}
				</section>
			)}

			<p className="mt-10 text-xs text-muted-foreground">
				Demo document generated by Quora Chat with synthetic data. Not a real
				business or tax invoice.
			</p>
		</article>
	);
}

/** Timeline, payment schedule, and what is and isn't included. */
export function QuoteTermsView({
	terms,
	totalSen,
}: {
	terms: NonNullable<QuoteDetail["terms"]>;
	totalSen: number;
}) {
	return (
		<section className="mt-8 grid gap-6 border-t pt-4 text-sm sm:grid-cols-2">
			{terms.phases.length > 0 && (
				<div>
					<h2 className="font-semibold">
						Timeline · about {totalWeeks(terms)} weeks
					</h2>
					<ol className="mt-2 space-y-1">
						{terms.phases.map((p, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: read-only list that never reorders; entries can repeat, so the position is the identity
							<li key={`${i}-${p.name}`} className="flex justify-between gap-2">
								<span>
									{i + 1}. {p.name}
								</span>
								<span className="text-muted-foreground tabular-nums">
									{p.weeks} {p.weeks === 1 ? "week" : "weeks"}
								</span>
							</li>
						))}
					</ol>
				</div>
			)}
			{terms.payments.length > 0 && (
				<div>
					<h2 className="font-semibold">Payment schedule</h2>
					<ul className="mt-2 space-y-1">
						{paymentAmounts(terms, totalSen).map((p, i) => (
							<li
								// biome-ignore lint/suspicious/noArrayIndexKey: read-only list that never reorders; entries can repeat, so the position is the identity
								key={`${i}-${p.label}`}
								className="flex justify-between gap-2"
							>
								<span>
									{p.percent}% {p.label}
									{p.when ? ` · ${triggerLabel(p)}` : ""}
								</span>
								<span className="tabular-nums">{formatMYR(p.amountSen)}</span>
							</li>
						))}
					</ul>
				</div>
			)}
			{terms.assumptions.length > 0 && (
				<div>
					<h2 className="font-semibold">Assumptions</h2>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
						{terms.assumptions.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				</div>
			)}
			{terms.exclusions.length > 0 && (
				<div>
					<h2 className="font-semibold">Not included</h2>
					<ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
						{terms.exclusions.map((a) => (
							<li key={a}>{a}</li>
						))}
					</ul>
				</div>
			)}
		</section>
	);
}
