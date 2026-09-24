import type { RequestHandler } from "express";
import { logger } from "../utils/logger";

/** Structured access log, written once the response has finished. Never logs headers, bodies or credentials. */
export const requestLogger: RequestHandler = (req, res, next) => {
  const started = performance.now();
  res.on("finish", () => {
    const usage = res.locals.usage;
    logger.info(
      {
        requestId: req.id,
        method: req.method,
        endpoint: req.originalUrl.split("?")[0],
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
        userId: req.user?.id ?? req.apiKey?.userId,
        apiKeyId: req.apiKey?.id,
        model: usage?.model,
        providerLatencyMs: usage?.providerLatencyMs,
        errorCode: res.locals.errorCode,
      },
      "request completed",
    );
  });
  next();
};
