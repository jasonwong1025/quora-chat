import type { InferRouterOutputs } from "@orpc/server";
import type router from "#/orpc/router";

type Outputs = InferRouterOutputs<typeof router>;

export type BusinessDetail = Outputs["businesses"]["get"];
export type Staff = BusinessDetail["staff"][number];
export type RequestRow = Outputs["requests"]["list"][number];
export type ActivityEvent = Outputs["activity"]["list"][number];
export type ConversationDetail = Outputs["conversations"]["get"];
export type QuoteDetail = Outputs["quotes"]["get"];
