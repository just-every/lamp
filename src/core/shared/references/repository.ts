export type ReferenceNamespace = "INC" | "SCH";
export type AllocatedReference = `${ReferenceNamespace}-${number}`;

/** Reserve a reference durably before creating an incident or maintenance.
 * D1 batch serializes counter advancement and reservation in one transaction.
 * A failed later product insert leaves a gap, never a reusable reference.
 */
export async function allocateReference(
  database: D1Database,
  namespace: ReferenceNamespace,
): Promise<AllocatedReference> {
  if (namespace !== "INC" && namespace !== "SCH") throw new Error("Unknown reference namespace");
  const results = await database.batch<{ reference: AllocatedReference }>([
    database.prepare(`
      UPDATE reference_counters SET last_number = (
        WITH RECURSIVE candidate(number) AS (
          SELECT last_number + 1
          UNION ALL
          SELECT number + 1 FROM candidate
          WHERE number < 9007199254740991 AND EXISTS (
            SELECT 1 FROM reference_allocations
            WHERE namespace = ? AND reference = ? || '-' || number
          )
        )
        SELECT MIN(number) FROM candidate
        WHERE NOT EXISTS (
          SELECT 1 FROM reference_allocations
          WHERE namespace = ? AND reference = ? || '-' || number
        )
      ) WHERE namespace = ? AND last_number < 9007199254740991
      RETURNING namespace || '-' || last_number AS reference
    `).bind(namespace, namespace, namespace, namespace, namespace),
    database.prepare(`
      INSERT INTO reference_allocations (namespace, reference)
      SELECT namespace, namespace || '-' || last_number
      FROM reference_counters WHERE namespace = ? AND changes() = 1
      RETURNING reference
    `).bind(namespace),
  ]);
  const reference = results[0]?.results[0]?.reference;
  if (!reference || results[1]?.results[0]?.reference !== reference) {
    throw new Error(`Could not allocate ${namespace} reference`);
  }
  return reference;
}
