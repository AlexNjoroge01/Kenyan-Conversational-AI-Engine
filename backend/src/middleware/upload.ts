import type { RequestHandler } from "express";
import multer from "multer";
import { ALLOWED_AUDIO_MIME_TYPES } from "../config/constants";
import { env } from "../config/env";
import { AppError, validationError } from "../utils/errors";

const multipart = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_BYTES, files: 1, fields: 10 },
}).single("file");

/** Parses a multipart upload with a single audio `file` field, enforcing presence, media type and size. */
export const uploadAudioFile: RequestHandler = (req, res, next) => {
  multipart(req, res, (err?: unknown) => {
    if (err) return next(err);
    const file = req.file;
    if (!file) {
      return next(validationError("Invalid request.", [{ field: "file", issue: "An audio file is required." }]));
    }
    const mime = file.mimetype.toLowerCase().split(";")[0]!;
    if (!(ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mime)) {
      return next(new AppError("UNSUPPORTED_MEDIA_TYPE", `Unsupported audio type '${mime}'.`, 415));
    }
    if (file.size === 0) {
      return next(validationError("Invalid request.", [{ field: "file", issue: "The audio file is empty." }]));
    }
    next();
  });
};
