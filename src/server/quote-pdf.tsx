import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
	Document,
	Font,
	Page,
	renderToBuffer,
	StyleSheet,
	Text,
	View,
} from "@react-pdf/renderer";
import type { schema } from "#/db";
import { agreementLines } from "#/lib/agreements";
import {
	chargeLabel,
	chargeSuffix,
	groupLines,
	hasTerms,
	paymentAmounts,
	totalWeeks,
} from "#/lib/quote-lines";
import { formatMYR } from "./pricing";

type Quote = typeof schema.quotes.$inferSelect;
type Business = typeof schema.businesses.$inferSelect;

const sourceFont = resolve("public/fonts/NotoSansSC-Regular.otf");
Font.register({
	family: "NotoSansSC",
	src: existsSync(sourceFont)
		? sourceFont
		: resolve(".output/public/fonts/NotoSansSC-Regular.otf"),
});

const s = StyleSheet.create({
	page: {
		padding: 40,
		fontSize: 10,
		fontFamily: "NotoSansSC",
		color: "#18181b",
	},
	row: { flexDirection: "row" },
	between: { flexDirection: "row", justifyContent: "space-between" },
	h1: { fontSize: 18, fontFamily: "NotoSansSC" },
	muted: { color: "#71717a" },
	th: {
		flexDirection: "row",
		borderBottomWidth: 1,
		borderColor: "#d4d4d8",
		paddingBottom: 4,
		marginTop: 24,
		fontFamily: "Helvetica-Bold",
	},
	tr: {
		flexDirection: "row",
		borderBottomWidth: 0.5,
		borderColor: "#e4e4e7",
		paddingVertical: 6,
	},
	cDesc: { flex: 1 },
	cQty: { width: 60, textAlign: "right" },
	cUnit: { width: 80, textAlign: "right" },
	cAmt: { width: 80, textAlign: "right" },
	totals: { marginTop: 12, marginLeft: "auto", width: 220 },
	totalRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		paddingVertical: 2,
	},
	bold: { fontFamily: "NotoSansSC", fontSize: 10.5 },
	footer: {
		position: "absolute",
		bottom: 30,
		left: 40,
		right: 40,
		fontSize: 8,
		color: "#a1a1aa",
	},
});

export async function renderQuotePdf(input: {
	quote: Quote;
	business: Business;
	customerName: string;
}) {
	const { quote, business, customerName } = input;
	const sstPct = (business.sstRateBps / 100).toFixed(0);

	const doc = (
		<Document title={quote.number} author={business.name}>
			<Page size="A4" style={s.page}>
				<View style={s.between}>
					<View>
						<Text style={s.h1}>{business.name}</Text>
						<Text style={s.muted}>{business.address}</Text>
						<Text style={s.muted}>{business.phone}</Text>
					</View>
					<View style={{ alignItems: "flex-end" }}>
						<Text style={s.h1}>QUOTATION</Text>
						<Text>{quote.number}</Text>
						<Text style={s.muted}>
							{quote.status === "accepted"
								? "Signed by customer"
								: quote.status === "approved"
									? "Approved"
									: quote.status === "superseded"
										? "Replaced by a newer revision"
										: quote.status === "lost"
											? "Lost - no longer open for signing"
											: quote.status === "rejected"
												? "Rejected"
												: "DRAFT - not yet approved"}
						</Text>
					</View>
				</View>

				<View style={[s.between, { marginTop: 24 }]}>
					<View>
						<Text style={s.muted}>Prepared for</Text>
						<Text style={s.bold}>{customerName}</Text>
					</View>
					<View style={{ alignItems: "flex-end" }}>
						<Text style={s.muted}>
							Date: {quote.createdAt.toLocaleDateString("en-MY")}
						</Text>
						<Text style={s.muted}>
							Valid until: {quote.validUntil.toLocaleDateString("en-MY")}
						</Text>
					</View>
				</View>

				{groupLines(quote.lineItems).map((group) => (
					<View key={group.charge}>
						{group.charge !== "one_time" ? (
							<Text style={[s.bold, { marginTop: 20 }]}>
								{group.charge === "optional"
									? "Optional add-ons (not included in the total)"
									: `${chargeLabel[group.charge]} fees (not included in the total)`}
							</Text>
						) : null}
						<View
							style={[
								s.th,
								group.charge !== "one_time" ? { marginTop: 6 } : {},
							]}
						>
							<Text style={s.cDesc}>Description</Text>
							<Text style={s.cQty}>Qty</Text>
							<Text style={s.cUnit}>Unit price</Text>
							<Text style={s.cAmt}>Amount</Text>
						</View>
						{group.lines.map(({ line: l, index }) => (
							<View style={s.tr} key={`${index}-${l.description}`}>
								<View style={s.cDesc}>
									<Text>{l.description}</Text>
									{l.notes ? <Text style={s.muted}>{l.notes}</Text> : null}
								</View>
								<Text style={s.cQty}>
									{l.quantity} {l.unit}
								</Text>
								<Text style={s.cUnit}>{formatMYR(l.unitPriceSen)}</Text>
								<Text style={s.cAmt}>
									{formatMYR(l.amountSen)}
									{chargeSuffix[group.charge]}
								</Text>
							</View>
						))}
						{group.charge === "one_time" ? (
							<View style={s.totals}>
								<View style={s.totalRow}>
									<Text>Subtotal</Text>
									<Text>{formatMYR(quote.subtotalSen)}</Text>
								</View>
								{business.sstRegistered ? (
									<View style={s.totalRow}>
										<Text>SST ({sstPct}%)</Text>
										<Text>{formatMYR(quote.sstSen)}</Text>
									</View>
								) : null}
								<View
									style={[
										s.totalRow,
										s.bold,
										{ borderTopWidth: 1, marginTop: 4, paddingTop: 4 },
									]}
								>
									<Text>Total</Text>
									<Text>{formatMYR(quote.totalSen)}</Text>
								</View>
							</View>
						) : null}
					</View>
				))}

				{hasTerms(quote.terms) ? (
					<View style={{ marginTop: 24 }} wrap={false}>
						{quote.terms.phases.length ? (
							<View>
								<Text style={s.bold}>
									Timeline · about {totalWeeks(quote.terms)} weeks
								</Text>
								{quote.terms.phases.map((p, i) => (
									<View
										key={`${i}-${p.name}`}
										style={[s.between, { marginTop: 3 }]}
									>
										<Text>
											{i + 1}. {p.name}
										</Text>
										<Text style={s.muted}>
											{p.weeks} {p.weeks === 1 ? "week" : "weeks"}
										</Text>
									</View>
								))}
							</View>
						) : null}
						{quote.terms.payments.length ? (
							<View style={{ marginTop: 14 }}>
								<Text style={s.bold}>Payment schedule</Text>
								{paymentAmounts(quote.terms, quote.totalSen).map((p, i) => (
									<View
										key={`${i}-${p.label}`}
										style={[s.between, { marginTop: 3 }]}
									>
										<Text>
											{p.percent}% {p.label}
										</Text>
										<Text>{formatMYR(p.amountSen)}</Text>
									</View>
								))}
							</View>
						) : null}
						{quote.terms.assumptions.length ? (
							<View style={{ marginTop: 14 }}>
								<Text style={s.bold}>Assumptions</Text>
								{quote.terms.assumptions.map((a) => (
									<Text key={a} style={[s.muted, { marginTop: 2 }]}>
										• {a}
									</Text>
								))}
							</View>
						) : null}
						{quote.terms.exclusions.length ? (
							<View style={{ marginTop: 14 }}>
								<Text style={s.bold}>Not included</Text>
								{quote.terms.exclusions.map((a) => (
									<Text key={a} style={[s.muted, { marginTop: 2 }]}>
										• {a}
									</Text>
								))}
							</View>
						) : null}
					</View>
				) : null}

				{quote.notes ? (
					<View style={{ marginTop: 24 }}>
						<Text style={s.bold}>Notes</Text>
						<Text>{quote.notes}</Text>
					</View>
				) : null}
				{quote.requirementsSnapshot && (
					<View style={{ marginTop: 24 }}>
						<Text style={s.bold}>Requirements included in this quotation</Text>
						{agreementLines(quote.requirementsSnapshot).map((line, i) => (
							<Text key={`${i}:${line}`} style={{ marginTop: 4 }}>
								{line}
							</Text>
						))}
					</View>
				)}

				<Text style={s.footer} fixed>
					Demo document generated by Quora Chat with synthetic data. Not a real
					business or tax invoice.
				</Text>
			</Page>
		</Document>
	);

	return renderToBuffer(doc);
}
