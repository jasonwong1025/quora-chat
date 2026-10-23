/**
 * Synthetic price lists for the demo's custom-priced items. Each is shaped to its
 * trade: software has phases, hosting and maintenance; audit has fee bands; a
 * contractor prices by area; printing is paid in full with no timeline.
 * Amounts are illustrative only.
 */
import type { Charge, PriceBuilder, PriceComponent } from "#/db/schema";

let n = 0;
function part(
	label: string,
	rm: number,
	o: {
		charge?: Charge;
		when?: [string, string];
		per?: "quantity" | [key: string, unit: string];
		weeks?: number;
		note?: string;
	} = {},
): PriceComponent {
	n++;
	return {
		id: `c${n}`,
		label,
		charge: o.charge ?? "one_time",
		when: o.when ? { key: o.when[0], equals: o.when[1] } : null,
		amountSen: Math.round(rm * 100),
		per:
			o.per === "quantity"
				? { kind: "quantity" }
				: o.per
					? { kind: "answer", key: o.per[0], unit: o.per[1] }
					: { kind: "fixed" },
		weeks: o.weeks ?? null,
		note: o.note ?? null,
	};
}

const hostingAndCare = (hostingRm: number, careRm: number) => [
	part("Cloud hosting & backups", hostingRm, {
		charge: "monthly",
		when: ["after_launch", "hosting + maintenance"],
	}),
	part("Maintenance & support", careRm, {
		charge: "monthly",
		when: ["after_launch", "hosting + maintenance"],
		note: "Updates, security patches, backups and small changes",
	}),
	part("Cloud hosting & backups", hostingRm, {
		charge: "monthly",
		when: ["after_launch", "hosting only"],
	}),
];

export const demoPriceLists: Record<string, PriceBuilder> = {
	// --- KodKraf (software house) ---------------------------------------------------
	"kd-mobile-app": {
		rate: { amountSen: 12000, unit: "hour" },
		components: [
			part("Project setup, UI/UX design & app store publishing", 6000, {
				weeks: 1,
			}),
			part("App screens (design & build)", 900, {
				per: ["screen_count", "screen"],
			}),
			part("Backend & API", 8000),
			part("User login & accounts", 3000, {
				when: ["features", "login / accounts"],
				weeks: 1,
			}),
			part("Payment gateway (FPX & cards)", 4500, {
				when: ["features", "payments"],
				weeks: 1,
			}),
			part("Push notifications", 1800, {
				when: ["features", "push notifications"],
			}),
			part("Booking & scheduling", 6000, {
				when: ["features", "booking"],
				weeks: 2,
			}),
			part("In-app chat", 7000, { when: ["features", "chat"], weeks: 2 }),
			part("Maps & location", 2500, { when: ["features", "maps / location"] }),
			part("Separate customer & staff roles", 3500, {
				when: ["app_users", "both"],
				weeks: 1,
			}),
			part("Admin dashboard", 7500, { when: ["admin_panel", "yes"], weeks: 2 }),
			part("Integration with your existing system", 6000, {
				when: ["has_backend", "yes"],
				weeks: 2,
			}),
			...hostingAndCare(250, 1200),
			part("Analytics dashboard (GA4 / Firebase)", 1500, {
				charge: "optional",
			}),
			part("Staff training session (half day)", 800, { charge: "optional" }),
		],
		phases: [
			{ name: "Discovery & design", weeks: 2 },
			{ name: "Development", weeks: 6 },
			{ name: "Testing (UAT)", weeks: 2 },
			{ name: "Launch", weeks: 1 },
		],
		payments: [
			{ label: "Deposit on signing", percent: 40 },
			{ label: "After testing (UAT) sign-off", percent: 40 },
			{ label: "On launch", percent: 20 },
		],
		assumptions: [
			"One round of design revisions per screen",
			"Text and images supplied by you",
			"Scope as listed in the requirements below",
		],
		exclusions: [
			"Apple/Google developer account fees (paid by you directly)",
			"Third-party fees such as payment gateway or SMS charges",
			"New features after sign-off (quoted separately)",
		],
	},
	"kd-ecommerce": {
		rate: { amountSen: 10000, unit: "hour" },
		components: [
			part("Online shop setup & design", 5500, { weeks: 1 }),
			part("Product upload & setup", 8, { per: ["product_count", "product"] }),
			part("FPX online banking", 1200, {
				when: ["payments", "FPX online banking"],
			}),
			part("Credit/debit card payments", 1200, {
				when: ["payments", "credit/debit card"],
			}),
			part("E-wallet payments (TnG, GrabPay)", 1500, {
				when: ["payments", "e-wallet (TnG, GrabPay)"],
			}),
			part("Cash on delivery option", 400, {
				when: ["payments", "cash on delivery"],
			}),
			part("Courier integration (J&T, Pos Laju)", 2500, {
				when: ["shipping", "yes"],
				weeks: 1,
			}),
			part("Move existing products & customers", 1500, {
				when: ["selling_now", "yes"],
			}),
			...hostingAndCare(120, 450),
			part("SEO setup (Google listing, sitemap)", 1200, { charge: "optional" }),
		],
		phases: [
			{ name: "Design", weeks: 1 },
			{ name: "Build", weeks: 3 },
			{ name: "Testing & launch", weeks: 1 },
		],
		payments: [
			{ label: "Deposit on signing", percent: 50 },
			{ label: "On launch", percent: 50 },
		],
		assumptions: [
			"Product photos and descriptions supplied by you",
			"One round of design revisions",
		],
		exclusions: [
			"Payment gateway and courier fees (charged by the providers)",
			"Domain name renewal",
		],
	},
	"kd-custom-system": {
		rate: { amountSen: 12000, unit: "hour" },
		components: [
			part("Discovery workshop & system design", 4000, { weeks: 1 }),
			part("Core platform (users, roles, audit log)", 9000),
			part("Sales / CRM module", 8000, {
				when: ["modules", "sales / CRM"],
				weeks: 2,
			}),
			part("Inventory module", 9000, {
				when: ["modules", "inventory"],
				weeks: 2,
			}),
			part("HR & payroll module", 12000, {
				when: ["modules", "HR & payroll"],
				weeks: 3,
			}),
			part("Accounting module", 12000, {
				when: ["modules", "accounting"],
				weeks: 3,
			}),
			part("Booking / scheduling module", 7000, {
				when: ["modules", "booking / scheduling"],
				weeks: 2,
			}),
			part("Reports & dashboard", 5000, {
				when: ["modules", "reports & dashboard"],
				weeks: 1,
			}),
			part("User setup & training", 50, { per: ["user_count", "user"] }),
			part("Data migration from your current system", 4000, {
				when: ["has_system", "yes"],
				weeks: 1,
			}),
			part("Accounting software integration", 3500, {
				when: ["integrations", "accounting software"],
			}),
			part("Payment gateway integration", 3000, {
				when: ["integrations", "payment gateway"],
			}),
			part("WhatsApp integration", 3500, {
				when: ["integrations", "WhatsApp"],
			}),
			part("e-Invoice (LHDN MyInvois) integration", 5000, {
				when: ["integrations", "e-invoice (LHDN MyInvois)"],
				weeks: 1,
			}),
			part("Companion mobile app", 25000, {
				when: ["platforms", "web + mobile app"],
				weeks: 6,
			}),
			...hostingAndCare(400, 1500),
			part("On-site training day", 1500, { charge: "optional" }),
		],
		phases: [
			{ name: "Discovery", weeks: 2 },
			{ name: "Build", weeks: 6 },
			{ name: "User testing (UAT)", weeks: 2 },
			{ name: "Go-live", weeks: 1 },
		],
		payments: [
			{ label: "Deposit on signing", percent: 30 },
			{ label: "Mid-project demo", percent: 40 },
			{ label: "On go-live", percent: 30 },
		],
		assumptions: [
			"Workflow as described in the requirements below",
			"Your team is available for testing during UAT",
		],
		exclusions: [
			"Hardware (barcode scanners, printers, tablets)",
			"Licences for third-party software you connect to",
			"Changes after sign-off (quoted separately)",
		],
	},

	// --- Amanah Kira (accounting & audit) -------------------------------------------
	"ak-audit": {
		rate: { amountSen: 20000, unit: "hour" },
		components: [
			part("Statutory audit fee", 3500, { when: ["revenue", "below RM500k"] }),
			part("Statutory audit fee", 6500, { when: ["revenue", "RM500k–RM3m"] }),
			part("Statutory audit fee", 15000, { when: ["revenue", "RM3m–RM25m"] }),
			part("Statutory audit fee", 35000, { when: ["revenue", "above RM25m"] }),
			part("Higher transaction volume", 2000, {
				when: ["transactions", "500–2,000 a month"],
				weeks: 1,
			}),
			part("Higher transaction volume", 5000, {
				when: ["transactions", "over 2,000 a month"],
				weeks: 2,
			}),
			part("First-year audit (opening balances)", 2500, {
				when: ["first_audit", "yes"],
				weeks: 1,
			}),
			part("Group consolidation", 4000, {
				when: ["subsidiaries", "yes"],
				weeks: 1,
			}),
			part("Public company reporting requirements", 8000, {
				when: ["entity_type", "Berhad"],
				weeks: 1,
			}),
			part("Board / audit committee presentation", 800, { charge: "optional" }),
		],
		phases: [
			{ name: "Planning", weeks: 1 },
			{ name: "Fieldwork", weeks: 2 },
			{ name: "Reporting & sign-off", weeks: 2 },
		],
		payments: [
			{ label: "On engagement", percent: 50 },
			{ label: "Before the audit report is issued", percent: 50 },
		],
		assumptions: [
			"Books are closed and the trial balance is ready before fieldwork",
			"Fee is based on the information given; we'll confirm after reviewing the trial balance",
		],
		exclusions: [
			"Tax filing, bookkeeping and company secretarial work",
			"Travel outside the Klang Valley",
		],
	},

	// --- Rumah Rapi (renovation) --------------------------------------------------------
	"rr-waterproofing": {
		rate: { amountSen: 6000, unit: "hour" },
		components: [
			part("Site inspection & leak test", 150),
			part("Waterproofing membrane (labour & materials)", 9, {
				per: ["area_size", "sqft"],
			}),
			part("Roof surface preparation", 2, {
				when: ["area", "roof"],
				per: ["area_size", "sqft"],
			}),
			part("Hack & dispose existing tiles", 6, {
				when: ["tiles_removal", "yes"],
				per: ["area_size", "sqft"],
			}),
			part("Re-tiling after waterproofing", 12, {
				when: ["tiles_removal", "yes"],
				per: ["area_size", "sqft"],
				weeks: 1,
			}),
			part("5-year warranty (instead of 1 year)", 300, { charge: "optional" }),
		],
		phases: [
			{ name: "Inspection & preparation", weeks: 1 },
			{ name: "Waterproofing & curing", weeks: 1 },
		],
		payments: [
			{ label: "Deposit to book the date", percent: 50 },
			{ label: "On completion", percent: 50 },
		],
		assumptions: [
			"Area size confirmed during the site inspection",
			"Includes a 48-hour water ponding test",
		],
		exclusions: ["Plumbing repairs, if the leak is from a pipe"],
	},

	// --- Kilat Print (printing) -----------------------------------------------------------
	"kp-banner-custom": {
		rate: null,
		components: [
			part("Vinyl banner print", 3, { per: ["size", "sqft"] }),
			part("Outdoor UV-resistant vinyl", 0.8, {
				when: ["placement", "outdoor"],
				per: ["size", "sqft"],
			}),
			part("Eyelets & hemming", 10, { per: "quantity" }),
			part("Artwork layout", 50, { charge: "optional" }),
			part("Installation (Klang Valley)", 120, { charge: "optional" }),
		],
		phases: [],
		payments: [],
		assumptions: ["Print-ready artwork supplied by you unless layout is added"],
		exclusions: [],
	},
};
