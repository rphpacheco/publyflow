export function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

/** True when the normalized query is a substring of any non-empty field; an empty query matches everything. */
export function matchesSearch(query: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return true;
  return fields.some((field) => (field ? normalizeSearch(field).includes(needle) : false));
}
