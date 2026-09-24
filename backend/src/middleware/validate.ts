import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { validationError } from "../utils/errors";

/**
 * Validates req.body / req.params / req.query against a Zod schema shaped `{ body?, params?, query? }`.
 * Parsed (coerced, defaulted) values replace the raw ones, and unknown keys are stripped.
 */
export const validate =
  (schema: ZodType<{ body?: unknown; params?: unknown; query?: unknown }>): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse({ body: req.body ?? {}, params: req.params, query: req.query });
    if (!result.success) {
      return next(
        validationError(
          "Invalid request.",
          result.error.issues.map((issue) => ({
            field: issue.path.filter((p) => p !== "body" && p !== "params" && p !== "query").join(".") || "(root)",
            issue: issue.message,
          })),
        ),
      );
    }
    if (result.data.body !== undefined) req.body = result.data.body;
    if (result.data.params !== undefined) req.params = result.data.params as typeof req.params;
    next();
  };
