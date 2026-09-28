const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route ids reach Postgres `uuid` columns; a malformed one must be a 404, not a 22P02 → 500. */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
