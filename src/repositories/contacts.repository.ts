import { and, desc, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { contacts } from "@/db/schema/companies-brands-contacts";
import { runInTenantContext } from "./tenant-context";

export type Contact = typeof contacts.$inferSelect;

export interface CreateContactInput {
  fullName: string;
  email?: string | null;
  phone?: string | null;
  companyId?: string | null;
}

// Shared insert logic, parameterized on an already-open transaction (or
// tenant-context-scoped db handle). See conversations.repository.ts for the
// rationale: `create` opens its own single-statement transaction, while
// `createWithTx` lets a caller (e.g. CommercialInquiryService.resolve) fold
// this insert into a larger, caller-owned transaction.
async function insertContact(
  tx: NodePgDatabase<typeof schema>,
  organizationId: string,
  input: CreateContactInput,
): Promise<Contact> {
  const [row] = await tx
    .insert(contacts)
    .values({
      organizationId,
      fullName: input.fullName,
      email: input.email ?? null,
      phone: input.phone ?? null,
      companyId: input.companyId ?? null,
    })
    .returning();
  return row;
}

export const ContactsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateContactInput,
  ): Promise<Contact> {
    return runInTenantContext(db, organizationId, (tx) => insertContact(tx, organizationId, input));
  },

  async createWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateContactInput,
  ): Promise<Contact> {
    return insertContact(tx, organizationId, input);
  },

  // Explicit organization predicate, belt-and-suspenders alongside the RLS
  // policy: `id` alone is not org-scoped.
  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx
        .select()
        .from(contacts)
        .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
      return row ?? null;
    });
  },

  async findByIdWithTx(
    tx: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    const [row] = await tx
      .select()
      .from(contacts)
      .where(and(eq(contacts.id, contactId), eq(contacts.organizationId, organizationId)));
    return row ?? null;
  },

  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Contact[]> {
    return runInTenantContext(db, organizationId, async (tx) => {
      return tx
        .select()
        .from(contacts)
        .where(eq(contacts.organizationId, organizationId))
        .orderBy(desc(contacts.createdAt));
    });
  },
};
