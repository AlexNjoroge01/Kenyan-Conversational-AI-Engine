import type { ErrorRequestHandler } from "express";
import multer from "multer";
import { env } from "../config/env";
import { AppError, type ErrorCode, type ErrorDetail } from "../utils/errors";
import { logger } from "../utils/logger";

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: ErrorDetail[];
  headers?: Record<string, string>;
}

function normalize(err: unknown): NormalizedError {
  if (err instanceof AppError) {
    return { status: err.status, code: err.code, message: err.message, details: err.details, headers: err.headers };
  }
  if (err instanceof multer.MulterError) {
    if (err.code === "LIMIT_FILE_SIZE") {
      return {
        status: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: `The uploaded file exceeds the ${(env.maxUploadBytes / 1_000_000).toFixed(0)} MB limit.`,
      };
    }
    return { status: 400, code: "VALIDATION_ERROR", message: `Invalid upload: ${err.message}` };
  }
  const type = (err as { type?: string } | null)?.type;
  if (type === "entity.parse.failed") {
    return { status: 400, code: "VALIDATION_ERROR", message: "Malformed JSON in request body." };
  }
  if (type === "entity.too.large") {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "The request body is too large." };
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "An unexpected error occurred." };
}

/** The single place errors become HTTP responses. Never leaks stack traces or internals. */
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  if (res.headersSent) return next(err);

  const normalized = normalize(err);
  res.locals.errorCode = normalized.code;

  if (normalized.status >= 500) {
    logger.error({ err, requestId: req.id, code: normalized.code }, "request failed");
  }

  if (normalized.headers) res.set(normalized.headers);
  res.status(normalized.status).json({
    error: {
      code: normalized.code,
      message: normalized.message,
      requestId: req.id,
      ...(normalized.details ? { details: normalized.details } : {}),
    },
  });
};
