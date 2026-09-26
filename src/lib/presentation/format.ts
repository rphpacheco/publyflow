const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const issuedAtFormat = new Intl.DateTimeFormat("pt-BR", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "America/Sao_Paulo",
});

/** 250000 -> "R$ 2.500,00" (regular space, not the NBSP Intl emits). */
export function formatBRL(cents: number): string {
  return brl.format(cents / 100).replace(/ /g, " ");
}

export function formatIssuedAt(date: Date): string {
  return issuedAtFormat.format(date);
}

const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

/** "25/09/2026, 14:32" (São Paulo). */
export function formatDateTime(date: Date): string {
  return dateTimeFormat.format(date);
}
