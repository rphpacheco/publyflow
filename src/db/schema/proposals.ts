import { pgEnum, pgTable, uuid, text, timestamp, integer, jsonb, unique, index } from "drizzle-orm/pg-core";
import { organizations, users } from "./organizations";
import { opportunities } from "./commercial-flow";
import { rateCardItems } from "./rate-cards";

export const proposalThemeEnum = pgEnum("proposal_theme", [
  "PREMIUM",
  "MINIMAL",
  "EDITORIAL",
  "FASHION",
  "BEAUTY",
  "CORPORATE",
]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "DRAFT",
  "ARCHIVED",
  "SENT",
  "CHANGES_REQUESTED",
  "APPROVED",
  "REJECTED",
]);

export const proposals = pgTable("proposals", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  opportunityId: uuid("opportunity_id")
    .notNull()
    .references(() => opportunities.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  theme: proposalThemeEnum("theme").notNull(),
  status: proposalStatusEnum("status").notNull().default("DRAFT"),
  publicToken: text("public_token").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proposalItems = pgTable("proposal_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  rateCardItemId: uuid("rate_card_item_id").references(() => rateCardItems.id, { onDelete: "restrict" }),
  description: text("description").notNull(),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: integer("unit_price").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proposalBlockTypeEnum = pgEnum("proposal_block_type", [
  "COVER",
  "TEXT",
  "IMAGE",
  "METRICS",
  "SERVICES",
  "PRICING",
  "TIMELINE",
  "GALLERY",
  "TESTIMONIALS",
  "SOCIAL_LINKS",
  "FOOTER",
]);

export const proposalBlocks = pgTable("proposal_blocks", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  proposalId: uuid("proposal_id")
    .notNull()
    .references(() => proposals.id, { onDelete: "cascade" }),
  blockType: proposalBlockTypeEnum("block_type").notNull(),
  content: jsonb("content").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const proposalVersions = pgTable(
  "proposal_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    versionNumber: integer("version_number").notNull(),
    snapshotJson: jsonb("snapshot_json").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("proposal_versions_proposal_version_unique").on(table.proposalId, table.versionNumber)],
);

export const proposalResponseActionEnum = pgEnum("proposal_response_action", ["ACCEPT", "REQUEST_CHANGES", "REJECT"]);

export const proposalPublications = pgTable(
  "proposal_publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    /** 1, 2, 3… per proposal; defines "latest" (never rely on timestamps). */
    publicationNumber: integer("publication_number").notNull(),
    versionId: uuid("version_id")
      .notNull()
      .references(() => proposalVersions.id, { onDelete: "restrict" }),
    versionNumber: integer("version_number").notNull(),
    /** Frozen at send time: { creator: { displayName, instagramHandle }, clientName, issuedAt (ISO) }. */
    context: jsonb("context").notNull(),
    publishedBy: uuid("published_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("proposal_publications_proposal_number_unique").on(table.proposalId, table.publicationNumber),
    index("proposal_publications_proposal_idx").on(table.proposalId),
  ],
);

export const proposalResponses = pgTable("proposal_responses", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  publicationId: uuid("publication_id")
    .notNull()
    .unique()
    .references(() => proposalPublications.id, { onDelete: "cascade" }),
  action: proposalResponseActionEnum("action").notNull(),
  respondentName: text("respondent_name").notNull(),
  respondentEmail: text("respondent_email").notNull(),
  message: text("message"),
  respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
});
