import type { CookieOptions } from "express";

export type SameSite = "lax" | "strict" | "none";

/**
 * Options for the HTTP-only auth cookie. Browsers reject `SameSite=None` without `Secure`,
 * so `none` always forces Secure; otherwise Secure follows the environment.
 */
export function authCookieOptions(sameSite: SameSite, isProduction: boolean): CookieOptions {
  return {
    httpOnly: true,
    secure: isProduction || sameSite === "none",
    sameSite,
    path: "/",
  };
}
