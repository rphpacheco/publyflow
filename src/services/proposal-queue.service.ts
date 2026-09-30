import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { runInTenantContext } from "@/repositories/tenant-context";
import { proposals, proposalItems, proposalVersions, proposalPublications, proposalResponses, proposalApprovals } from "@/db/schema/proposals";
import { opportunities } from "@/db/schema/commercial-flow";
import { creators } from "@/db/schema/creators";
import { brands, companies } from "@/db/schema/companies-brands-contacts";
import { organizationMembers } from "@/db/schema/organizations";
import { computeSendFlags } from "./proposal-sending.service";
import { deriveApprovalState } from "@/lib/proposals/approval-state";
import { deriveQueueSituation, type QueueSituation } from "@/lib/proposals/queue-situation";
import { excerpt } from "@/lib/events/proposal-events";
import type { ProposalStatus } from "@/lib/proposal-themes";

export const QUEUE_LIMIT = 200;

export interface QueueItem {
  id: string;
  title: string;
  situation: QueueSituation;
  creatorName: string;
  counterpartName: string | null;
  totalCents: number;
  lastActivityAt: Date;
  latestVersionNumber: number;
  latestPublication: { versionNumber: number; publishedAt: Date } | null;
  changes: { by: "client" | "creator"; name: string; excerpt: string } | null;
  approvedByCreator: boolean;
  approvalStale: boolean;
  clientOutcome: { action: "ACCEPT" | "REJECT"; name: string; at: Date } | null;
}

export interface QueueResult {
  items: QueueItem[];
  closedCount: number;
  truncated: boolean;
}

type Tx = NodePgDatabase<typeof schema>;

export const ProposalQueueService = {
  async list(
    db: Tx,
    organizationId: string,
    options: { creatorScope: string | null; includeArchived: boolean },
  ): Promise<QueueResult> {
    return runInTenantContext(
      db,
      organizationId,
      async (tx) => {
        const conditions = [eq(proposals.organizationId, organizationId)];
        if (options.creatorScope !== null) conditions.push(eq(opportunities.creatorId, options.creatorScope));
        if (!options.includeArchived) conditions.push(ne(proposals.status, "ARCHIVED"));

        const rows = await tx
          .select({
            id: proposals.id,
            title: proposals.title,
            status: proposals.status,
            createdAt: proposals.createdAt,
            creatorName: creators.displayName,
            creatorUserId: creators.userId,
            brandName: brands.name,
            companyName: companies.name,
          })
          .from(proposals)
          .innerJoin(opportunities, and(eq(opportunities.id, proposals.opportunityId), eq(opportunities.organizationId, organizationId)))
          .innerJoin(creators, and(eq(creators.id, opportunities.creatorId), eq(creators.organizationId, organizationId)))
          .leftJoin(brands, and(eq(brands.id, opportunities.brandId), eq(brands.organizationId, organizationId)))
          .leftJoin(companies, and(eq(companies.id, opportunities.companyId), eq(companies.organizationId, organizationId)))
          .where(and(...conditions))
          .orderBy(desc(proposals.createdAt), desc(proposals.id))
          .limit(QUEUE_LIMIT + 1);

        const truncated = rows.length > QUEUE_LIMIT;
        const loaded = rows.slice(0, QUEUE_LIMIT);
        if (loaded.length === 0) return { items: [], closedCount: 0, truncated: false };
        const ids = loaded.map((row) => row.id);

        const versions = await tx
          .selectDistinctOn([proposalVersions.proposalId], {
            proposalId: proposalVersions.proposalId,
            versionNumber: proposalVersions.versionNumber,
            createdAt: proposalVersions.createdAt,
          })
          .from(proposalVersions)
          .where(and(eq(proposalVersions.organizationId, organizationId), inArray(proposalVersions.proposalId, ids)))
          .orderBy(proposalVersions.proposalId, desc(proposalVersions.versionNumber));

        const publications = await tx
          .selectDistinctOn([proposalPublications.proposalId], {
            proposalId: proposalPublications.proposalId,
            versionNumber: proposalPublications.versionNumber,
            publishedAt: proposalPublications.publishedAt,
            action: proposalResponses.action,
            respondentName: proposalResponses.respondentName,
            message: proposalResponses.message,
            respondedAt: proposalResponses.respondedAt,
          })
          .from(proposalPublications)
          .leftJoin(
            proposalResponses,
            and(eq(proposalResponses.publicationId, proposalPublications.id), eq(proposalResponses.organizationId, organizationId)),
          )
          .where(and(eq(proposalPublications.organizationId, organizationId), inArray(proposalPublications.proposalId, ids)))
          .orderBy(proposalPublications.proposalId, desc(proposalPublications.publicationNumber));

        const approvals = await tx
          .selectDistinctOn([proposalApprovals.proposalId], {
            proposalId: proposalApprovals.proposalId,
            versionNumber: proposalApprovals.versionNumber,
            decision: proposalApprovals.decision,
            message: proposalApprovals.message,
            requestedAt: proposalApprovals.requestedAt,
            decidedAt: proposalApprovals.decidedAt,
          })
          .from(proposalApprovals)
          .where(and(eq(proposalApprovals.organizationId, organizationId), inArray(proposalApprovals.proposalId, ids)))
          .orderBy(proposalApprovals.proposalId, desc(proposalApprovals.requestNumber));

        const totals = await tx
          .select({
            proposalId: proposalItems.proposalId,
            total: sql<string>`coalesce(sum(${proposalItems.quantity}::bigint * ${proposalItems.unitPrice}), 0)`,
          })
          .from(proposalItems)
          .where(and(eq(proposalItems.organizationId, organizationId), inArray(proposalItems.proposalId, ids)))
          .groupBy(proposalItems.proposalId);

        const creatorUserIds = [...new Set(loaded.map((row) => row.creatorUserId))];
        const members = await tx
          .select({ userId: organizationMembers.userId })
          .from(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.role, "CREATOR"),
              inArray(organizationMembers.userId, creatorUserIds),
            ),
          );

        const versionBy = new Map(versions.map((v) => [v.proposalId, v]));
        const publicationBy = new Map(publications.map((p) => [p.proposalId, p]));
        const approvalBy = new Map(approvals.map((a) => [a.proposalId, a]));
        const totalBy = new Map(totals.map((t) => [t.proposalId, Number(t.total)]));
        const withAccess = new Set(members.map((m) => m.userId));

        const items: QueueItem[] = loaded.map((row) => {
          const status = row.status as ProposalStatus;
          const version = versionBy.get(row.id);
          const publication = publicationBy.get(row.id) ?? null;
          const approval = approvalBy.get(row.id) ?? null;
          const latestVersionNumber = version?.versionNumber ?? 0;
          const flags = computeSendFlags({
            status,
            latestVersionNumber,
            latestPublicationVersionNumber: publication?.versionNumber ?? null,
          });
          const approvalState = deriveApprovalState({
            required: withAccess.has(row.creatorUserId),
            latestVersionNumber,
            latest: approval,
          });
          const situation = deriveQueueSituation({ status, ...flags, approvalState, hasPublication: publication !== null });

          const changes: QueueItem["changes"] =
            situation !== "changes_requested"
              ? null
              : approvalState === "changes_requested"
                ? { by: "creator", name: row.creatorName, excerpt: excerpt(approval?.message ?? null) ?? "" }
                : { by: "client", name: publication?.respondentName ?? "", excerpt: excerpt(publication?.message ?? null) ?? "" };

          const clientOutcome: QueueItem["clientOutcome"] =
            situation === "closed" && publication?.action && publication.action !== "REQUEST_CHANGES" && publication.respondentName && publication.respondedAt
              ? { action: publication.action, name: publication.respondentName, at: publication.respondedAt }
              : null;

          const activity = [row.createdAt, version?.createdAt, publication?.publishedAt, publication?.respondedAt, approval?.requestedAt, approval?.decidedAt]
            .filter((date): date is Date => date instanceof Date)
            .reduce((latest, date) => (date > latest ? date : latest));

          return {
            id: row.id,
            title: row.title,
            situation,
            creatorName: row.creatorName,
            counterpartName: row.brandName ?? row.companyName ?? null,
            totalCents: totalBy.get(row.id) ?? 0,
            lastActivityAt: activity,
            latestVersionNumber,
            latestPublication: publication ? { versionNumber: publication.versionNumber, publishedAt: publication.publishedAt } : null,
            changes,
            approvedByCreator: approvalState === "approved",
            approvalStale: approvalState === "stale",
            clientOutcome,
          };
        });

        items.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
        return { items, closedCount: items.filter((item) => item.situation === "closed").length, truncated };
      },
      { isolationLevel: "repeatable read" },
    );
  },
};
