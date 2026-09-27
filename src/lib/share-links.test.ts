import { describe, it, expect } from "vitest";
import { buildMailtoUrl, buildShareMessage, buildWhatsAppUrl, normalizeWhatsAppPhone } from "./share-links";

describe("share links", () => {
  it("normalizes Brazilian phones for wa.me", () => {
    expect(normalizeWhatsAppPhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsAppPhone("11 3456-7890")).toBe("551134567890");
    expect(normalizeWhatsAppPhone("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizeWhatsAppPhone("+1 415 555 0100")).toBe(null);
    expect(normalizeWhatsAppPhone("123")).toBeNull();
    expect(normalizeWhatsAppPhone(null)).toBeNull();
  });

  it("builds the message with the contact's first name", () => {
    expect(buildShareMessage({ contactName: "Maria Fernandes", creatorName: "Thais", proposalTitle: "Campanha Verão", url: "https://x/p/t" })).toBe(
      'Olá, Maria! Segue a proposta "Campanha Verão" de Thais: https://x/p/t',
    );
    expect(buildShareMessage({ contactName: null, creatorName: "Thais", proposalTitle: "Campanha", url: "u" })).toBe(
      'Olá! Segue a proposta "Campanha" de Thais: u',
    );
  });

  it("builds wa.me and mailto URLs", () => {
    expect(buildWhatsAppUrl("5511987654321", "Oi & tchau")).toBe("https://wa.me/5511987654321?text=Oi%20%26%20tchau");
    expect(buildWhatsAppUrl(null, "Oi")).toBe("https://wa.me/?text=Oi");
    expect(buildMailtoUrl("maria@bella.test", "Proposta: X", "Corpo & link")).toBe(
      "mailto:maria@bella.test?subject=Proposta%3A%20X&body=Corpo%20%26%20link",
    );
    expect(buildMailtoUrl(null, "S", "B")).toBe("mailto:?subject=S&body=B");
  });
});
