import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getServerEnv } from "@revops/config/env";
import * as schema from "./schema/index";

let cachedClient: ReturnType<typeof drizzle<typeof schema>> | null = null;
let cachedQueryClient: ReturnType<typeof postgres> | null = null;

export function getDb() {
  if (cachedClient) return cachedClient;
  const env = getServerEnv();
  cachedQueryClient = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
    prepare: false,
  });
  cachedClient = drizzle(cachedQueryClient, { schema, casing: "snake_case" });
  return cachedClient;
}

export type Db = ReturnType<typeof getDb>;
export { schema };
