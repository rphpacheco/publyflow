export class CompanyNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Company ${companyId} not found`);
    this.name = "CompanyNotFoundError";
  }
}

export class ContactNotFoundError extends Error {
  constructor(contactId: string) {
    super(`Contact ${contactId} not found`);
    this.name = "ContactNotFoundError";
  }
}

export class BrandNotFoundError extends Error {
  constructor(brandId: string) {
    super(`Brand ${brandId} not found`);
    this.name = "BrandNotFoundError";
  }
}

/** Another company of the organization already has this name (case-insensitive, trimmed). */
export class CompanyNameTakenError extends Error {
  constructor(name: string) {
    super(`A company named "${name}" already exists`);
    this.name = "CompanyNameTakenError";
  }
}

/** A companyId in a request body does not exist in the organization. */
export class CompanyRefNotFoundError extends Error {
  constructor(companyId: string) {
    super(`Referenced company ${companyId} not found`);
    this.name = "CompanyRefNotFoundError";
  }
}

export class CompanyAliasNotFoundError extends Error {
  constructor(aliasId: string) {
    super(`Company alias ${aliasId} not found`);
    this.name = "CompanyAliasNotFoundError";
  }
}
