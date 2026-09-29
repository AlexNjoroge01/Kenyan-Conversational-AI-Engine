const LEGACY_VERIFY_FULL_ALIASES = new Set(["prefer", "require", "verify-ca"]);

/**
 * node-postgres treats sslmode=prefer|require|verify-ca as verify-full and prints a SECURITY WARNING for
 * them. Rewriting them to the explicit `verify-full` keeps the exact same (strict) behaviour without the
 * warning. `verify-full` (what Neon now issues), `disable`, and URLs opting into libpq semantics with
 * `uselibpqcompat=true` are left untouched.
 */
export function normalizeDatabaseUrl(connectionString: string): string {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    return connectionString;
  }
  const sslmode = url.searchParams.get("sslmode");
  if (!sslmode || url.searchParams.get("uselibpqcompat") === "true") return connectionString;
  if (!LEGACY_VERIFY_FULL_ALIASES.has(sslmode)) return connectionString;
  url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}
