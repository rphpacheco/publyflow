import { describe, it, expect } from "vitest";
import { groupsFor, detailLine } from "./queue-labels";
import type { QueueItemDto } from "@/hooks/use-proposal-queue";

const base: QueueItemDto = {
  id: "p1",
  title: "Proposta Teste",
  situation: "draft",
  creatorName: "Thais",
  counterpartName: "Marca X",
  totalCents: 100000,
  lastActivityAt: "2026-09-28T12:00:00Z",
  latestVersionNumber: 1,
  latestPublication: null,
  changes: null,
  approvedByCreator: false,
  approvalStale: false,
  clientOutcome: null,
};

describe("groupsFor", () => {
  it("agency order and labels", () => {
    const groups = groupsFor("agency");
    expect(groups.map((g) => g.label)).toEqual([
      "Ajustes pedidos",
      "Pronta para enviar",
      "Aguardando creator",
      "Rascunho",
      "Aguardando cliente",
      "Fechadas",
      "Arquivadas",
    ]);
    expect(groups.map((g) => g.situations)).toEqual([
      ["changes_requested"],
      ["ready_to_send"],
      ["awaiting_creator"],
      ["draft"],
      ["awaiting_client"],
      ["closed"],
      ["archived"],
    ]);
  });

  it("creator order and labels", () => {
    const groups = groupsFor("creator");
    expect(groups.map((g) => g.label)).toEqual([
      "Aguardando sua aprovação",
      "Em ajustes",
      "Com a agência",
      "Aguardando cliente",
      "Fechadas",
      "Arquivadas",
    ]);
    expect(groups.map((g) => g.situations)).toEqual([
      ["awaiting_creator"],
      ["changes_requested"],
      ["ready_to_send", "draft"],
      ["awaiting_client"],
      ["closed"],
      ["archived"],
    ]);
  });
});

describe("detailLine", () => {
  it("client changes — same for both viewers", () => {
    const item: QueueItemDto = {
      ...base,
      situation: "changes_requested",
      changes: { by: "client", name: "Maria", excerpt: "Trocar a capa" },
    };
    expect(detailLine(item, "agency")).toBe("Maria pediu: Trocar a capa");
    expect(detailLine(item, "creator")).toBe("Maria pediu: Trocar a capa");
  });

  it("creator changes — agency sees the creator's name, creator sees 'Você'", () => {
    const item: QueueItemDto = {
      ...base,
      situation: "changes_requested",
      changes: { by: "creator", name: "Thais", excerpt: "Ajustar preço" },
    };
    expect(detailLine(item, "agency")).toBe("Thais pediu: Ajustar preço");
    expect(detailLine(item, "creator")).toBe("Você pediu: Ajustar preço");
  });

  it("ready_to_send approved", () => {
    const item: QueueItemDto = { ...base, situation: "ready_to_send", approvedByCreator: true, creatorName: "Thais" };
    expect(detailLine(item, "agency")).toBe("Aprovada por Thais");
  });

  it("ready_to_send not approved", () => {
    const item: QueueItemDto = { ...base, situation: "ready_to_send", approvedByCreator: false, latestVersionNumber: 3 };
    expect(detailLine(item, "agency")).toBe("Alterações não enviadas · versão 3");
  });

  it("awaiting_creator — agency vs creator wording", () => {
    const item: QueueItemDto = { ...base, situation: "awaiting_creator", latestVersionNumber: 2 };
    expect(detailLine(item, "agency")).toBe("Versão 2 aguardando aprovação");
    expect(detailLine(item, "creator")).toBe("Versão 2 aguardando sua aprovação");
  });

  it("draft — stale", () => {
    const item: QueueItemDto = { ...base, situation: "draft", approvalStale: true };
    expect(detailLine(item, "agency")).toBe("A proposta mudou depois do pedido de aprovação");
  });

  it("draft — with prior publication", () => {
    const item: QueueItemDto = {
      ...base,
      situation: "draft",
      approvalStale: false,
      latestVersionNumber: 3,
      latestPublication: { versionNumber: 2, publishedAt: "2026-09-20T12:00:00Z" },
    };
    expect(detailLine(item, "agency")).toBe("Alterações não enviadas · versão 3");
  });

  it("draft — never sent", () => {
    const item: QueueItemDto = { ...base, situation: "draft", approvalStale: false, latestPublication: null };
    expect(detailLine(item, "agency")).toBe("Ainda não enviada");
  });

  it("awaiting_client", () => {
    const item: QueueItemDto = {
      ...base,
      situation: "awaiting_client",
      latestPublication: { versionNumber: 2, publishedAt: "2026-09-28T15:00:00Z" },
    };
    expect(detailLine(item, "agency")).toBe("Versão 2 enviada em 28/09/2026");
  });

  it("closed — ACCEPT", () => {
    const item: QueueItemDto = {
      ...base,
      situation: "closed",
      clientOutcome: { action: "ACCEPT", name: "Maria", at: "2026-09-29T10:00:00Z" },
    };
    expect(detailLine(item, "agency")).toBe("Aceita por Maria em 29/09/2026");
  });

  it("closed — REJECT", () => {
    const item: QueueItemDto = {
      ...base,
      situation: "closed",
      clientOutcome: { action: "REJECT", name: "Maria", at: "2026-09-29T10:00:00Z" },
    };
    expect(detailLine(item, "agency")).toBe("Recusada por Maria em 29/09/2026");
  });

  it("archived", () => {
    const item: QueueItemDto = { ...base, situation: "archived" };
    expect(detailLine(item, "agency")).toBe("Arquivada");
  });
});
