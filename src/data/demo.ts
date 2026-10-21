/**
 * Synthetic, team-created demo data. Every business, person, address, phone
 * number and price here is fictional. SST rates are illustrative only.
 */
import type { PricingRuleConfig, RequiredField } from "#/db/schema";

type DemoProduct = {
	id: string;
	sku: string;
	/** Defaults to "service" (services and made-to-order work). */
	type?: "stock" | "service";
	stockOnHand?: number;
	category: string;
	name: string;
	description: string;
	unit: string;
	unitPriceSen: number;
	requiredFields: RequiredField[];
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
	sstRateBps: number;
	quoteValidityDays: number;
	staff: { name: string; role: string; canApprove: boolean }[];
	products: DemoProduct[];
	rules: DemoRule[];
	sampleMessages: { label: string; customerName: string; body: string }[];
};

const sides: RequiredField = {
	key: "sides",
	label: "Printed sides",
	options: ["single", "double"],
};
const unitType: RequiredField = {
	key: "unit_type",
	label: "Aircon type",
	options: ["wall-mounted", "ceiling cassette"],
};
const hp: RequiredField = {
	key: "hp",
	label: "Horsepower",
	options: ["1.0", "1.5", "2.0", "2.5"],
};

export const demoBusinesses: DemoBusiness[] = [
	{
		id: "kilat-print",
		quotePrefix: "KP",
		name: "Kilat Print Studio",
		industry: "Printing",
		tagline: "Flyers, name cards and banners — fast.",
		phone: "+60 3-0000 1101",
		address: "12, Jalan Contoh 3/1, 46000 Petaling Jaya, Selangor",
		sstRateBps: 800,
		quoteValidityDays: 14,
		staff: [
			{ name: "Aina Rahman", role: "Owner", canApprove: true },
			{ name: "Lim Wei Jie", role: "Counter staff", canApprove: false },
		],
		products: [
			{
				id: "kp-flyer-a5",
				sku: "KP-FLY-A5",
				category: "Flyers",
				name: "Flyer A5",
				description: "Full-colour A5 flyer on art paper.",
				unit: "pc",
				unitPriceSen: 30,
				requiredFields: [
					{
						key: "paper",
						label: "Paper",
						options: ["128gsm art paper", "157gsm art paper"],
					},
					sides,
				],
			},
			{
				id: "kp-flyer-a4",
				sku: "KP-FLY-A4",
				category: "Flyers",
				name: "Flyer A4",
				description: "Full-colour A4 flyer on art paper.",
				unit: "pc",
				unitPriceSen: 50,
				requiredFields: [
					{
						key: "paper",
						label: "Paper",
						options: ["128gsm art paper", "157gsm art paper"],
					},
					sides,
				],
			},
			{
				id: "kp-namecard",
				sku: "KP-NC-100",
				category: "Name cards",
				name: "Name card (box of 100)",
				description: "310gsm art card, full colour.",
				unit: "box",
				unitPriceSen: 3500,
				requiredFields: [
					{ key: "finish", label: "Finish", options: ["matte", "gloss"] },
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
				requiredFields: [],
			},
			{
				id: "kp-banner-10x4",
				sku: "KP-BNR-10X4",
				category: "Banners",
				name: "Vinyl banner 10 x 4 ft",
				description: "Outdoor vinyl banner with eyelets.",
				unit: "pc",
				unitPriceSen: 9500,
				requiredFields: [],
			},
			{
				id: "kp-banner-custom",
				sku: "KP-BNR-CUSTOM",
				category: "Banners",
				name: "Vinyl banner, custom size",
				description: "Any size not in the standard list.",
				unit: "pc",
				unitPriceSen: 0,
				requiredFields: [{ key: "size", label: "Size (W x H ft)" }],
			},
			{
				id: "kp-design",
				sku: "KP-SVC-DESIGN",
				category: "Services",
				name: "Artwork design",
				description: "Simple layout design by our designer, 2 revisions.",
				unit: "job",
				unitPriceSen: 8000,
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				productId: "kp-banner-custom",
				description: "Custom banner sizes are priced by the owner",
				config: {
					kind: "requires_assessment",
					reason: "Custom banner size needs material and finishing check.",
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
				label: "Complete order (Manglish)",
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
	{
		id: "sejukmax",
		quotePrefix: "SM",
		name: "SejukMax Aircon Services",
		industry: "Aircon servicing",
		tagline: "Servicing, chemical wash and installation across Klang Valley.",
		phone: "+60 3-0000 2202",
		address: "8, Jalan Sampel 2, 47100 Puchong, Selangor",
		sstRateBps: 800,
		quoteValidityDays: 7,
		staff: [
			{ name: "Kumar Selvam", role: "Owner", canApprove: true },
			{ name: "Nurul Izzah", role: "Admin", canApprove: true },
			{ name: "Danial Haris", role: "Technician", canApprove: false },
		],
		products: [
			{
				id: "sm-general-service",
				sku: "SM-SVC-GENERAL",
				category: "Servicing",
				name: "General service",
				description: "Filter and coil cleaning, drainage check.",
				unit: "unit",
				unitPriceSen: 7000,
				requiredFields: [unitType, hp],
			},
			{
				id: "sm-chemical-wash",
				sku: "SM-SVC-CHEMWASH",
				category: "Servicing",
				name: "Chemical wash",
				description: "Full dismantle and chemical wash of indoor unit.",
				unit: "unit",
				unitPriceSen: 15000,
				requiredFields: [unitType, hp],
			},
			{
				id: "sm-gas-topup",
				sku: "SM-SVC-R32",
				category: "Servicing",
				name: "R32 gas top-up",
				description: "Top up refrigerant to spec.",
				unit: "unit",
				unitPriceSen: 12000,
				requiredFields: [hp],
			},
			{
				id: "sm-install",
				sku: "SM-INS-STD",
				category: "Installation",
				name: "Installation (customer-supplied unit)",
				description: "Includes up to 10 ft piping and bracket.",
				unit: "unit",
				unitPriceSen: 25000,
				requiredFields: [
					hp,
					{
						key: "floor",
						label: "Floor",
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
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				label: "Complete order (English)",
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
				label: "Missing details (Manglish)",
				customerName: "Jess",
				body: "Boss can install aircon for me ah? I already bought the unit.",
			},
			{
				label: "Buy + install (Manglish)",
				customerName: "Hafizah",
				body: "Boss nak beli 3 unit inverter aircon 1.5hp, wall-mounted, and install at my condo ground floor. Can?",
			},
		],
	},
	{
		id: "rumah-rapi",
		quotePrefix: "RR",
		name: "Rumah Rapi Renovation",
		industry: "Renovation & handyman",
		tagline: "Painting, plumbing, doors and small renovation jobs.",
		phone: "+60 3-0000 3303",
		address: "21, Lorong Ujian 5, 43000 Kajang, Selangor",
		sstRateBps: 600,
		quoteValidityDays: 30,
		staff: [
			{ name: "Farid Ismail", role: "Owner", canApprove: true },
			{ name: "Grace Wong", role: "Coordinator", canApprove: false },
		],
		products: [
			{
				id: "rr-paint-room",
				sku: "RR-PNT-ROOM",
				category: "Painting",
				name: "Interior wall painting (per room)",
				description: "Two coats, walls only. Ceilings quoted separately.",
				unit: "room",
				unitPriceSen: 35000,
				requiredFields: [
					{
						key: "room_size",
						label: "Room size",
						options: [
							"small (up to 10x10 ft)",
							"standard (up to 12x12 ft)",
							"large (above 12x12 ft)",
						],
					},
					{
						key: "paint",
						label: "Paint",
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
				requiredFields: [],
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
				requiredFields: [
					{
						key: "location",
						label: "Where in the house",
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
				requiredFields: [
					{
						key: "door_type",
						label: "Door type",
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
				requiredFields: [],
			},
			{
				id: "rr-waterproofing",
				sku: "RR-WP-JOB",
				category: "Waterproofing",
				name: "Waterproofing",
				description: "Bathroom or roof waterproofing.",
				unit: "job",
				unitPriceSen: 0,
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				requiredFields: [],
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
				description: "Tiling always needs a site visit",
				config: {
					kind: "requires_assessment",
					reason: "Floor levelling and hacking must be checked on site.",
				},
			},
			{
				productId: "rr-waterproofing",
				description: "Waterproofing always needs a site visit",
				config: {
					kind: "requires_assessment",
					reason: "Leak source and area must be inspected.",
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
				label: "Complete order (English)",
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
];

export function getDemoBusiness(id: string) {
	return demoBusinesses.find((b) => b.id === id);
}
