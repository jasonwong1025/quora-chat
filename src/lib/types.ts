import type { InferRouterOutputs } from "@orpc/server";
import type router from "#/orpc/router";

type Outputs = InferRouterOutputs<typeof router>;

export type BusinessDetail = Outputs["businesses"]["get"];
export type Staff = BusinessDetail["staff"][number];
export type RequestRow = Outputs["requests"]["list"][number];
export type ActivityEvent = Outputs["activity"]["list"][number];
export type ConversationDetail = Outputs["conversations"]["get"];
export type AiRun = ConversationDetail["runs"][number];
export type QuoteDetail = Outputs["quotes"]["get"];
export type InboxRow = Outputs["inbox"]["list"][number];
export type WhatsappChat = Outputs["whatsapp"]["chats"][number];
export type EsignRow = Outputs["esign"]["list"][number];
export type Product = BusinessDetail["products"][number];
export type PricingRule = BusinessDetail["rules"][number];
export type JobRow = Outputs["jobs"]["list"][number];
export type JobDetail = Outputs["jobs"]["get"];
export type Notification = Outputs["notifications"]["list"][number];
export type KnowledgeDocRow = Outputs["knowledge"]["list"][number];
