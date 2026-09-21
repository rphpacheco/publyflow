import { pgEnum, pgTable, uuid, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { organizations } from "./organizations";
import { creators } from "./creators";
import { companies, brands, contacts } from "./companies-brands-contacts";
import { messages } from "./conversations-messages";

export const commercialInquiryStatusEnum = pgEnum("commercial_inquiry_status", [
  "NEW",
  "DISCARDED",
  "FALSE_POSITIVE",
  "CONVERTED",
]);

export const opportunityStageEnum = pgEnum("opportunity_stage", [
  "NOVO_LEAD",
  "QUALIFICACAO",
  "PRIMEIRO_CONTATO",
  "MIDIA_KIT_ENVIADO",
  "PROPOSTA_SOLICITADA",
  "PROPOSTA_ENVIADA",
  "NEGOCIACAO",
  "AGUARDANDO_CLIENTE",
  "FECHADO",
  "PERDIDO",
]);

export const opportunityStatusEnum = pgEnum("opportunity_status", ["OPEN", "WON", "LOST"]);

export const commercialInquiries = pgTable("commercial_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  messageId: uuid("message_id")
    .notNull()
    .references(() => messages.id, { onDelete: "cascade" }),
  status: commercialInquiryStatusEnum("status").notNull().default("NEW"),
  companyGuess: text("company_guess"),
  brandGuess: text("brand_guess"),
  contactNameGuess: text("contact_name_guess"),
  budgetGuess: text("budget_guess"),
  intentGuess: text("intent_guess"),
  convertedLeadId: uuid("converted_lead_id"),
  linkedOpportunityId: uuid("linked_opportunity_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const leads = pgTable("leads", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  inquiryId: uuid("inquiry_id").references(() => commercialInquiries.id, { onDelete: "set null" }),
  contactId: uuid("contact_id")
    .notNull()
    .references(() => contacts.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
  qualified: boolean("qualified").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunities = pgTable("opportunities", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  leadId: uuid("lead_id")
    .notNull()
    .references(() => leads.id, { onDelete: "restrict" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
  brandId: uuid("brand_id").references(() => brands.id, { onDelete: "set null" }),
  stage: opportunityStageEnum("stage").notNull().default("NOVO_LEAD"),
  status: opportunityStatusEnum("status").notNull().default("OPEN"),
  estimatedValueCents: integer("estimated_value_cents"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const opportunityStageHistory = pgTable("opportunity_stage_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "cascade" }),
  fromStage: opportunityStageEnum("from_stage"),
  toStage: opportunityStageEnum("to_stage").notNull(),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});
