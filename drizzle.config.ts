import { defineConfig } from "drizzle-kit";

const rawUrl = process.env.DATABASE_URL?.trim();

if (!rawUrl) {
  throw new Error(
    "DATABASE_URL is missing. Set it to file:./dev.db for SQLite or a Postgres URL."
  );
}

const looksLikeSqlite =
  rawUrl.startsWith("file:") || rawUrl.startsWith("sqlite:") || rawUrl.endsWith(".db");

const normalizeSqliteUrl = (value: string) => {
  if (value.startsWith("file:") || value.startsWith("sqlite:")) {
    const rest = value.replace(/^file:|^sqlite:/, "");
    if (!rest || rest.trim().length === 0) {
      throw new Error(
        "DATABASE_URL for SQLite must include a file path, e.g. file:./dev.db"
      );
    }
    return value.startsWith("sqlite:") ? `file:${rest}` : value;
  }
  if (value.endsWith(".db")) {
    return `file:${value}`;
  }
  throw new Error(
    "DATABASE_URL looks like SQLite but is malformed. Use file:./dev.db or ./dev.db."
  );
};

const dialect = looksLikeSqlite ? "sqlite" : "postgresql";
const url = looksLikeSqlite ? normalizeSqliteUrl(rawUrl) : rawUrl;

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect,
  dbCredentials: {
    url,
  },
});
