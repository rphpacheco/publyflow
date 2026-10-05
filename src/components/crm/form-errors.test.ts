import { describe, it, expect } from "vitest";
import { ApiError } from "@/lib/api-client";
import { toFormErrors } from "./form-errors";

const FIELDS = ["name", "companyId"] as const;

describe("toFormErrors", () => {
  it("puts a 409 under the conflict field", () => {
    expect(toFormErrors(new ApiError(409, "Já existe uma empresa com esse nome.", { code: "COMPANY_NAME_TAKEN" }), FIELDS, "name")).toEqual({
      fieldErrors: { name: "Já existe uma empresa com esse nome." },
      formError: null,
    });
  });
  it("keeps a 409 without COMPANY_NAME_TAKEN (e.g. deadlock) as a form error", () => {
    expect(
      toFormErrors(new ApiError(409, "Não foi possível salvar agora. Tente novamente."), FIELDS, "name"),
    ).toEqual({ fieldErrors: {}, formError: "Não foi possível salvar agora. Tente novamente." });
  });
  it("maps 400 field errors and keeps form-level errors as formError", () => {
    expect(toFormErrors(new ApiError(400, "x", { errors: { name: ["Informe o nome."] } }), FIELDS)).toEqual({
      fieldErrors: { name: "Informe o nome." },
      formError: null,
    });
    expect(toFormErrors(new ApiError(400, "Informe ao menos um campo.", { errors: { form: ["Informe ao menos um campo."] } }), FIELDS)).toEqual({
      fieldErrors: {},
      formError: "Informe ao menos um campo.",
    });
  });
  it("puts a 422 company error under companyId when that field exists", () => {
    expect(toFormErrors(new ApiError(422, "Empresa selecionada não encontrada.", { code: "COMPANY_NOT_FOUND" }), FIELDS)).toEqual({
      fieldErrors: { companyId: "Empresa selecionada não encontrada." },
      formError: null,
    });
  });
  it("falls back to a generic message for non-API errors", () => {
    expect(toFormErrors(new Error("x"), FIELDS).formError).toBe("Não foi possível salvar. Tente novamente.");
  });
});
