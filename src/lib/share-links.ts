/** wa.me needs the full international number, digits only. Brazil-first. */
export function normalizeWhatsAppPhone(phone: string | null): string | null {
  if (!phone) return null;
  const international = phone.trim().startsWith("+");
  const digits = phone.replace(/\D/g, "");
  if (international) return digits.startsWith("55") && (digits.length === 12 || digits.length === 13) ? digits : null;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) return digits;
  return null;
}

export function buildShareMessage(input: {
  contactName: string | null;
  creatorName: string;
  proposalTitle: string;
  url: string;
}): string {
  const firstName = input.contactName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Olá, ${firstName}!` : "Olá!";
  return `${greeting} Segue a proposta "${input.proposalTitle}" de ${input.creatorName}: ${input.url}`;
}

export function buildWhatsAppUrl(phone: string | null, message: string): string {
  return `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`;
}

export function buildMailtoUrl(email: string | null, subject: string, body: string): string {
  return `mailto:${email ?? ""}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
