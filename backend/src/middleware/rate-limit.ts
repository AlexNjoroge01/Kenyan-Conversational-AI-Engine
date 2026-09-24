import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { env } from "../config/env";
import { AppError } from "../utils/errors";

function limiter(max: number, keyByCredential: boolean) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) =>
      (keyByCredential && req.apiKey ? `key:${req.apiKey.id}` : undefined) ?? ipKeyGenerator(req.ip ?? ""),
    handler: (_req, _res, next) => next(new AppError("RATE_LIMITED", "Too many requests. Please slow down.", 429)),
  });
}

/** Strict per-IP limit for register/login to slow credential stuffing. */
export const authRateLimit = limiter(env.AUTH_RATE_LIMIT_MAX, false);

/** Per-API-key limit for /v1/* (falls back to IP). Mount after API-key authentication. */
export const apiRateLimit = limiter(env.RATE_LIMIT_MAX, true);

/** Coarse per-IP limit for everything else (key management, docs). */
export const generalRateLimit = limiter(env.RATE_LIMIT_MAX, false);
