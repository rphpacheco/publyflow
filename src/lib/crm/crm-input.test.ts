import { describe, it, expect } from "vitest";
import { updateBrandSchema, updateCompanySchema, updateContactSchema } from "./crm-input";

const ID = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";

describe("updateCompanySchema", () => {
  it("trims the name", () => {
    expect(updateCompanySchema.parse({ name: "  Bella  " })).toEqual({ name: "Bella" });
  });
  it("rejects an empty name", () => {
    const result = updateCompanySchema.safeParse({ name: "   " });
    expect(result.success).toBe(false);
  });
  it("rejects more than 200 chars", () => {
    const result = updateCompanySchema.safeParse({ name: "a".repeat(201) });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Use no máximo 200 caracteres.");
  });
});

describe("updateContactSchema", () => {
  it("turns empty strings into null and keeps omitted keys undefined", () => {
    expect(updateContactSchema.parse({ email: "  ", phone: "", fullName: " Maria " })).toEqual({
      fullName: "Maria",
      email: null,
      phone: null,
    });
  });
  it("rejects an invalid e-mail", () => {
    const result = updateContactSchema.safeParse({ email: "nope" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].message).toBe("Informe um e-mail válido.");
  });
  it("accepts companyId uuid or null and rejects garbage", () => {
    expect(updateContactSchema.parse({ companyId: ID })).toEqual({ companyId: ID });
    expect(updateContactSchema.parse({ companyId: null })).toEqual({ companyId: null });
    expect(updateContactSchema.safeParse({ companyId: "x" }).success).toBe(false);
  });
  it("requires at least one field", () => {
    const result = updateContactSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toEqual(["form"]);
      expect(result.error.issues[0].message).toBe("Informe ao menos um campo.");
    }
  });
  it("rejects an empty fullName when present", () => {
    expect(updateContactSchema.safeParse({ fullName: " " }).success).toBe(false);
  });
});

describe("updateBrandSchema", () => {
  it("accepts name and companyId null", () => {
    expect(updateBrandSchema.parse({ name: " Linha Verão ", companyId: null })).toEqual({ name: "Linha Verão", companyId: null });
  });
  it("requires at least one field", () => {
    expect(updateBrandSchema.safeParse({}).success).toBe(false);
  });
});
