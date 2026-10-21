/**
 * Demo content for the existing Orbyte modules (People, Work, Connect).
 * No backend yet. Each type mirrors a future table, so these functions can
 * later be swapped for API calls without touching the pages.
 */

type StaffLike = { id: string; name: string; role: string };

export type LeaveRequest = {
	id: string;
	staffName: string;
	type: "Annual" | "Medical" | "Emergency";
	from: string;
	to: string;
	days: number;
	status: "pending" | "approved" | "rejected";
};

export type Claim = {
	id: string;
	staffName: string;
	item: string;
	amountSen: number;
	status: "pending" | "approved" | "paid";
};

export type DailyStatus = {
	staffName: string;
	today: string;
	state: "on_track" | "blocked" | "done";
};

export type Project = {
	name: string;
	owner: string;
	progress: number; // 0–100
	due: string;
};

export type Integration = {
	name: string;
	category: string;
	description: string;
	status: "connected" | "available" | "coming_soon";
};

const pick = <T>(list: T[], i: number) => list[i % list.length];

export function getLeaveRequests(staff: StaffLike[]): LeaveRequest[] {
	const rows: Omit<LeaveRequest, "id" | "staffName">[] = [
		{
			type: "Annual",
			from: "2026-11-03",
			to: "2026-11-05",
			days: 3,
			status: "pending",
		},
		{
			type: "Medical",
			from: "2026-10-14",
			to: "2026-10-14",
			days: 1,
			status: "approved",
		},
		{
			type: "Annual",
			from: "2026-12-24",
			to: "2026-12-31",
			days: 5,
			status: "pending",
		},
		{
			type: "Emergency",
			from: "2026-10-02",
			to: "2026-10-02",
			days: 1,
			status: "approved",
		},
	];
	return rows.map((r, i) => ({
		...r,
		id: `leave-${i}`,
		staffName: pick(staff, i + 1).name,
	}));
}

export function getClaims(staff: StaffLike[]): Claim[] {
	const rows: Omit<Claim, "id" | "staffName">[] = [
		{
			item: "Petrol & toll — site visits",
			amountSen: 18640,
			status: "pending",
		},
		{ item: "Parking, Mid Valley", amountSen: 1200, status: "approved" },
		{ item: "Client lunch", amountSen: 9850, status: "paid" },
	];
	return rows.map((r, i) => ({
		...r,
		id: `claim-${i}`,
		staffName: pick(staff, i).name,
	}));
}

export function getDailyStatus(
	staff: StaffLike[],
	industry: string,
): DailyStatus[] {
	const tasks: Record<string, string[]> = {
		Printing: [
			"Reviewing today's quotation queue",
			"Printing 2,000 A5 flyers for Kedai Runcit Maju",
			"Waiting for banner artwork from customer",
		],
		"Aircon servicing": [
			"Approving this week's service quotes",
			"Scheduling chemical washes in Shah Alam",
			"Install job at Taman Melawati — waiting on bracket",
		],
		"Renovation & handyman": [
			"Site visit: kitchen tiling, Cheras",
			"Ordering paint for 3-room job",
			"Waiting for owner to confirm colour",
		],
	};
	const list = tasks[industry] ?? tasks.Printing;
	return staff.map((s, i) => ({
		staffName: s.name,
		today: pick(list, i),
		state: pick<DailyStatus["state"]>(["on_track", "done", "blocked"], i),
	}));
}

export function getProjects(staff: StaffLike[]): Project[] {
	return [
		{
			name: "Move quoting to Orbyte Quotation",
			owner: pick(staff, 0).name,
			progress: 70,
			due: "2026-11-15",
		},
		{
			name: "Year-end promotion",
			owner: pick(staff, 1).name,
			progress: 35,
			due: "2026-12-01",
		},
		{
			name: "Update supplier price list",
			owner: pick(staff, 2).name,
			progress: 90,
			due: "2026-10-31",
		},
	];
}

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
