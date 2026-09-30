import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { seedProposal } from "@/test/helpers/proposal-fixtures";
import { importRouteWithSession, ownerSession, creatorSession } from "@/test/helpers/route";
import { CreatorService } from "@/services/creator.service";
import { ProposalService } from "@/services/proposal.service";
import { companies, contacts } from "@/db/schema/companies-brands-contacts";
import { leads, opportunities } from "@/db/schema/commercial-flow";

describe("/api/proposals/queue", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  async function setup() {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;
    return { db };
  }

  const get = (url: string = "http://localhost/api/proposals/queue") =>
    new Request(url, { method: "GET" });

  it("GET 401 with no session", async () => {
    const { db } = await setup();
    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: null,
    });

    const response = await GET(get());
    expect(response.status).toBe(401);
  });

  it("GET 200 OWNER returns org's items", async () => {
    const { db } = await setup();
    const { organization, owner, proposal: proposalA } = await seedProposal(db);

    // Create a second proposal
    const { proposal: proposalB } = await seedProposal(db);

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const response = await GET(get());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toHaveProperty("items");
    expect(json).toHaveProperty("closedCount");
    expect(json).toHaveProperty("truncated");

    const ids = json.items.map((item: any) => item.id);
    expect(ids).toContain(proposalA.id);
    expect(json.closedCount).toBe(0);
    expect(json.truncated).toBe(false);
  });

  it("GET 200 CREATOR returns only own proposals", async () => {
    const { db } = await setup();
    const { organization, owner, creator, proposal: proposalCreator1 } = await seedProposal(db);

    // Create a second creator in the SAME org, with their own proposal, to prove creator scoping
    // (not just tenant isolation).
    const creatorB = await CreatorService.onboardCreator(db, organization.id, {
      email: `creatorb-${Date.now()}@publyflow.test`,
      fullName: "Bia",
      displayName: "Bia",
    });
    const [company] = await db.insert(companies).values({ organizationId: organization.id, name: "Outra Empresa" }).returning();
    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: organization.id, companyId: company.id, fullName: "Contato B" })
      .returning();
    const [lead] = await db
      .insert(leads)
      .values({ organizationId: organization.id, creatorId: creatorB.id, contactId: contact.id, companyId: company.id })
      .returning();
    const [opportunityB] = await db
      .insert(opportunities)
      .values({ organizationId: organization.id, creatorId: creatorB.id, leadId: lead.id, companyId: company.id, brandId: null })
      .returning();
    const proposalCreator2 = await ProposalService.create(db, organization.id, {
      opportunityId: opportunityB.id,
      title: "B",
      theme: "PREMIUM",
      userId: owner.id,
    });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: creatorSession(organization.id, owner.id, creator.id),
    });

    const response = await GET(get());
    expect(response.status).toBe(200);

    const json = await response.json();
    const ids = json.items.map((item: any) => item.id);
    expect(ids).toContain(proposalCreator1.id);
    // proposalCreator2 belongs to a different creator in the same org, so should not appear
    expect(ids).not.toContain(proposalCreator2.id);
  });

  it("GET 200 CREATOR with null creatorId returns empty", async () => {
    const { db } = await setup();
    const { organization, owner } = await seedProposal(db);

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: { organizationId: organization.id, userId: owner.id, role: "CREATOR", creatorId: null },
    });

    const response = await GET(get());
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual({ items: [], closedCount: 0, truncated: false });
  });

  it("archived proposals excluded by default", async () => {
    const { db } = await setup();
    const { organization, owner, proposal } = await seedProposal(db);

    // Archive the proposal
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const response = await GET(get());
    const json = await response.json();
    expect(json.items.map((item: any) => item.id)).not.toContain(proposal.id);
  });

  it("archived proposals included with ?includeArchived=1", async () => {
    const { db } = await setup();
    const { organization, owner, proposal } = await seedProposal(db);

    // Archive the proposal
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const response = await GET(get("http://localhost/api/proposals/queue?includeArchived=1"));
    const json = await response.json();
    expect(json.items.map((item: any) => item.id)).toContain(proposal.id);
  });

  it("?includeArchived=true behaves as default (excluded)", async () => {
    const { db } = await setup();
    const { organization, owner, proposal } = await seedProposal(db);

    // Archive the proposal
    await ProposalService.update(db, organization.id, proposal.id, { status: "ARCHIVED", userId: owner.id });

    const { GET } = await importRouteWithSession(() => import("./route"), {
      db,
      session: ownerSession(organization.id, owner.id),
    });

    const response = await GET(get("http://localhost/api/proposals/queue?includeArchived=true"));
    const json = await response.json();
    expect(json.items.map((item: any) => item.id)).not.toContain(proposal.id);
  });
});
