import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { ContactsRepository, type Contact } from "@/repositories/contacts.repository";

export const ContactService = {
  async listByOrganization(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
  ): Promise<Contact[]> {
    return ContactsRepository.listByOrganization(db, organizationId);
  },

  async findById(
    db: NodePgDatabase<typeof schema>,
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    return ContactsRepository.findById(db, organizationId, contactId);
  },
};
