import type { RequestHandler } from "express";
import { env } from "../config/env";
import { apiKeyService } from "../services/api-key.service";
import { AppError } from "../utils/errors";

/** Developer API auth: `Authorization: Bearer sk_live_...`. */
export const authenticateApiKey: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    const match = header ? /^Bearer\s+(\S+)$/i.exec(header) : null;
    if (!match) {
      throw new AppError("UNAUTHORIZED", "Missing API key. Send 'Authorization: Bearer <API_KEY>'.", 401);
    }
    const key = match[1]!;
    if (!key.startsWith(env.API_KEY_PREFIX)) {
      throw new AppError("API_KEY_INVALID", "The API key provided is invalid.", 401);
    }
    req.apiKey = await apiKeyService.authenticate(key);
    next();
  } catch (err) {
    next(err);
  }
};
