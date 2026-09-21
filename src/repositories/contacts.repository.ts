import { eq } from "drizzle-orm";
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

export const ContactsRepository = {
  async create(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    input: CreateContactInput,
  ): Promise<Contact> {
    return runInTenantContext(db, organizationId, async (tx) => {
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
    });
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    return runInTenantContext(db, organizationId, async (tx) => {
      const [row] = await tx.select().from(contacts).where(eq(contacts.id, contactId));
      return row ?? null;
    });
  },
};
