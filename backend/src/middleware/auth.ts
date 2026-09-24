import type { RequestHandler } from "express";
import { env } from "../config/env";
import { authService } from "../services/auth.service";
import { unauthorized } from "../utils/errors";

/** Application auth: verifies the JWT stored in the HTTP-only cookie. */
export const authenticateUser: RequestHandler = (req, _res, next) => {
  const token = req.cookies?.[env.AUTH_COOKIE_NAME];
  if (typeof token !== "string" || !token) return next(unauthorized());
  try {
    const payload = authService.verifyToken(token);
    req.user = { id: payload.sub, email: payload.email };
    next();
  } catch (err) {
    next(err);
  }
};
