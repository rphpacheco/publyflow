import { describe, it, expect } from "vitest";
import { crmErrorResponse } from "./crm-errors";
import {
  BrandNotFoundError,
  CompanyNameTakenError,
  CompanyNotFoundError,
  CompanyRefNotFoundError,
  ContactNotFoundError,
} from "@/domain/crm/errors";

async function body(response: Response | null) {
  return { status: response?.status, json: await response?.json() };
}

describe("crmErrorResponse", () => {
  it("maps not-found errors to Portuguese 404s", async () => {
    expect(await body(crmErrorResponse(new CompanyNotFoundError("x")))).toEqual({ status: 404, json: { error: "Empresa não encontrada." } });
    expect(await body(crmErrorResponse(new ContactNotFoundError("x")))).toEqual({ status: 404, json: { error: "Contato não encontrado." } });
    expect(await body(crmErrorResponse(new BrandNotFoundError("x")))).toEqual({ status: 404, json: { error: "Brand não encontrada." } });
  });
  it("maps a taken name to 409 and a foreign company ref to 422", async () => {
    expect(await body(crmErrorResponse(new CompanyNameTakenError("Bella")))).toEqual({
      status: 409,
      json: { error: "Já existe uma empresa com esse nome.", code: "COMPANY_NAME_TAKEN" },
    });
    expect(await body(crmErrorResponse(new CompanyRefNotFoundError("x")))).toEqual({
      status: 422,
      json: { error: "Empresa selecionada não encontrada.", code: "COMPANY_NOT_FOUND" },
    });
  });
  it("maps a Postgres deadlock to 409", async () => {
    const result = await body(crmErrorResponse(Object.assign(new Error("deadlock"), { code: "40P01" })));
    expect(result.status).toBe(409);
  });
  it("returns null for unknown errors", () => {
    expect(crmErrorResponse(new Error("boom"))).toBeNull();
  });
});
