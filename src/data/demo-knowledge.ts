/**
 * Synthetic, team-created knowledge-base documents for the demo businesses.
 * Procedures, timings and policies are illustrative, not professional advice.
 * "internal" docs are for the team AI only; "public" docs may be used by the
 * customer-facing WhatsApp assistant.
 */
export type DemoDoc = {
	title: string;
	category: string;
	visibility: "internal" | "public";
	body: string;
};

export const demoKnowledge: Record<string, DemoDoc[]> = {
	"kilat-print": [
		{
			title: "Artwork pre-flight checks",
			category: "SOP",
			visibility: "internal",
			body: `Check every artwork file before it goes to the printer.

Bleed: 3mm on every side. Keep text and logos at least 5mm inside the trim line.

Colour: files must be CMYK. If a customer sends RGB, convert it and warn them through sales that bright blues and greens may print duller.

Resolution: images at 300dpi at print size. Below 200dpi, flag it to sales before printing.

Fonts: outlined or embedded. Missing fonts are a blocker; don't substitute without approval.

Proof: runs above 500 pcs need a signed-off digital proof before printing. Below that, print once the checks pass.`,
		},
		{
			title: "Production lead times",
			category: "SOP",
			visibility: "internal",
			body: `Lead times count from artwork approval, not from payment.

Flyers: 2 working days. Name cards: 3 working days. Banners and buntings: 1 working day.

Rush (next day) is only possible if Ravi confirms a machine slot. Never promise rush to a customer before he does.

Large runs above 5,000 pcs: add 1 working day for cutting and packing.`,
		},
		{
			title: "Delivery and pickup",
			category: "Policy",
			visibility: "internal",
			body: `Self pickup: from the counter, Mon–Sat 9am–7pm. Counter staff call the customer when the job passes QC.

Delivery: Klang Valley only, booked by counter staff after QC, normally the same afternoon. Outside Klang Valley goes by courier, 2–3 working days.

Damaged in delivery: reprint at our cost if the customer reports it within 24 hours with a photo.`,
		},
		{
			title: "Customer FAQ: artwork and collection",
			category: "FAQ",
			visibility: "public",
			body: `We accept artwork as PDF, AI or high-resolution PNG/JPG. PDF works best.

No artwork yet? Our team can design it for you. Ask us and we'll include it in the quotation.

Pickup is at our Petaling Jaya counter, Mon–Sat 9am–7pm. We'll message you when your order is ready.`,
		},
	],
	sejukmax: [
		{
			title: "Chemical wash procedure",
			category: "SOP",
			visibility: "internal",
			body: `Before starting: switch off the isolator, cover furniture and the wall below the indoor unit, and photograph the unit (before photo for the job record).

Wall-mounted: one technician, about 60–90 minutes per unit. Ceiling cassette: two technicians, about 2 hours, and bring the tall ladder.

After: run the unit for 15 minutes, check drainage and the outlet temperature (should be 12–16°C), take an after photo, and get the customer to sign the job sheet.`,
		},
		{
			title: "Warranty and callbacks",
			category: "Policy",
			visibility: "internal",
			body: `Servicing has a 30-day workmanship warranty. A callback inside 30 days for the same problem is free; log it against the original job.

Gas top-up is not covered if the cause is a leak; quote the leak repair first through sales.

New units we install: 1 year on installation workmanship. Manufacturer warranty is separate and handled by the brand.`,
		},
		{
			title: "Customer FAQ: before our visit",
			category: "FAQ",
			visibility: "public",
			body: `Please make sure someone 18 or older is home, and that we can reach the indoor and outdoor units easily.

If you live in a condo, let management know we're coming and reserve visitor parking if needed.

A normal wash takes about 1 to 1.5 hours per wall unit.`,
		},
	],
	"rumah-rapi": [
		{
			title: "Site visit checklist",
			category: "SOP",
			visibility: "internal",
			body: `Measure and photograph every area in the quotation. Note the floor and wall condition, and any hollow tiles (tap test).

Check access: lift booking, loading bay, working hours allowed by management, and where we can store materials.

Confirm with the customer what stays and what we remove. Anything unclear becomes a question for sales, not a promise on site.`,
		},
		{
			title: "Tiling standards",
			category: "SOP",
			visibility: "internal",
			body: `Remove hollow tiles fully; never tile over them. Waterproof wet areas with two coats and a 24-hour flood test before tiling.

Leave 2mm joints for homogeneous tiles and use levelling clips for anything 600×600 and above.

Order 10% extra tiles for cuts and breakage; return unopened boxes to the supplier within 7 days.`,
		},
		{
			title: "Customer FAQ: before renovation starts",
			category: "FAQ",
			visibility: "public",
			body: `For condos and apartments, please get renovation approval from your management office before we start. We can send our company documents for the application.

Clear the work area of valuables and fragile items. We cover floors and furniture, but dust is unavoidable.

Work normally runs Mon–Sat, 9am–6pm, unless your management allows otherwise.`,
		},
	],
	kodkraf: [
		{
			title: "Project kickoff",
			category: "SOP",
			visibility: "internal",
			body: `Within 5 working days of signing: hold a discovery workshop with the customer (through sales for scheduling) and confirm the user roles, data to migrate and integrations.

Set up a staging environment before writing features. The customer gets a staging link from week 2.

Weekly demo every Friday. Anything the customer asks for that isn't in the signed scope is a change request: log it and send it to sales; never agree to it in a demo.`,
		},
		{
			title: "Engineering standards",
			category: "SOP",
			visibility: "internal",
			body: `Every change goes through a pull request with one reviewer. Main is always deployable.

Hosting: our managed cloud in the Singapore region, daily backups kept for 14 days. Customer data never goes into test environments without anonymising it.

Login: email and password with 2FA by default. Google or Microsoft sign-in is an add-on; check whether it was in the signed scope.`,
		},
		{
			title: "Handover and support",
			category: "Policy",
			visibility: "internal",
			body: `After go-live: 30 days of free bug fixes for anything in the signed scope. New features after that are a new quotation.

Hand over: admin credentials, a short user guide, and a 1-hour training session (online or on site in Klang Valley).

Support plans start after the 30 days; the monthly plan covers hosting, backups, security updates and up to 4 hours of small changes.`,
		},
		{
			title: "Customer FAQ: how we work",
			category: "FAQ",
			visibility: "public",
			body: `You'll get a staging link early on and a demo every week, so you can see progress and give feedback as we go.

You own the source code once the project is fully paid.

After launch, we fix bugs in the agreed scope free for 30 days. Ongoing support and hosting are available as a monthly plan.`,
		},
	],
	"amanah-kira": [
		{
			title: "Audit engagement procedure",
			category: "SOP",
			visibility: "internal",
			body: `Before any work: signed engagement letter and an independence check for every team member on the job. No fieldwork until both are on file.

Send the document request list in week 1: trial balance, general ledger, bank statements and confirmations, fixed asset register, and the prior year's audited accounts.

Fieldwork usually takes 1–2 weeks for small companies. Draft accounts to the client within 3 weeks of receiving complete documents.`,
		},
		{
			title: "Filing deadlines (internal reminder)",
			category: "Policy",
			visibility: "internal",
			body: `Plan backwards from the client's deadlines. Illustrative internal targets for the demo:

Audited accounts ready at least 1 month before the client's tax filing deadline.

Tax return (Form C) is due within 7 months of the financial year end. Aim to file 2 weeks early.

Always confirm current deadlines with the latest official guidance before telling a client.`,
		},
		{
			title: "Customer FAQ: preparing for your audit",
			category: "FAQ",
			visibility: "public",
			body: `Please prepare your trial balance, general ledger, bank statements for the full financial year, your fixed asset list, and last year's audited accounts.

Sending complete documents early is the best way to keep the audit on schedule.

Our team will send you a full document checklist once the engagement letter is signed.`,
		},
	],
};
