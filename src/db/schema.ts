import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
} from "drizzle-orm/pg-core";

const id = () =>
	text("id")
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID());

const createdAt = () =>
	timestamp("created_at", { withTimezone: true }).defaultNow().notNull();

// All money is stored in sen (1 MYR = 100 sen) to avoid float rounding.

export const businesses = pgTable("businesses", {
	id: text("id").primaryKey(), // slug, e.g. "kilat-print"
	name: text("name").notNull(),
	quotePrefix: text("quote_prefix").notNull(), // e.g. "KP" → KP-Q-0001
	industry: text("industry").notNull(),
	tagline: text("tagline"),
	phone: text("phone"),
	address: text("address"),
	openingHours: text("opening_hours"), // e.g. "Mon–Sat 9am–6pm"
	currency: text("currency").default("MYR").notNull(),
	sstRegistered: boolean("sst_registered").default(true).notNull(),
	sstRateBps: integer("sst_rate_bps").default(800).notNull(), // 800 = 8.00%
	quoteValidityDays: integer("quote_validity_days").default(14).notNull(),
	// Following up unsigned quotes. Times are Malaysia time (UTC+8).
	followUpMax: integer("follow_up_max").default(3).notNull(),
	followUpGapDays: integer("follow_up_gap_days").default(2).notNull(),
	workStart: text("work_start").default("09:00").notNull(),
	workEnd: text("work_end").default("19:00").notNull(),
	workDays: jsonb("work_days")
		.$type<number[]>()
		.default([1, 2, 3, 4, 5, 6])
		.notNull(), // 0 = Sunday
	extendDays: integer("extend_days").default(7).notNull(),
	/** How this business gets paid and which documents it sends (see BillingSettings). */
	billing: jsonb("billing").$type<BillingSettings | null>(),
	createdAt: createdAt(),
});

/**
 * When an instalment is invoiced: when the customer signs, when every task in a
 * quotation phase is done, or when the whole job is completed.
 */
export type InstalmentTrigger = "signed" | "phase" | "completed";

/** One part of a payment schedule, e.g. "40% deposit on signing". */
export type Instalment = {
	label: string;
	percent: number;
	/** Older quotes have no trigger; see `instalmentsFor`. */
	when?: InstalmentTrigger;
	/** The quotation phase that triggers it, when `when` is "phase". */
	phase?: string | null;
};

/** A business's billing model. Quotes can override the schedule (custom items' price lists do). */
export type BillingSettings = {
	/** Default schedule for quotes without their own (e.g. fixed-price items). */
	schedule: Instalment[];
	/** Invoices are due this many days after they're sent. */
	dueDays: number;
	/** Extra documents sent when a job is completed. */
	statement: boolean;
	completionReport: boolean;
};

/** "stock" items are counted and reserved; "service" covers services and made-to-order work. */
export const productType = pgEnum("product_type", ["stock", "service"]);

/** "fixed": priced by the catalog and rules. "custom": staff price it from the requirement brief. */
export const pricingMode = pgEnum("pricing_mode", ["fixed", "custom"]);

export const products = pgTable(
	"products",
	{
		id: text("id").primaryKey(), // e.g. "kp-flyer-a5"
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		sku: text("sku").notNull(), // e.g. "KP-FLY-A5", unique per business
		type: productType("type").default("service").notNull(),
		category: text("category").notNull(),
		name: text("name").notNull(),
		description: text("description").notNull(),
		unit: text("unit").notNull(), // "pc", "unit", "sqft", "job"
		unitPriceSen: integer("unit_price_sen").notNull(),
		pricingMode: pricingMode("pricing_mode").default("fixed").notNull(),
		active: boolean("active").default(true).notNull(),
		// Stock items only. Available = on hand − reserved (reserved when a customer signs).
		stockOnHand: integer("stock_on_hand").default(0).notNull(),
		stockReserved: integer("stock_reserved").default(0).notNull(),
		// Stock items only: when the next stock is expected (YYYY-MM-DD). The AI only quotes this date.
		restockDate: text("restock_date"),
		// Custom-priced items: how a draft is priced (see PriceBuilder).
		priceBuilder: jsonb("price_builder").$type<PriceBuilder | null>(),
		image: text("image"), // small data URL; served from /api/products/:id/image
	},
	(t) => [uniqueIndex("products_business_sku").on(t.businessId, t.sku)],
);

/** How a line is charged. Only one-time lines count towards the quotation total. */
export type Charge = "one_time" | "monthly" | "yearly" | "optional";

/** One priced part of a custom item, e.g. "Payment gateway" or "Hosting". */
export type PriceComponent = {
	id: string;
	label: string;
	charge: Charge;
	/** Only when this answer matches (any of its values). Null = always included. */
	when: { key: string; equals: string } | null;
	amountSen: number;
	/**
	 * "fixed": amountSen once. "quantity": × the item's quantity.
	 * "answer": × a number from an answer (a count, or W x H for an area).
	 */
	per:
		| { kind: "fixed" }
		| { kind: "quantity" }
		| { kind: "answer"; key: string; unit: string };
	/** Weeks of work this adds to the timeline (one-time parts only). */
	weeks: number | null;
	note: string | null;
};

/**
 * The business's price list for a custom-priced item. Code prices what's on it;
 * the AI only estimates gaps (effort × rate), and staff always review.
 * Which sections exist (timeline, payment schedule…) suits the business's trade.
 */
export type PriceBuilder = {
	/** For requirements the list doesn't cover. Null = no AI estimates. */
	rate: { amountSen: number; unit: "hour" | "day" } | null;
	components: PriceComponent[];
	/** Empty = no timeline on the quote. Extra weeks go to the longest phase. */
	phases: { name: string; weeks: number }[];
	/** Empty = paid in full. Percents add up to 100. */
	payments: Instalment[];
	assumptions: string[];
	exclusions: string[];
};

/** Timeline, payment schedule and terms printed on a custom quotation. */
export type QuoteTerms = {
	phases: { name: string; weeks: number }[];
	payments: Instalment[];
	assumptions: string[];
	exclusions: string[];
};

export type PricingRuleConfig =
	| {
			kind: "tier";
			tiers: { minQty: number; unitPriceSen: number }[];
	  }
	| { kind: "minimum_charge"; minSen: number }
	| {
			kind: "surcharge";
			when: { field: string; equals: string };
			amountSen?: number; // flat per line
			perUnitSen?: number; // per unit
			label: string;
	  }
	| {
			kind: "requires_assessment";
			when?: { field: string; equals: string } | { quantityAbove: number };
			reason: string;
	  };

export const pricingRules = pgTable("pricing_rules", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	productId: text("product_id").references(() => products.id, {
		onDelete: "cascade",
	}),
	description: text("description").notNull(),
	config: jsonb("config").$type<PricingRuleConfig>().notNull(),
});

// --- Preset questions -----------------------------------------------------------

export const questionScope = pgEnum("question_scope", [
	"business", // asked in every enquiry
	"category", // every product in a category
	"product",
]);

export const questionType = pgEnum("question_type", [
	"text",
	"number",
	"date",
	"single", // pick one option
	"multi", // pick any options
	"yes_no",
	"file", // photo or document
]);

/** Only ask this question when another answer matches. */
export type ShowIf = { key: string; equals: string };

/** What the AI must find out before a quote can be drafted. Pricing rules read answers by `key`. */
export const intakeQuestions = pgTable("intake_questions", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	scope: questionScope("scope").notNull(),
	category: text("category"), // scope = category
	productId: text("product_id").references(() => products.id, {
		onDelete: "cascade",
	}), // scope = product
	key: text("key").notNull(), // e.g. "paper"; unique within what one item sees
	label: text("label").notNull(), // the question, e.g. "Which paper would you like?"
	type: questionType("type").notNull(),
	options: jsonb("options").$type<string[]>().default([]).notNull(),
	required: boolean("required").default(true).notNull(),
	position: integer("position").default(0).notNull(),
	hint: text("hint"), // guidance for the AI, e.g. "a rough range is fine"
	showIf: jsonb("show_if").$type<ShowIf | null>(),
	/** Print the answer in the quotation line, e.g. "Flyer A5 (157gsm art paper, double)". */
	onQuote: boolean("on_quote").default(false).notNull(),
	source: text("source").default("staff").notNull(), // "staff" | "ai"
	createdAt: createdAt(),
});

export const staff = pgTable("staff", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	role: text("role").notNull(),
	canApprove: boolean("can_approve").default(false).notNull(),
});

export const conversations = pgTable("conversations", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	customerName: text("customer_name").notNull(),
	customerPhone: text("customer_phone"),
	/** True while a staff member has taken over; the AI stays quiet. */
	aiPaused: boolean("ai_paused").default(false).notNull(),
	handledBy: text("handled_by").references(() => staff.id, {
		onDelete: "set null",
	}),
	/** Set while the AI handles a message, so turns in one chat don't overlap. */
	processingUntil: timestamp("processing_until", { withTimezone: true }),
	createdAt: createdAt(),
});

export const messageSender = pgEnum("message_sender", [
	"customer",
	"assistant",
	"staff",
]);

export const messages = pgTable("messages", {
	id: id(),
	conversationId: text("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	sender: messageSender("sender").notNull(),
	body: text("body").notNull(),
	quoteId: text("quote_id"), // set when the message carries an approved quote
	invoiceId: text("invoice_id"), // an invoice card with "Review and pay"
	paymentId: text("payment_id"), // the customer's payment bubble
	/** A business document sent in the chat (receipt, statement, completion report). */
	document: jsonb("document").$type<ChatDocument | null>(),
	authorName: text("author_name"), // staff member who wrote it, if any
	/** A photo or document sent with the message. Data is served from /api/messages/:id/attachment. */
	attachment: jsonb("attachment").$type<Attachment | null>(),
	attachmentData: text("attachment_data"), // data URL
	createdAt: createdAt(),
});

export type Attachment = { name: string; mime: string; size: number };

export type ChatDocument = {
	kind: "receipt" | "statement" | "completion_report";
	/** Payment id for receipts, job id for statements and completion reports. */
	id: string;
	name: string; // e.g. "KD-OR-0001.pdf"
};

export const requestStatus = pgEnum("request_status", [
	"gathering", // AI is asking the customer for requirements
	"confirming", // summary sent, waiting for the customer to confirm
	"needs_review", // drafted, but staff must price or check something
	"draft_ready", // priced, waiting for approval
	"approved",
	"rejected",
]);

export type Language = "en" | "ms" | "zh" | "mixed";

/** An answer to a preset question, and where it came from. */
export type Answer = {
	values: string[]; // one value for most types; several for "multi"
	source: "customer" | "staff" | "skipped";
	messageId?: string; // the customer message it came from
	by?: string; // staff name
	fileMessageId?: string; // for "file" answers: the message carrying the attachment
	at: string; // ISO time
	state?: "known" | "ambiguous" | "conflicting";
	waiverReason?: string;
	label?: string; // captured question label, retained if the preset is edited later
};

/** One product or service the customer wants. */
export type BriefItem = {
	id: string;
	productName?: string;
	/** "exact" = one clear catalog match, "ambiguous" = several could fit, "none" = not in catalog. */
	match: "exact" | "ambiguous" | "none";
	productId: string | null;
	candidateProductIds: string[];
	rawText: string;
	quantity: number | null;
	answers: Record<string, Answer>;
	reason?: string; // the AI's note on the match
};

/** An extra question asked by the AI (on a vague answer) or added by staff. */
export type FollowUp = {
	id: string;
	question: string;
	from: "ai" | "staff";
	by?: string;
	answer: string | null;
	asked: boolean; // has it been put to the customer yet
	at: string;
	waivedBy?: string;
	waiverReason?: string;
};

/** Everything gathered so far for one quotation request. */
export type Brief = {
	language: Language;
	summary: string;
	items: BriefItem[];
	general: Record<string, Answer>; // business-wide questions
	followUps: FollowUp[];
	reasoning: string[]; // the AI's latest notes
	/** Things already put to the customer (see `missingId`), so optional ones are asked once. */
	asked: string[];
	/** Set while the customer is changing a quote that was already sent. */
	revisionOf?: string | null;
	/** Stock or availability problems already told to the customer (see `availabilityIssues`). */
	availabilityTold?: string[];
};

export type Flag = {
	kind:
		| "unknown_item"
		| "custom_pricing"
		| "needs_assessment"
		| "insufficient_stock"
		| "unavailable"
		| "ai_uncertain";
	message: string;
	itemIndex?: number;
	field?: string;
	options?: string[];
};

export const quoteRequests = pgTable("quote_requests", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	conversationId: text("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	status: requestStatus("status").notNull(),
	brief: jsonb("brief").$type<Brief>().notNull(),
	briefVersion: integer("brief_version").default(1).notNull(),
	processedMessageId: text("processed_message_id"),
	flags: jsonb("flags").$type<Flag[]>().default([]).notNull(),
	createdAt: createdAt(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

/** Append-only record of each substantive requirement change. */
export const requirementVersions = pgTable(
	"requirement_versions",
	{
		id: id(),
		requestId: text("request_id")
			.notNull()
			.references(() => quoteRequests.id, { onDelete: "cascade" }),
		version: integer("version").notNull(),
		brief: jsonb("brief").$type<Brief>().notNull(),
		actor: text("actor").notNull(),
		reason: text("reason").notNull(),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("requirement_versions_request_version").on(
			t.requestId,
			t.version,
		),
	],
);

export type LineItem = {
	productId: string | null;
	description: string;
	quantity: number;
	unit: string;
	unitPriceSen: number;
	amountSen: number;
	notes?: string;
	/** Units still to come from restock; the customer agreed to wait, so signing reserves them anyway. */
	backorder?: number;
	/** Defaults to one-time. Monthly, yearly and optional lines sit outside the total. */
	charge?: Charge;
	/** "builder": from the price list. "ai_estimate": effort × rate, for staff to check. */
	source?: "builder" | "ai_estimate";
	/** Staff-only: why the AI estimated this effort. Never shown to the customer. */
	estimate?: { reasoning: string };
};

export const quoteStatus = pgEnum("quote_status", [
	"draft",
	"approved", // approved by staff and sent for signature
	"rejected",
	"accepted", // signed by the customer
	"superseded", // replaced by a newer revision
	"lost", // the customer said no, or it expired unsigned
	"cancelled", // a signed order the customer explicitly cancelled
]);

export const lostReasons = [
	"price",
	"timing",
	"competitor",
	"not_needed",
	"no_reply",
	"other",
] as const;
export type LostReason = (typeof lostReasons)[number];

export const quotes = pgTable("quotes", {
	id: id(),
	number: text("number").notNull().unique(), // e.g. "KP-Q-0001", or "KP-Q-0001-R2" for revision 2
	revision: integer("revision").default(1).notNull(),
	supersedesId: text("supersedes_id"), // the quote this revision replaces
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	requestId: text("request_id")
		.notNull()
		.references(() => quoteRequests.id, { onDelete: "cascade" }),
	status: quoteStatus("status").default("draft").notNull(),
	/** Null on legacy quotes until a new draft is prepared. */
	requirementVersion: integer("requirement_version"),
	requirementsSnapshot: jsonb("requirements_snapshot").$type<Brief | null>(),
	lineItems: jsonb("line_items").$type<LineItem[]>().notNull(),
	subtotalSen: integer("subtotal_sen").notNull(),
	sstSen: integer("sst_sen").notNull(),
	totalSen: integer("total_sen").notNull(),
	notes: text("notes"),
	terms: jsonb("terms").$type<QuoteTerms | null>(),
	validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
	decidedBy: text("decided_by").references(() => staff.id),
	decidedAt: timestamp("decided_at", { withTimezone: true }),
	/** Why it was rejected (required when rejecting). */
	decisionReason: text("decision_reason"),
	// eSign: the customer reviews and signs the approved quote.
	viewedAt: timestamp("viewed_at", { withTimezone: true }),
	signedAt: timestamp("signed_at", { withTimezone: true }),
	signerName: text("signer_name"),
	signatureImage: text("signature_image"), // PNG data URL
	// Following up while it's unsigned.
	followUpsPaused: boolean("follow_ups_paused").default(false).notNull(),
	pausedUntil: timestamp("paused_until", { withTimezone: true }), // customer said "later"
	extendedAt: timestamp("extended_at", { withTimezone: true }), // validity extended once
	lostReason: text("lost_reason").$type<LostReason>(),
	lostNote: text("lost_note"),
	lostAt: timestamp("lost_at", { withTimezone: true }),
	// Signed-order cancellation: who requested it and when it took effect.
	cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
	cancelledBy: text("cancelled_by"),
	cancellationNote: text("cancellation_note"),
	createdAt: createdAt(),
});

/** Reminders for a sent-but-unsigned quote. The AI picks the time; code enforces the limits. */
export const quoteFollowUps = pgTable("quote_follow_ups", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	quoteId: text("quote_id")
		.notNull()
		.references(() => quotes.id, { onDelete: "cascade" }),
	/** Set for payment reminders: the unpaid invoice. */
	invoiceId: text("invoice_id"),
	conversationId: text("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	kind: text("kind")
		.$type<"reminder" | "extension" | "payment_reminder">()
		.default("reminder")
		.notNull(),
	status: text("status")
		.$type<"scheduled" | "sent" | "cancelled">()
		.default("scheduled")
		.notNull(),
	dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
	reason: text("reason"), // why the AI picked this time
	body: text("body"), // the message, once sent
	messageId: text("message_id"),
	sentAt: timestamp("sent_at", { withTimezone: true }),
	createdAt: createdAt(),
});

/** Simulated Orbyte activity record. One row per workflow step. */
export const activityEvents = pgTable("activity_events", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	requestId: text("request_id"),
	type: text("type").notNull(), // e.g. "quote.request.received"
	actor: text("actor").notNull(), // "customer", "quora-chat", or a staff name
	summary: text("summary").notNull(),
	payload: jsonb("payload").$type<Record<string, unknown>>(),
	createdAt: createdAt(),
});

/** One step of the AI's thinking, shown to staff in the inbox. */
export type ThoughtStep = {
	kind:
		| "read"
		| "understand"
		| "match"
		| "check"
		| "price"
		| "decide"
		| "reply"
		| "ask"
		| "relay"
		| "held"
		| "error";
	title: string;
	detail?: string[];
	at: string; // ISO time
};

export const aiRunStatus = pgEnum("ai_run_status", [
	"running",
	"done",
	"held",
	"failed",
]);

/** One AI turn: what it read, matched, priced and decided, step by step. */
export const aiRuns = pgTable("ai_runs", {
	id: id(),
	conversationId: text("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	requestId: text("request_id"),
	messageId: text("message_id").notNull(), // the customer message that started it
	status: aiRunStatus("status").default("running").notNull(),
	model: text("model"),
	steps: jsonb("steps").$type<ThoughtStep[]>().default([]).notNull(),
	createdAt: createdAt(),
	finishedAt: timestamp("finished_at", { withTimezone: true }),
});

// --- After signing: handover to a PIC (mirrors Orbyte Clients → Projects → Tasks) ---

/** Default person in charge for each product category. */
export const categorySettings = pgTable(
	"category_settings",
	{
		id: id(),
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		category: text("category").notNull(),
		defaultPicId: text("default_pic_id").references(() => staff.id, {
			onDelete: "set null",
		}),
	},
	(t) => [uniqueIndex("category_settings_unique").on(t.businessId, t.category)],
);

/** The customer's company (Orbyte "Client"). */
export const clients = pgTable("clients", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	name: text("name").notNull(),
	contactName: text("contact_name"),
	phone: text("phone"),
	createdAt: createdAt(),
});

/** Named by what was bought: stock → Delivery order, service → Job order, custom-priced → Project. */
export const jobKind = pgEnum("job_kind", [
	"delivery_order",
	"job_order",
	"project",
]);

export const jobStatus = pgEnum("job_status", [
	"preparing", // AI is writing the handover pack
	"upcoming",
	"active",
	"completed",
	"closed",
	"cancelled",
]);

/** What the PIC needs to know, written by the AI from the chat, brief and quote. */
export type Handover = {
	summary: string;
	scope: string[];
	requirements: { label: string; value: string }[];
	promises: string[]; // what we told the customer in chat
	timeline: string | null;
	watchOuts: string[];
	customerNotes: string | null; // e.g. preferred language, how they communicate
	suggestedTasks?: string[]; // revision suggestions require PIC review
};

export const jobs = pgTable(
	"jobs",
	{
		id: id(),
		number: text("number").notNull().unique(), // e.g. "KD-PRJ-0001"
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		clientId: text("client_id")
			.notNull()
			.references(() => clients.id, { onDelete: "cascade" }),
		requestId: text("request_id")
			.notNull()
			.references(() => quoteRequests.id, { onDelete: "cascade" }),
		quoteId: text("quote_id")
			.notNull()
			.references(() => quotes.id, { onDelete: "cascade" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		kind: jobKind("kind").notNull(),
		title: text("title").notNull(),
		status: jobStatus("status").default("preparing").notNull(),
		picId: text("pic_id").references(() => staff.id, { onDelete: "set null" }),
		handover: jsonb("handover").$type<Handover | null>(),
		agreementReviewRequired: boolean("agreement_review_required")
			.default(false)
			.notNull(),
		createdAt: createdAt(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
	},
	(t) => [uniqueIndex("jobs_quote_unique").on(t.quoteId)],
);

/** Persistent work claimed by a worker; completion is committed with its effects. */
export const workflowTasks = pgTable("workflow_tasks", {
	id: id(),
	key: text("key").notNull().unique(),
	kind: text("kind").notNull(), // create_handover | prepare_handover
	entityId: text("entity_id").notNull(),
	generation: text("generation"),
	status: text("status").default("pending").notNull(),
	attempts: integer("attempts").default(0).notNull(),
	runAfter: timestamp("run_after", { withTimezone: true })
		.defaultNow()
		.notNull(),
	lockedUntil: timestamp("locked_until", { withTimezone: true }),
	claimToken: text("claim_token"),
	lastError: text("last_error"),
	createdAt: createdAt(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

/** A reservation belongs to one signed quote; it is either delivered or released on cancellation. */
export const stockReservations = pgTable(
	"stock_reservations",
	{
		id: id(),
		quoteId: text("quote_id")
			.notNull()
			.references(() => quotes.id, { onDelete: "cascade" }),
		productId: text("product_id")
			.notNull()
			.references(() => products.id, { onDelete: "cascade" }),
		quantity: integer("quantity").notNull(),
		deliveredAt: timestamp("delivered_at", { withTimezone: true }),
		releasedAt: timestamp("released_at", { withTimezone: true }),
		createdAt: createdAt(),
	},
	(t) => [
		uniqueIndex("stock_reservations_quote_product").on(t.quoteId, t.productId),
	],
);

export const taskStatus = pgEnum("task_status", [
	"todo",
	"active",
	"blocked",
	"done",
]);

export const jobTasks = pgTable("job_tasks", {
	id: id(),
	jobId: text("job_id")
		.notNull()
		.references(() => jobs.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	status: taskStatus("status").default("todo").notNull(),
	/** The quotation phase this task belongs to; finishing a phase can trigger an invoice. */
	phase: text("phase"),
	doneAt: timestamp("done_at", { withTimezone: true }),
	note: text("note"), // e.g. what's blocking it
	position: integer("position").default(0).notNull(),
	source: text("source").default("staff").notNull(), // "ai" | "staff" | "bot"
	createdAt: createdAt(),
});

/** Where the PIC's chatbot found something. */
export type BotSource = {
	kind:
		| "chat"
		| "brief"
		| "quote"
		| "handover"
		| "file"
		| "relay"
		| "catalog"
		| "knowledge";
	label: string;
	ref?: string; // message id for "chat"/"file"; doc id for "knowledge"
};

// --- Company knowledge base ------------------------------------------------------------

/**
 * Internal docs are read by the team AI only. Public docs may also be used by the
 * customer-facing AI. Code enforces this when loading; the prompt is not the guard.
 */
export const knowledgeVisibility = pgEnum("knowledge_visibility", [
	"internal",
	"public",
]);

export const knowledgeDocs = pgTable("knowledge_docs", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	category: text("category").notNull(), // e.g. "SOP", "Policy", "FAQ"
	visibility: knowledgeVisibility("visibility").default("internal").notNull(),
	body: text("body").notNull(),
	updatedBy: text("updated_by"),
	createdAt: createdAt(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

/** Something the chatbot suggests; the PIC confirms with a click. */
export type BotAction =
	| { kind: "add_task"; title: string }
	| { kind: "flag_blocker"; taskId: string | null; note: string }
	| { kind: "ask_customer"; question: string };

/**
 * The job's internal team group: the PIC, any other assigned workers, and the AI.
 * The customer is never in it; only sales-approved messages reach them.
 */
export const jobMembers = pgTable(
	"job_members",
	{
		id: id(),
		jobId: text("job_id")
			.notNull()
			.references(() => jobs.id, { onDelete: "cascade" }),
		staffId: text("staff_id")
			.notNull()
			.references(() => staff.id, { onDelete: "cascade" }),
		addedById: text("added_by_id").references(() => staff.id, {
			onDelete: "set null",
		}),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("job_members_job_staff").on(t.jobId, t.staffId)],
);

/** Who a message tags: staff ids, or "ai" for the assistant. */
export type Mention = string;

/** The team group chat. The AI only replies when it is tagged. */
export const jobChat = pgTable("job_chat", {
	id: id(),
	jobId: text("job_id")
		.notNull()
		.references(() => jobs.id, { onDelete: "cascade" }),
	role: text("role").notNull(), // "staff" | "assistant" | "system" (legacy: "pic")
	authorId: text("author_id").references(() => staff.id, {
		onDelete: "set null",
	}),
	authorName: text("author_name"),
	body: text("body").notNull(),
	mentions: jsonb("mentions").$type<Mention[]>().default([]).notNull(),
	sources: jsonb("sources").$type<BotSource[]>().default([]).notNull(),
	actions: jsonb("actions").$type<BotAction[]>().default([]).notNull(),
	createdAt: createdAt(),
});

/** A PIC's question for the customer. Sales approve it before Quora Chat sends it. */
export const relayStatus = pgEnum("relay_status", [
	"pending", // waiting for sales approval
	"sent",
	"answered",
	"rejected",
]);

// --- Billing: invoices, payments and receipts --------------------------------------------

export const invoiceStatus = pgEnum("invoice_status", ["sent", "paid", "void"]);

/** One instalment of a signed quotation, invoiced when its trigger happens. */
export const invoices = pgTable(
	"invoices",
	{
		id: id(),
		number: text("number").notNull().unique(), // e.g. "KD-INV-0001"
		businessId: text("business_id")
			.notNull()
			.references(() => businesses.id, { onDelete: "cascade" }),
		quoteId: text("quote_id")
			.notNull()
			.references(() => quotes.id, { onDelete: "cascade" }),
		conversationId: text("conversation_id")
			.notNull()
			.references(() => conversations.id, { onDelete: "cascade" }),
		/** Position in the quote's payment schedule. */
		instalment: integer("instalment").notNull(),
		label: text("label").notNull(), // e.g. "Deposit on signing"
		percent: integer("percent").notNull(),
		amountSen: integer("amount_sen").notNull(), // incl. SST
		status: invoiceStatus("status").default("sent").notNull(),
		issuedAt: timestamp("issued_at", { withTimezone: true })
			.defaultNow()
			.notNull(),
		dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
		paidAt: timestamp("paid_at", { withTimezone: true }),
		remindersPaused: boolean("reminders_paused").default(false).notNull(),
		createdAt: createdAt(),
	},
	(t) => [uniqueIndex("invoices_quote_instalment").on(t.quoteId, t.instalment)],
);

/** Money received against an invoice. Each one gets an official receipt. */
export const payments = pgTable("payments", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	invoiceId: text("invoice_id")
		.notNull()
		.references(() => invoices.id, { onDelete: "cascade" }),
	receiptNumber: text("receipt_number").notNull().unique(), // e.g. "KD-OR-0001"
	amountSen: integer("amount_sen").notNull(),
	/** "card" is the simulated WhatsApp pay; the others are recorded by staff. */
	method: text("method").$type<"card" | "bank_transfer" | "cash">().notNull(),
	reference: text("reference"), // card "Visa •1234", bank reference, …
	recordedBy: text("recorded_by").notNull(), // customer name or staff name
	paidAt: timestamp("paid_at", { withTimezone: true }).defaultNow().notNull(),
	createdAt: createdAt(),
});

export const relays = pgTable("relays", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	jobId: text("job_id")
		.notNull()
		.references(() => jobs.id, { onDelete: "cascade" }),
	conversationId: text("conversation_id")
		.notNull()
		.references(() => conversations.id, { onDelete: "cascade" }),
	askedById: text("asked_by_id").references(() => staff.id, {
		onDelete: "set null",
	}),
	question: text("question").notNull(), // the PIC's words (internal)
	draft: text("draft").notNull(), // customer-facing WhatsApp message
	status: relayStatus("status").default("pending").notNull(),
	reviewedById: text("reviewed_by_id").references(() => staff.id, {
		onDelete: "set null",
	}),
	rejectReason: text("reject_reason"),
	answer: text("answer"),
	answerMessageId: text("answer_message_id"),
	createdAt: createdAt(),
	sentAt: timestamp("sent_at", { withTimezone: true }),
	answeredAt: timestamp("answered_at", { withTimezone: true }),
});

/** Simulated Orbyte notifications (app + email). */
export const notifications = pgTable("notifications", {
	id: id(),
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	staffId: text("staff_id")
		.notNull()
		.references(() => staff.id, { onDelete: "cascade" }),
	title: text("title").notNull(),
	body: text("body").notNull(),
	link: text("link"), // path inside the Orbyte workspace
	readAt: timestamp("read_at", { withTimezone: true }),
	createdAt: createdAt(),
});
