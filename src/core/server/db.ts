import "server-only";
import type { PoolClient, QueryResult, QueryResultRow } from "@neondatabase/serverless";
import { createNeonHttpClient, getNeonTransactionPool } from "@/core/server/neon";

export type TransactionClient = PoolClient;

export async function queryRows<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const rows = await createNeonHttpClient().query(text, [...values]);
  return rows as T[];
}

export async function withTransaction<T>(
  operation: (client: TransactionClient) => Promise<T>,
): Promise<T> {
  const client = await getNeonTransactionPool().connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export function firstRow<T extends QueryResultRow>(result: QueryResult<T>): T | undefined {
  return result.rows[0];
}
