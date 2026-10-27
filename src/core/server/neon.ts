import { neon, Pool } from "@neondatabase/serverless";
import { requireServerEnv } from "@/core/server/env";

/** Creates an HTTP SQL client for independent, single-operation queries. */
export function createNeonHttpClient() {
  return neon(requireServerEnv("DATABASE_URL"));
}

let transactionPool: Pool | undefined;

/** Lazily creates a WebSocket pool for interactive transactions. */
export function getNeonTransactionPool(): Pool {
  transactionPool ??= new Pool({ connectionString: requireServerEnv("DATABASE_URL") });
  return transactionPool;
}
