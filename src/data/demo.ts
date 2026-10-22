/**
 * Synthetic, team-created demo data. Every business, person, address, phone
 * number and price here is fictional. SST rates are illustrative only.
 */
import type { PricingRuleConfig, ShowIf } from "#/db/schema";

type QuestionType =
	| "text"
	| "number"
	| "date"
	| "single"
	| "multi"
	| "yes_no"
	| "file";

/** A preset question. Pricing rules read the answer by `key`. */
export type DemoQuestion = {
	key: string;
	label: string;
	type: QuestionType;
	options?: string[];
	required?: boolean; // default true
	hint?: string;
	showIf?: ShowIf;
	/** Print the answer on the quotation line. Defaults to true for single/multi choice. */
	onQuote?: boolean;
};

type DemoProduct = {
	id: string;
	sku: string;
	/** Defaults to "service" (services and made-to-order work). */
	type?: "stock" | "service";
	stockOnHand?: number;
	/** "custom": staff price it from the requirement brief. Defaults to "fixed". */
	pricingMode?: "fixed" | "custom";
	category: string;
	name: string;
	description: string;
	unit: string;
	unitPriceSen: number;
	questions?: DemoQuestion[];
};

type DemoRule = {
	productId: string | null;
	description: string;
	config: PricingRuleConfig;
};

type DemoBusiness = {
	id: string;
	quotePrefix: string;
	name: string;
	industry: string;
	tagline: string;
	phone: string;
	address: string;
	openingHours: string;
	sstRateBps: number;
	quoteValidityDays: number;
	staff: { name: string; role: string; canApprove: boolean }[];
	/** Who gets the job when a quote in this category is signed (staff name). */
	categoryPics: Record<string, string>;
	/** Asked in every enquiry, once we know what they want. */
	businessQuestions: DemoQuestion[];
	/** Shared by every product in a category. */
	categoryQuestions: Record<string, DemoQuestion[]>;
	products: DemoProduct[];
	rules: DemoRule[];
	sampleMessages: { label: string; customerName: string; body: string }[];
};

const sides: DemoQuestion = {
	key: "sides",
	label: "Single or double sided?",
	type: "single",
	options: ["single", "double"],
};
const unitType: DemoQuestion = {
	key: "unit_type",
	label: "What type of aircon is it?",
	type: "single",
	options: ["wall-mounted", "ceiling cassette"],
};
const hp: DemoQuestion = {
	key: "hp",
	label: "What horsepower (HP)?",
	type: "single",
	options: ["1.0", "1.5", "2.0", "2.5"],
	hint: "Usually on the sticker on the indoor unit. If unsure, room size helps.",
};
const propertyType = (options: string[]): DemoQuestion => ({
	key: "property_type",
	label: "What type of property is it?",
	type: "single",
	options,
});

const revenueBands = [
	"below RM500k",
	"RM500k–RM3m",
	"RM3m–RM25m",
	"above RM25m",
];
const transactionBands = [
	"under 100 a month",
	"100–500 a month",
	"500–2,000 a month",
	"over 2,000 a month",
];
const budgetBands = [
	"below RM20k",
	"RM20k–RM50k",
	"RM50k–RM100k",
	"above RM100k",
	"not sure yet",
];

export const demoBusinesses: DemoBusiness[] = [
	// --- Printing ------------------------------------------------------------------
	{
		id: "kilat-print",
		quotePrefix: "KP",
		name: "Kilat Print Studio",
		industry: "Printing",
		tagline: "Flyers, name cards and banners — fast.",
		phone: "+60 3-0000 1101",
		address: "12, Jalan Contoh 3/1, 46000 Petaling Jaya, Selangor",
		openingHours: "Mon–Sat 9am–7pm",
		sstRateBps: 800,
		quoteValidityDays: 14,
		staff: [
			{ name: "Aina Rahman", role: "Owner", canApprove: true },
			{ name: "Lim Wei Jie", role: "Counter staff", canApprove: false },
			{ name: "Ravi Chandran", role: "Production lead", canApprove: false },
		],
		categoryPics: {
			Flyers: "Ravi Chandran",
			"Name cards": "Ravi Chandran",
			Banners: "Ravi Chandran",
			Services: "Ravi Chandran",
			"Display stands": "Lim Wei Jie",
			Boards: "Lim Wei Jie",
		},
		businessQuestions: [
			{
				key: "needed_by",
				label: "When do you need it by?",
				type: "date",
			},
			{
				key: "collection",
				label: "Self pickup or delivery?",
				type: "single",
				options: ["self pickup", "delivery"],
			},
			{
				key: "delivery_address",
				label: "What's the delivery address?",
				type: "text",
				showIf: { key: "collection", equals: "delivery" },
			},
		],
		categoryQuestions: {
			Flyers: [
				{
					key: "paper",
					label: "Which paper?",
					type: "single",
					options: ["128gsm art paper", "157gsm art paper"],
					hint: "157gsm is thicker and feels more premium.",
				},
				sides,
			],
			Banners: [
				{
					key: "artwork_ready",
					label: "Is the artwork ready, or do you need us to design it?",
					type: "single",
					options: ["artwork ready", "need design"],
				},
				{
					key: "artwork_file",
					label: "Can you send the artwork file?",
					type: "file",
					required: false,
					showIf: { key: "artwork_ready", equals: "artwork ready" },
				},
			],
		},
		products: [
			{
				id: "kp-flyer-a5",
				sku: "KP-FLY-A5",
				category: "Flyers",
				name: "Flyer A5",
				description: "Full-colour A5 flyer on art paper.",
				unit: "pc",
				unitPriceSen: 30,
			},
			{
				id: "kp-flyer-a4",
				sku: "KP-FLY-A4",
				category: "Flyers",
				name: "Flyer A4",
				description: "Full-colour A4 flyer on art paper.",
				unit: "pc",
				unitPriceSen: 50,
			},
			{
				id: "kp-namecard",
				sku: "KP-NC-100",
				category: "Name cards",
				name: "Name card (box of 100)",
				description: "310gsm art card, full colour.",
				unit: "box",
				unitPriceSen: 3500,
				questions: [
					{
						key: "finish",
						label: "Matte or gloss finish?",
						type: "single",
						options: ["matte", "gloss"],
					},
					sides,
				],
			},
			{
				id: "kp-banner-6x3",
				sku: "KP-BNR-6X3",
				category: "Banners",
				name: "Vinyl banner 6 x 3 ft",
				description: "Outdoor vinyl banner with eyelets.",
				unit: "pc",
				unitPriceSen: 4500,
			},
			{
				id: "kp-banner-10x4",
				sku: "KP-BNR-10X4",
				category: "Banners",
				name: "Vinyl banner 10 x 4 ft",
				description: "Outdoor vinyl banner with eyelets.",
				unit: "pc",
				unitPriceSen: 9500,
			},
			{
				id: "kp-banner-custom",
				sku: "KP-BNR-CUSTOM",
				pricingMode: "custom",
				category: "Banners",
				name: "Vinyl banner, custom size",
				description: "Any size not in the standard list.",
				unit: "pc",
				unitPriceSen: 0,
				questions: [
					{
						key: "size",
						label: "What size (width x height, in ft)?",
						type: "text",
					},
					{
						key: "placement",
						label: "Indoor or outdoor?",
						type: "single",
						options: ["indoor", "outdoor"],
					},
				],
			},
			{
				id: "kp-design",
				sku: "KP-SVC-DESIGN",
				category: "Services",
				name: "Artwork design",
				description: "Simple layout design by our designer, 2 revisions.",
				unit: "job",
				unitPriceSen: 8000,
				questions: [
					{
						key: "design_for",
						label: "What's the design for, and what should be on it?",
						type: "text",
						hint: "A rough idea is enough: event, business, key text.",
					},
				],
			},
			{
				id: "kp-rollup-stand",
				sku: "KP-STD-ROLLUP",
				type: "stock",
				stockOnHand: 12,
				category: "Display stands",
				name: "Roll-up banner stand 2 x 5 ft (stand only)",
				description:
					"Aluminium roll-up stand with carry bag. Print not included.",
				unit: "pc",
				unitPriceSen: 6500,
			},
			{
				id: "kp-x-stand",
				sku: "KP-STD-XSTAND",
				type: "stock",
				stockOnHand: 3,
				category: "Display stands",
				name: "X-banner stand 2 x 5 ft (stand only)",
				description: "Lightweight X-frame stand. Print not included.",
				unit: "pc",
				unitPriceSen: 2800,
			},
			{
				id: "kp-kt-board",
				sku: "KP-BRD-KT5",
				type: "stock",
				stockOnHand: 280,
				category: "Boards",
				name: "KT board 4 x 8 ft (5mm)",
				description: "Foam board sheet for mounting prints.",
				unit: "sheet",
				unitPriceSen: 3500,
			},
			{
				id: "kp-pp-sheet",
				sku: "KP-BRD-PP3",
				type: "stock",
				stockOnHand: 0,
				category: "Boards",
				name: "PP hollow sheet 4 x 8 ft (3mm)",
				description: "Corrugated plastic sheet for signage.",
				unit: "sheet",
				unitPriceSen: 3800,
			},
		],
		rules: [
			{
				productId: "kp-flyer-a5",
				description: "A5 flyer quantity tiers",
				config: {
					kind: "tier",
					tiers: [
						{ minQty: 1, unitPriceSen: 30 },
						{ minQty: 500, unitPriceSen: 18 },
						{ minQty: 1000, unitPriceSen: 12 },
					],
				},
			},
			{
				productId: "kp-flyer-a4",
				description: "A4 flyer quantity tiers",
				config: {
					kind: "tier",
					tiers: [
						{ minQty: 1, unitPriceSen: 50 },
						{ minQty: 500, unitPriceSen: 32 },
						{ minQty: 1000, unitPriceSen: 22 },
					],
				},
			},
			{
				productId: "kp-flyer-a5",
				description: "Double-sided A5 adds 5 sen per piece",
				config: {
					kind: "surcharge",
					when: { field: "sides", equals: "double" },
					perUnitSen: 5,
					label: "Double-sided",
				},
			},
			{
				productId: "kp-flyer-a4",
				description: "Double-sided A4 adds 8 sen per piece",
				config: {
					kind: "surcharge",
					when: { field: "sides", equals: "double" },
					perUnitSen: 8,
					label: "Double-sided",
				},
			},
			{
				productId: "kp-flyer-a5",
				description: "Minimum flyer job RM50",
				config: { kind: "minimum_charge", minSen: 5000 },
			},
			{
				productId: "kp-flyer-a4",
				description: "Minimum flyer job RM50",
				config: { kind: "minimum_charge", minSen: 5000 },
			},
			{
				productId: "kp-namecard",
				description: "5 boxes or more: RM30 per box",
				config: {
					kind: "tier",
					tiers: [
						{ minQty: 1, unitPriceSen: 3500 },
						{ minQty: 5, unitPriceSen: 3000 },
					],
				},
			},
			{
				productId: "kp-namecard",
				description: "Double-sided name cards add RM8 per box",
				config: {
					kind: "surcharge",
					when: { field: "sides", equals: "double" },
					perUnitSen: 800,
					label: "Double-sided",
				},
			},
			{
				productId: "kp-banner-6x3",
				description: "Banner design by us adds RM40",
				config: {
					kind: "surcharge",
					when: { field: "artwork_ready", equals: "need design" },
					amountSen: 4000,
					label: "Banner design",
				},
			},
			{
				productId: "kp-banner-10x4",
				description: "Banner design by us adds RM60",
				config: {
					kind: "surcharge",
					when: { field: "artwork_ready", equals: "need design" },
					amountSen: 6000,
					label: "Banner design",
				},
			},
			{
				productId: null,
				description: "Orders above 10,000 pieces need owner review",
				config: {
					kind: "requires_assessment",
					when: { quantityAbove: 10000 },
					reason: "Very large run — confirm press schedule and paper stock.",
				},
			},
		],
		sampleMessages: [
			{
				label: "Flyers, almost complete (Manglish)",
				customerName: "Encik Hafiz",
				body: "Hi boss, nak quote 500pcs flyer A5, 157gsm art paper, double sided. Need by next Friday.",
			},
			{
				label: "Missing details (Chinese)",
				customerName: "陈小姐",
				body: "你好，我要印名片，大概3盒，什么价钱？",
			},
			{
				label: "Custom size (English)",
				customerName: "Priya",
				body: "Can you print a banner 8 x 4 ft for my kedai opening? Plus 2 name card boxes, matte, single side.",
			},
			{
				label: "Vague request (BM)",
				customerName: "Kak Ros",
				body: "Saya nak buat flyer untuk kedai kek saya, berapa harga?",
			},
			{
				label: "Low stock (English)",
				customerName: "Ken",
				body: "Hi, I need 5 X-banner stands and 2 roll-up stands, stands only, no printing. For an expo this Saturday.",
			},
		],
	},

	// --- Aircon servicing --------------------------------------------------------------
	{
		id: "sejukmax",
		quotePrefix: "SM",
		name: "SejukMax Aircon Services",
		industry: "Aircon servicing",
		tagline: "Servicing, chemical wash and installation across Klang Valley.",
		phone: "+60 3-0000 2202",
		address: "8, Jalan Sampel 2, 47100 Puchong, Selangor",
		openingHours: "Mon–Sat 9am–6pm, Sun by appointment",
		sstRateBps: 800,
		quoteValidityDays: 7,
		staff: [
			{ name: "Kumar Selvam", role: "Owner", canApprove: true },
			{ name: "Nurul Izzah", role: "Admin", canApprove: true },
			{ name: "Danial Haris", role: "Technician", canApprove: false },
			{ name: "Faiz Rahim", role: "Store & logistics", canApprove: false },
		],
		categoryPics: {
			Servicing: "Danial Haris",
			Repair: "Danial Haris",
			Installation: "Danial Haris",
			"Aircon units": "Faiz Rahim",
			Parts: "Faiz Rahim",
		},
		businessQuestions: [
			{
				key: "service_area",
				label: "Which area is the place in?",
				type: "text",
				hint: "Taman / town is enough.",
			},
			propertyType(["landed house", "condo / apartment", "office / shop"]),
			{
				key: "preferred_date",
				label: "Any preferred date or time?",
				type: "date",
				required: false,
			},
		],
		categoryQuestions: {
			"Aircon units": [
				{
					key: "need_install",
					label: "Do you need us to install it too?",
					type: "yes_no",
				},
			],
		},
		products: [
			{
				id: "sm-general-service",
				sku: "SM-SVC-GENERAL",
				category: "Servicing",
				name: "General service",
				description: "Filter and coil cleaning, drainage check.",
				unit: "unit",
				unitPriceSen: 7000,
				questions: [unitType, hp],
			},
			{
				id: "sm-chemical-wash",
				sku: "SM-SVC-CHEMWASH",
				category: "Servicing",
				name: "Chemical wash",
				description: "Full dismantle and chemical wash of indoor unit.",
				unit: "unit",
				unitPriceSen: 15000,
				questions: [unitType, hp],
			},
			{
				id: "sm-gas-topup",
				sku: "SM-SVC-R32",
				category: "Servicing",
				name: "R32 gas top-up",
				description: "Top up refrigerant to spec.",
				unit: "unit",
				unitPriceSen: 12000,
				questions: [hp],
			},
			{
				id: "sm-install",
				sku: "SM-INS-STD",
				category: "Installation",
				name: "Installation (customer-supplied unit)",
				description: "Includes up to 10 ft piping and bracket.",
				unit: "unit",
				unitPriceSen: 25000,
				questions: [
					hp,
					{
						key: "floor",
						label: "Which floor is the outdoor unit going on?",
						type: "single",
						options: ["ground", "1st floor", "2nd floor or above"],
					},
				],
			},
			{
				id: "sm-repair",
				sku: "SM-REP-VISIT",
				category: "Repair",
				name: "Repair / troubleshooting",
				description:
					"Inspection visit. Parts and labour quoted after diagnosis.",
				unit: "visit",
				unitPriceSen: 6000,
				questions: [
					{
						key: "symptom",
						label: "What's the problem with the aircon?",
						type: "text",
						hint: "e.g. not cold, leaking, noisy, error code.",
					},
					{
						key: "photo",
						label: "Can you send a photo of the unit or the error?",
						type: "file",
						required: false,
					},
				],
			},
			{
				id: "sm-unit-inv10",
				sku: "SM-AC-INV1.0",
				type: "stock",
				stockOnHand: 6,
				category: "Aircon units",
				name: "Inverter aircon 1.0HP wall-mounted (unit only)",
				description:
					"R32 inverter split unit, 1.0HP. Installation quoted separately.",
				unit: "unit",
				unitPriceSen: 145000,
			},
			{
				id: "sm-unit-inv15",
				sku: "SM-AC-INV1.5",
				type: "stock",
				stockOnHand: 2,
				category: "Aircon units",
				name: "Inverter aircon 1.5HP wall-mounted (unit only)",
				description:
					"R32 inverter split unit, 1.5HP. Installation quoted separately.",
				unit: "unit",
				unitPriceSen: 188000,
			},
			{
				id: "sm-bracket",
				sku: "SM-PRT-BRACKET",
				type: "stock",
				stockOnHand: 25,
				category: "Parts",
				name: "Outdoor unit wall bracket",
				description: "Galvanised steel bracket for the outdoor compressor.",
				unit: "set",
				unitPriceSen: 4500,
			},
		],
		rules: [
			{
				productId: "sm-general-service",
				description: "3 or more units: RM60 per unit",
				config: {
					kind: "tier",
					tiers: [
						{ minQty: 1, unitPriceSen: 7000 },
						{ minQty: 3, unitPriceSen: 6000 },
					],
				},
			},
			{
				productId: "sm-general-service",
				description: "Ceiling cassette adds RM50 per unit",
				config: {
					kind: "surcharge",
					when: { field: "unit_type", equals: "ceiling cassette" },
					perUnitSen: 5000,
					label: "Ceiling cassette",
				},
			},
			{
				productId: "sm-chemical-wash",
				description: "Ceiling cassette adds RM80 per unit",
				config: {
					kind: "surcharge",
					when: { field: "unit_type", equals: "ceiling cassette" },
					perUnitSen: 8000,
					label: "Ceiling cassette",
				},
			},
			{
				productId: "sm-install",
				description: "2nd floor or above adds RM80 per unit (scaffolding)",
				config: {
					kind: "surcharge",
					when: { field: "floor", equals: "2nd floor or above" },
					perUnitSen: 8000,
					label: "High-floor access",
				},
			},
			{
				productId: "sm-repair",
				description: "Repairs need a technician diagnosis before pricing",
				config: {
					kind: "requires_assessment",
					reason: "Fault must be diagnosed on site before parts can be quoted.",
				},
			},
		],
		sampleMessages: [
			{
				label: "Servicing (English)",
				customerName: "Mr. Tan",
				body: "Hi, I need general service for 3 wall-mounted 1.0hp aircon at my house in Puchong.",
			},
			{
				label: "Repair (BM)",
				customerName: "Puan Salmah",
				body: "Aircond rumah saya tak sejuk dan bocor air. Boleh datang check minggu ni?",
			},
			{
				label: "Chemical wash (Chinese)",
				customerName: "黄先生",
				body: "我家有两台冷气要化学清洗，1.5匹，挂墙式的。",
			},
			{
				label: "Buy + install (Manglish)",
				customerName: "Hafizah",
				body: "Boss nak beli 3 unit inverter aircon 1.5hp, wall-mounted, and install at my condo. Can?",
			},
		],
	},

	// --- Renovation ----------------------------------------------------------------------
	{
		id: "rumah-rapi",
		quotePrefix: "RR",
		name: "Rumah Rapi Renovation",
		industry: "Renovation & handyman",
		tagline: "Painting, plumbing, doors and small renovation jobs.",
		phone: "+60 3-0000 3303",
		address: "21, Lorong Ujian 5, 43000 Kajang, Selangor",
		openingHours: "Mon–Sat 8:30am–6pm",
		sstRateBps: 600,
		quoteValidityDays: 30,
		staff: [
			{ name: "Farid Ismail", role: "Owner", canApprove: true },
			{ name: "Grace Wong", role: "Coordinator", canApprove: false },
			{ name: "Ah Seng Lee", role: "Site supervisor", canApprove: false },
		],
		categoryPics: {
			Painting: "Ah Seng Lee",
			Tiling: "Ah Seng Lee",
			Plumbing: "Ah Seng Lee",
			Doors: "Ah Seng Lee",
			Handyman: "Ah Seng Lee",
			Waterproofing: "Ah Seng Lee",
			Materials: "Grace Wong",
		},
		businessQuestions: [
			{
				key: "property_location",
				label: "Where's the property?",
				type: "text",
				hint: "Area / taman is enough.",
			},
			propertyType(["landed", "condo / apartment", "shop lot"]),
		],
		categoryQuestions: {
			Materials: [
				{
					key: "need_fitting",
					label: "Do you need us to fit or install it?",
					type: "yes_no",
				},
			],
		},
		products: [
			{
				id: "rr-paint-room",
				sku: "RR-PNT-ROOM",
				category: "Painting",
				name: "Interior wall painting (per room)",
				description: "Two coats, walls only. Ceilings quoted separately.",
				unit: "room",
				unitPriceSen: 35000,
				questions: [
					{
						key: "room_size",
						label: "How big is each room?",
						type: "single",
						options: [
							"small (up to 10x10 ft)",
							"standard (up to 12x12 ft)",
							"large (above 12x12 ft)",
						],
					},
					{
						key: "paint",
						label: "Will you supply the paint, or should we?",
						type: "single",
						options: ["customer supplies", "we supply"],
					},
				],
			},
			{
				id: "rr-tiling",
				sku: "RR-TIL-LABOUR",
				category: "Tiling",
				name: "Floor tiling (labour)",
				description: "Laying tiles supplied by customer.",
				unit: "sqft",
				unitPriceSen: 1200,
				questions: [
					{
						key: "hacking",
						label: "Do the old tiles need to be hacked out first?",
						type: "yes_no",
					},
					{
						key: "photo",
						label: "Can you send a photo of the floor?",
						type: "file",
						required: false,
					},
				],
			},
			{
				id: "rr-plumbing-fix",
				sku: "RR-PLB-FIX",
				category: "Plumbing",
				name: "Leak / tap repair",
				description:
					"Fix a leaking tap, pipe joint or basin trap. Parts extra.",
				unit: "job",
				unitPriceSen: 12000,
				questions: [
					{
						key: "location",
						label: "Where in the house is it?",
						type: "single",
						options: ["kitchen", "bathroom", "outdoor", "other"],
					},
				],
			},
			{
				id: "rr-door-install",
				sku: "RR-DR-INSTALL",
				category: "Doors",
				name: "Door installation",
				description: "Remove old door and fit new one. Door not included.",
				unit: "door",
				unitPriceSen: 28000,
				questions: [
					{
						key: "door_type",
						label: "Timber or aluminium door?",
						type: "single",
						options: ["timber", "aluminium"],
					},
				],
			},
			{
				id: "rr-handyman",
				sku: "RR-HDY-HOUR",
				category: "Handyman",
				name: "Handyman (hourly)",
				description: "Odd jobs: shelves, curtain rails, minor fixes.",
				unit: "hour",
				unitPriceSen: 6000,
				questions: [{ key: "task", label: "What needs doing?", type: "text" }],
			},
			{
				id: "rr-waterproofing",
				sku: "RR-WP-JOB",
				pricingMode: "custom",
				category: "Waterproofing",
				name: "Waterproofing",
				description: "Bathroom or roof waterproofing.",
				unit: "job",
				unitPriceSen: 0,
				questions: [
					{
						key: "area",
						label: "Which area needs waterproofing?",
						type: "single",
						options: ["bathroom", "roof", "balcony", "other"],
					},
					{
						key: "photo",
						label: "Can you send a photo of the leak or stain?",
						type: "file",
						required: false,
					},
				],
			},
			{
				id: "rr-curtain-rail",
				sku: "RR-MAT-CRAIL6",
				type: "stock",
				stockOnHand: 15,
				category: "Materials",
				name: "Curtain rail set 6 ft",
				description:
					"Aluminium rail with brackets and rings. Fitting by handyman.",
				unit: "set",
				unitPriceSen: 5500,
			},
			{
				id: "rr-shelf",
				sku: "RR-MAT-SHELF3",
				type: "stock",
				stockOnHand: 8,
				category: "Materials",
				name: "Floating wall shelf 3 ft (pine)",
				description: "Shelf with hidden bracket. Fitting by handyman.",
				unit: "pc",
				unitPriceSen: 4000,
			},
			{
				id: "rr-led-light",
				sku: "RR-MAT-LED18",
				type: "stock",
				stockOnHand: 40,
				category: "Materials",
				name: "LED ceiling light 18W",
				description: "Round surface-mount LED panel, daylight.",
				unit: "pc",
				unitPriceSen: 3500,
			},
		],
		rules: [
			{
				productId: "rr-paint-room",
				description: "We supply paint: +RM150 per room",
				config: {
					kind: "surcharge",
					when: { field: "paint", equals: "we supply" },
					perUnitSen: 15000,
					label: "Paint supplied",
				},
			},
			{
				productId: "rr-paint-room",
				description: "Large rooms need site measurement",
				config: {
					kind: "requires_assessment",
					when: { field: "room_size", equals: "large (above 12x12 ft)" },
					reason: "Large room — measure walls before quoting.",
				},
			},
			{
				productId: "rr-tiling",
				description: "Hacking old tiles adds RM5 per sqft",
				config: {
					kind: "surcharge",
					when: { field: "hacking", equals: "yes" },
					perUnitSen: 500,
					label: "Hacking old tiles",
				},
			},
			{
				productId: "rr-tiling",
				description: "Tiling always needs a site visit",
				config: {
					kind: "requires_assessment",
					reason: "Floor levelling and hacking must be checked on site.",
				},
			},
			{
				productId: "rr-handyman",
				description: "Minimum 2 hours",
				config: { kind: "minimum_charge", minSen: 12000 },
			},
		],
		sampleMessages: [
			{
				label: "Painting (English)",
				customerName: "Daniel",
				body: "Hi, want to paint 2 standard size bedrooms, you supply the paint. Located in Kajang.",
			},
			{
				label: "Needs site visit (BM)",
				customerName: "Encik Azman",
				body: "Nak pasang tiles lantai dapur lebih kurang 120 sqft. Boleh bagi harga?",
			},
			{
				label: "Missing details (Chinese)",
				customerName: "李太太",
				body: "我想换两扇门，多少钱？",
			},
			{
				label: "Simple job (Manglish)",
				customerName: "Mei Ling",
				body: "Bathroom tap leaking already 2 days, can come fix ah?",
			},
			{
				label: "Materials (BM)",
				customerName: "Siti",
				body: "Nak beli 4 set curtain rail 6 kaki dan 2 lampu LED siling 18W. Ada stok?",
			},
		],
	},

	// --- Software & web agency (custom-priced) --------------------------------------------
	{
		id: "kodkraf",
		quotePrefix: "KD",
		name: "Kodkraf Digital",
		industry: "Software & web development",
		tagline: "Websites, custom business systems and apps for SMEs.",
		phone: "+60 3-0000 4404",
		address:
			"Level 5, Menara Contoh, Jalan Teknologi 1, 63000 Cyberjaya, Selangor",
		openingHours: "Mon–Fri 9am–6pm",
		sstRateBps: 800,
		quoteValidityDays: 30,
		staff: [
			{ name: "Hakim Zulkifli", role: "Founder", canApprove: true },
			{ name: "Priya Nair", role: "Project manager", canApprove: true },
			{ name: "Ong Jia Hui", role: "Sales executive", canApprove: false },
			{ name: "Daniel Tan", role: "Backend Developer", canApprove: false },
			{ name: "Siti Aminah", role: "Frontend Developer", canApprove: false },
		],
		categoryPics: {
			Systems: "Priya Nair",
			Websites: "Siti Aminah",
			Support: "Daniel Tan",
		},
		businessQuestions: [
			{
				key: "company_name",
				label: "What's your company name?",
				type: "text",
			},
			{
				key: "heard_from",
				label: "How did you hear about us?",
				type: "text",
				required: false,
			},
		],
		categoryQuestions: {
			Systems: [
				{
					key: "deadline",
					label: "When do you need it live?",
					type: "date",
					hint: "A month or quarter is fine.",
				},
				{
					key: "budget",
					label: "Do you have a budget range in mind?",
					type: "single",
					options: budgetBands,
					onQuote: false,
					hint: "Helps us suggest the right scope. 'Not sure yet' is fine.",
				},
			],
		},
		products: [
			{
				id: "kd-website",
				sku: "KD-WEB-CORP8",
				category: "Websites",
				name: "Company website (up to 8 pages)",
				description:
					"Responsive company website, up to 8 pages, contact form, basic SEO.",
				unit: "project",
				unitPriceSen: 380000,
				questions: [
					{
						key: "content_ready",
						label: "Is the content (text and photos) ready?",
						type: "single",
						options: ["all ready", "partly ready", "need help writing"],
					},
					{
						key: "languages",
						label: "Which languages should the site be in?",
						type: "multi",
						options: ["English", "Bahasa Melayu", "Chinese"],
					},
					{
						key: "domain_hosting",
						label: "Do you already have a domain and hosting?",
						type: "single",
						options: ["have both", "have domain only", "need both"],
					},
					{
						key: "reference_sites",
						label: "Any websites you like the look of?",
						type: "text",
						required: false,
					},
					{
						key: "go_live",
						label: "When do you want it live?",
						type: "date",
					},
				],
			},
			{
				id: "kd-ecommerce",
				sku: "KD-WEB-SHOP",
				pricingMode: "custom",
				category: "Websites",
				name: "E-commerce website",
				description: "Online shop with product catalogue, cart and payments.",
				unit: "project",
				unitPriceSen: 0,
				questions: [
					{
						key: "product_count",
						label: "Roughly how many products will you sell?",
						type: "number",
						hint: "A rough range is fine.",
					},
					{
						key: "payments",
						label: "Which payment methods do you need?",
						type: "multi",
						options: [
							"FPX online banking",
							"credit/debit card",
							"e-wallet (TnG, GrabPay)",
							"cash on delivery",
						],
					},
					{
						key: "shipping",
						label: "Need shipping integration (e.g. J&T, Pos Laju)?",
						type: "yes_no",
					},
					{
						key: "selling_now",
						label: "Are you already selling online?",
						type: "yes_no",
					},
					{
						key: "selling_where",
						label: "Where are you selling now?",
						type: "text",
						showIf: { key: "selling_now", equals: "yes" },
					},
					{
						key: "go_live",
						label: "When do you want it live?",
						type: "date",
					},
				],
			},
			{
				id: "kd-custom-system",
				sku: "KD-SYS-CUSTOM",
				pricingMode: "custom",
				category: "Systems",
				name: "Custom business system",
				description:
					"Web-based system built around your workflow: inventory, sales, HR, booking and more.",
				unit: "project",
				unitPriceSen: 0,
				questions: [
					{
						key: "process",
						label: "What process do you want to move into the system?",
						type: "text",
						hint: "A few sentences is enough, e.g. how orders flow today.",
					},
					{
						key: "modules",
						label: "Which areas should it cover?",
						type: "multi",
						options: [
							"sales / CRM",
							"inventory",
							"HR & payroll",
							"accounting",
							"booking / scheduling",
							"reports & dashboard",
						],
					},
					{
						key: "user_count",
						label: "How many staff will use it?",
						type: "number",
						hint: "A rough number is fine.",
					},
					{
						key: "has_system",
						label: "Are you using any system now?",
						type: "yes_no",
					},
					{
						key: "current_system",
						label: "Which system or tools are you using now?",
						type: "text",
						showIf: { key: "has_system", equals: "yes" },
					},
					{
						key: "integrations",
						label: "Does it need to connect to anything?",
						type: "multi",
						options: [
							"accounting software",
							"payment gateway",
							"WhatsApp",
							"e-invoice (LHDN MyInvois)",
							"nothing",
						],
					},
					{
						key: "platforms",
						label: "Web only, or a mobile app too?",
						type: "single",
						options: ["web only", "web + mobile app"],
					},
					{
						key: "reference_docs",
						label:
							"Can you send anything showing how you work now (forms, Excel sheets)?",
						type: "file",
						required: false,
					},
				],
			},
			{
				id: "kd-mobile-app",
				sku: "KD-APP-MOBILE",
				pricingMode: "custom",
				category: "Systems",
				name: "Mobile app (Android & iOS)",
				description: "Native-feel app for customers or staff, with backend.",
				unit: "project",
				unitPriceSen: 0,
				questions: [
					{
						key: "app_purpose",
						label: "What should the app do?",
						type: "text",
						hint: "Main idea in a sentence or two.",
					},
					{
						key: "app_users",
						label: "Who will use it?",
						type: "single",
						options: ["customers", "staff", "both"],
					},
					{
						key: "features",
						label: "Which features does it need?",
						type: "multi",
						options: [
							"login / accounts",
							"payments",
							"push notifications",
							"booking",
							"chat",
							"maps / location",
						],
					},
					{
						key: "has_backend",
						label: "Is there an existing system it must connect to?",
						type: "yes_no",
					},
				],
			},
			{
				id: "kd-maintenance",
				sku: "KD-SUP-MONTHLY",
				category: "Support",
				name: "Monthly maintenance & support",
				description: "Updates, backups, security patches and small changes.",
				unit: "month",
				unitPriceSen: 45000,
				questions: [
					{
						key: "maintain_what",
						label: "What do you need maintained?",
						type: "single",
						options: [
							"website built by us",
							"website built by others",
							"system built by us",
							"system built by others",
						],
					},
					{
						key: "hosting",
						label: "Should we host it for you?",
						type: "yes_no",
					},
				],
			},
		],
		rules: [
			{
				productId: "kd-website",
				description: "Copywriting help adds RM1,200",
				config: {
					kind: "surcharge",
					when: { field: "content_ready", equals: "need help writing" },
					amountSen: 120000,
					label: "Copywriting",
				},
			},
			{
				productId: "kd-website",
				description: "Each extra language adds RM800 (Chinese)",
				config: {
					kind: "surcharge",
					when: { field: "languages", equals: "Chinese" },
					amountSen: 80000,
					label: "Chinese version",
				},
			},
			{
				productId: "kd-website",
				description: "Each extra language adds RM800 (Bahasa Melayu)",
				config: {
					kind: "surcharge",
					when: { field: "languages", equals: "Bahasa Melayu" },
					amountSen: 80000,
					label: "Bahasa Melayu version",
				},
			},
			{
				productId: "kd-website",
				description: "Domain + hosting setup (1st year) adds RM350",
				config: {
					kind: "surcharge",
					when: { field: "domain_hosting", equals: "need both" },
					amountSen: 35000,
					label: "Domain & hosting, 1st year",
				},
			},
			{
				productId: "kd-maintenance",
				description: "Taking over a site built by others: +RM150/month",
				config: {
					kind: "surcharge",
					when: { field: "maintain_what", equals: "website built by others" },
					perUnitSen: 15000,
					label: "Third-party build",
				},
			},
			{
				productId: "kd-maintenance",
				description: "Taking over a system built by others: +RM350/month",
				config: {
					kind: "surcharge",
					when: { field: "maintain_what", equals: "system built by others" },
					perUnitSen: 35000,
					label: "Third-party system",
				},
			},
			{
				productId: "kd-maintenance",
				description: "Hosting adds RM60/month",
				config: {
					kind: "surcharge",
					when: { field: "hosting", equals: "yes" },
					perUnitSen: 6000,
					label: "Hosting",
				},
			},
		],
		sampleMessages: [
			{
				label: "Custom system (English)",
				customerName: "Jason Lee",
				body: "Hi, we're a trading company with about 30 staff. We want a system to manage our inventory and sales orders, everything is on Excel now. Can quote?",
			},
			{
				label: "Company website (BM)",
				customerName: "Puan Rohana",
				body: "Salam, nak buat website syarikat dalam 5 page. Boleh bagi quotation?",
			},
			{
				label: "Online shop (Manglish)",
				customerName: "Aishah",
				body: "Hi boss, I sell kuih on Instagram now, want my own website with payment can?",
			},
			{
				label: "Booking app (Chinese)",
				customerName: "王先生",
				body: "你好，我们想做一个预约的app，客户可以在app上预约服务。",
			},
		],
	},

	// --- Accounting, tax & audit firm (custom-priced) ---------------------------------------
	{
		id: "amanah-kira",
		quotePrefix: "AK",
		name: "Amanah Kira & Co.",
		industry: "Accounting, tax & audit",
		tagline: "Audit, tax and bookkeeping for Malaysian SMEs.",
		phone: "+60 3-0000 5505",
		address: "No. 8, Jalan Akaun 3, Taman Ujian, 40150 Shah Alam, Selangor",
		openingHours: "Mon–Fri 8:30am–5:30pm",
		sstRateBps: 800,
		quoteValidityDays: 30,
		staff: [
			{ name: "Nor Aisyah Kamal", role: "Audit partner", canApprove: true },
			{ name: "Tan Mei Xin", role: "Tax manager", canApprove: true },
			{ name: "Arif Danish", role: "Associate", canApprove: false },
			{ name: "Kavitha Raj", role: "Audit senior", canApprove: false },
		],
		categoryPics: {
			Audit: "Kavitha Raj",
			Tax: "Tan Mei Xin",
			Bookkeeping: "Arif Danish",
		},
		businessQuestions: [
			{
				key: "company_name",
				label: "What's the company name (or your name, for personal tax)?",
				type: "text",
			},
		],
		categoryQuestions: {},
		products: [
			{
				id: "ak-audit",
				sku: "AK-AUD-STAT",
				pricingMode: "custom",
				category: "Audit",
				name: "Statutory audit",
				description:
					"Annual audit of financial statements under the Companies Act 2016.",
				unit: "year",
				unitPriceSen: 0,
				questions: [
					{
						key: "entity_type",
						label: "What type of company is it?",
						type: "single",
						options: ["Sdn Bhd", "Berhad", "LLP", "other"],
					},
					{
						key: "fye",
						label: "What's the financial year end?",
						type: "date",
						hint: "Day and month, e.g. 31 Dec.",
					},
					{
						key: "revenue",
						label: "Roughly what's the annual revenue?",
						type: "single",
						options: revenueBands,
					},
					{
						key: "transactions",
						label: "About how many transactions a month?",
						type: "single",
						options: transactionBands,
					},
					{
						key: "first_audit",
						label: "Is this the company's first audit?",
						type: "yes_no",
					},
					{
						key: "previous_auditor",
						label: "Who was the previous auditor?",
						type: "text",
						required: false,
						showIf: { key: "first_audit", equals: "no" },
					},
					{
						key: "subsidiaries",
						label: "Any subsidiaries or group companies?",
						type: "yes_no",
					},
					{
						key: "accounts_file",
						label:
							"Can you send the latest management accounts or trial balance?",
						type: "file",
						required: false,
					},
				],
			},
			{
				id: "ak-tax-company",
				sku: "AK-TAX-FORMC",
				category: "Tax",
				name: "Corporate tax filing (Form C)",
				description:
					"Tax computation and Form C submission for one year of assessment.",
				unit: "year",
				unitPriceSen: 180000,
				questions: [
					{
						key: "revenue",
						label: "Roughly what's the annual revenue?",
						type: "single",
						options: revenueBands,
					},
					{
						key: "cp204",
						label: "Do you also need help with the tax estimate (CP204)?",
						type: "yes_no",
					},
				],
			},
			{
				id: "ak-tax-personal",
				sku: "AK-TAX-BE",
				category: "Tax",
				name: "Personal income tax filing (Form BE/B)",
				description: "e-Filing of personal income tax for one year.",
				unit: "person",
				unitPriceSen: 25000,
				questions: [
					{
						key: "business_income",
						label: "Do you have any business income (Form B)?",
						type: "yes_no",
					},
				],
			},
			{
				id: "ak-bookkeeping",
				sku: "AK-BKP-MONTHLY",
				category: "Bookkeeping",
				name: "Monthly bookkeeping",
				description:
					"Recording, bank reconciliation and monthly management accounts.",
				unit: "month",
				unitPriceSen: 40000,
				questions: [
					{
						key: "transactions",
						label: "About how many transactions a month?",
						type: "single",
						options: transactionBands,
					},
					{
						key: "software",
						label: "Which accounting software do you use now?",
						type: "single",
						options: [
							"none / Excel",
							"SQL Account",
							"AutoCount",
							"Xero",
							"other",
						],
					},
					{
						key: "start_month",
						label: "Which month should we start from?",
						type: "date",
					},
					{
						key: "backlog",
						label: "Are there past months that need catching up?",
						type: "yes_no",
					},
				],
			},
		],
		rules: [
			{
				productId: "ak-tax-company",
				description: "Revenue RM3m–RM25m adds RM1,200",
				config: {
					kind: "surcharge",
					when: { field: "revenue", equals: "RM3m–RM25m" },
					amountSen: 120000,
					label: "Larger company",
				},
			},
			{
				productId: "ak-tax-company",
				description: "Revenue above RM25m is quoted by the tax manager",
				config: {
					kind: "requires_assessment",
					when: { field: "revenue", equals: "above RM25m" },
					reason: "Large company — tax manager to scope the engagement.",
				},
			},
			{
				productId: "ak-tax-company",
				description: "CP204 estimate adds RM500",
				config: {
					kind: "surcharge",
					when: { field: "cp204", equals: "yes" },
					amountSen: 50000,
					label: "CP204 estimate",
				},
			},
			{
				productId: "ak-tax-personal",
				description: "Business income (Form B) adds RM200",
				config: {
					kind: "surcharge",
					when: { field: "business_income", equals: "yes" },
					perUnitSen: 20000,
					label: "Form B (business income)",
				},
			},
			{
				productId: "ak-bookkeeping",
				description: "100–500 transactions a month: +RM300/month",
				config: {
					kind: "surcharge",
					when: { field: "transactions", equals: "100–500 a month" },
					perUnitSen: 30000,
					label: "100–500 transactions",
				},
			},
			{
				productId: "ak-bookkeeping",
				description: "500–2,000 transactions a month: +RM900/month",
				config: {
					kind: "surcharge",
					when: { field: "transactions", equals: "500–2,000 a month" },
					perUnitSen: 90000,
					label: "500–2,000 transactions",
				},
			},
			{
				productId: "ak-bookkeeping",
				description: "Over 2,000 transactions a month needs scoping",
				config: {
					kind: "requires_assessment",
					when: { field: "transactions", equals: "over 2,000 a month" },
					reason: "High volume — review the books before quoting.",
				},
			},
			{
				productId: "ak-bookkeeping",
				description: "Backlog months are quoted after review",
				config: {
					kind: "requires_assessment",
					when: { field: "backlog", equals: "yes" },
					reason: "Catch-up work — check how many months and their state.",
				},
			},
		],
		sampleMessages: [
			{
				label: "Audit (English)",
				customerName: "Mr. Wong",
				body: "Hi, our Sdn Bhd needs an auditor for FYE 31 Dec 2025. Revenue about RM2 million. Can quote?",
			},
			{
				label: "Company tax (BM)",
				customerName: "Encik Faizal",
				body: "Salam, saya nak hantar cukai syarikat (Borang C) untuk tahun ni. Berapa caj?",
			},
			{
				label: "Bookkeeping (Manglish)",
				customerName: "Michelle",
				body: "Hi, my company need someone do accounts every month, around 200 transactions, we use Excel only.",
			},
			{
				label: "Personal tax (Chinese)",
				customerName: "林小姐",
				body: "你好，我想请你们帮我报个人所得税，我有做小生意。",
			},
		],
	},
];

export function getDemoBusiness(id: string) {
	return demoBusinesses.find((b) => b.id === id);
}
