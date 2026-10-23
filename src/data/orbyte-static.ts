/**
 * Demo content for the existing Orbyte Connect module.
 * No backend yet. Each type mirrors a future table, so these functions can
 * later be swapped for API calls without touching the pages.
 */

export type Integration = {
	name: string;
	category: string;
	description: string;
	status: "connected" | "available" | "coming_soon";
};

export const integrations: Integration[] = [
	{
		name: "WhatsApp Business",
		category: "Messaging",
		description:
			"Customer chats flow into the Quotation inbox. Quora Chat replies and sends quotes.",
		status: "connected",
	},
	{
		name: "Orbyte eSign",
		category: "Documents",
		description:
			"Customers sign approved quotations online with a full audit log.",
		status: "connected",
	},
	{
		name: "Accounting software",
		category: "Accounting",
		description:
			"Turn signed quotations into invoices and sync your product list.",
		status: "available",
	},
	{
		name: "LHDN MyInvois",
		category: "Government",
		description: "Submit e-invoices for accepted quotations.",
		status: "coming_soon",
	},
	{
		name: "DuitNow QR",
		category: "Payments",
		description: "Collect deposits when a customer signs.",
		status: "available",
	},
	{
		name: "Google Sheets",
		category: "Spreadsheets",
		description: "Export quotes and pipeline reports.",
		status: "available",
	},
	{
		name: "Payroll",
		category: "HR",
		description: "Send approved claims and leave to payroll.",
		status: "available",
	},
	{
		name: "E-commerce store",
		category: "Sales",
		description: "Share one product catalog between your shop and quotations.",
		status: "coming_soon",
	},
];
