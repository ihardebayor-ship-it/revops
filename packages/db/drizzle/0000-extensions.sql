-- Extensions required by the schema. Run before drizzle-kit's generated
-- migrations. This file is hand-rolled and lives outside drizzle-kit's
-- generated journal.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "vector";
