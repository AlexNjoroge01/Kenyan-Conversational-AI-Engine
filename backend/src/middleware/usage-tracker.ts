import type { RequestHandler } from "express";
import { usageService } from "../services/usage.service";

/**
 * Records one usage_events row per /v1/* request once the response finishes. Controllers describe the
 * request via res.locals.usage; the error handler sets res.locals.errorCode. Mount before authentication
 * so rejected requests are recorded too.
 */
export const usageTracker: RequestHandler = (req, res, next) => {
  const started = performance.now();
  res.on("finish", () => {
    const usage = res.locals.usage;
    usageService.record({
      userId: req.apiKey?.userId ?? null,
      apiKeyId: req.apiKey?.id ?? null,
      endpoint: req.originalUrl.split("?")[0]!,
      model: usage?.model ?? null,
      requestId: req.id,
      status: res.statusCode,
      durationMs: Math.round(performance.now() - started),
      inputCharacters: usage?.inputCharacters ?? null,
      audioDurationSeconds: usage?.audioDurationSeconds ?? null,
      errorCode: res.locals.errorCode ?? null,
    });
  });
  next();
};
