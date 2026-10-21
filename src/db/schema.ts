import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
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
	currency: text("currency").default("MYR").notNull(),
	sstRegistered: boolean("sst_registered").default(true).notNull(),
	sstRateBps: integer("sst_rate_bps").default(800).notNull(), // 800 = 8.00%
	quoteValidityDays: integer("quote_validity_days").default(14).notNull(),
	createdAt: createdAt(),
});

/** A field the customer must provide before an item can be priced. */
export type RequiredField = {
	key: string;
	label: string;
	options?: string[];
};

export const products = pgTable("products", {
	id: text("id").primaryKey(), // e.g. "kp-flyer-a5"
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	category: text("category").notNull(),
	name: text("name").notNull(),
	description: text("description").notNull(),
	unit: text("unit").notNull(), // "pc", "unit", "sqft", "job"
	unitPriceSen: integer("unit_price_sen").notNull(),
	requiredFields: jsonb("required_fields")
		.$type<RequiredField[]>()
		.default([])
		.notNull(),
	active: boolean("active").default(true).notNull(),
});

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
	authorName: text("author_name"), // staff member who wrote it, if any
	createdAt: createdAt(),
});

export const requestStatus = pgEnum("request_status", [
	"needs_clarification", // waiting on customer
	"needs_review", // flagged for a human
	"draft_ready", // priced, waiting for approval
	"approved",
	"rejected",
]);

/** What the AI pulled out of the conversation. Prices are never set by the AI. */
export type ExtractedItem = {
	/** "exact" = one clear catalog match, "ambiguous" = several could fit, "none" = not in catalog. */
	match: "exact" | "ambiguous" | "none";
	productId: string | null;
	candidateProductIds: string[];
	rawText: string;
	quantity: number | null;
	fields: Record<string, string>;
};

export type ExtractedRequest = {
	language: "en" | "ms" | "zh" | "mixed";
	summary: string;
	items: ExtractedItem[];
	location: string | null;
	neededBy: string | null;
};

export type Flag = {
	kind: "missing_info" | "unknown_item" | "needs_assessment" | "ai_uncertain";
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
	extracted: jsonb("extracted").$type<ExtractedRequest>().notNull(),
	flags: jsonb("flags").$type<Flag[]>().default([]).notNull(),
	createdAt: createdAt(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.notNull(),
});

export type LineItem = {
	productId: string | null;
	description: string;
	quantity: number;
	unit: string;
	unitPriceSen: number;
	amountSen: number;
	notes?: string;
};

export const quoteStatus = pgEnum("quote_status", [
	"draft",
	"approved", // approved by staff and sent for signature
	"rejected",
	"accepted", // signed by the customer
]);

export const quotes = pgTable("quotes", {
	id: id(),
	number: text("number").notNull().unique(), // e.g. "KP-Q-0001"
	businessId: text("business_id")
		.notNull()
		.references(() => businesses.id, { onDelete: "cascade" }),
	requestId: text("request_id")
		.notNull()
		.references(() => quoteRequests.id, { onDelete: "cascade" }),
	status: quoteStatus("status").default("draft").notNull(),
	lineItems: jsonb("line_items").$type<LineItem[]>().notNull(),
	subtotalSen: integer("subtotal_sen").notNull(),
	sstSen: integer("sst_sen").notNull(),
	totalSen: integer("total_sen").notNull(),
	notes: text("notes"),
	validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
	decidedBy: text("decided_by").references(() => staff.id),
	decidedAt: timestamp("decided_at", { withTimezone: true }),
	// eSign: the customer reviews and signs the approved quote.
	viewedAt: timestamp("viewed_at", { withTimezone: true }),
	signedAt: timestamp("signed_at", { withTimezone: true }),
	signerName: text("signer_name"),
	signatureImage: text("signature_image"), // PNG data URL
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
