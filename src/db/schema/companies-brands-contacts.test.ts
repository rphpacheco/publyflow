import { describe, it, expect, afterEach } from "vitest";
import { withTestDb } from "@/test/helpers/db";
import { organizations } from "./organizations";
import { companies, brands, contacts } from "./companies-brands-contacts";

describe("companies/brands/contacts schema", () => {
  let cleanup: () => Promise<void>;
  afterEach(async () => cleanup?.());

  it("allows a brand without a known parent company, and a contact without a known company", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();

    const [brand] = await db
      .insert(brands)
      .values({ organizationId: org.id, name: "Eudora", companyId: null })
      .returning();

    const [contact] = await db
      .insert(contacts)
      .values({ organizationId: org.id, fullName: "Maria", companyId: null })
      .returning();

    expect(brand.companyId).toBeNull();
    expect(contact.companyId).toBeNull();
  });

  it("links a brand to its owning company when known", async () => {
    const { db, cleanup: c } = await withTestDb();
    cleanup = c;

    const [org] = await db.insert(organizations).values({ name: "Org" }).returning();
    const [company] = await db
      .insert(companies)
      .values({ organizationId: org.id, name: "Grupo Boticário" })
      .returning();
    const [brand] = await db
      .insert(brands)
      .values({ organizationId: org.id, name: "O Boticário", companyId: company.id })
      .returning();

    expect(brand.companyId).toBe(company.id);
  });
});
