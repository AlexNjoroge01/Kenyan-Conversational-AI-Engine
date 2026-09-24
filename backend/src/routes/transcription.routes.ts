import { Router } from "express";
import type { createTranscriptionController } from "../controllers/transcription.controller";
import { authenticateApiKey } from "../middleware/api-key-auth";
import { apiRateLimit } from "../middleware/rate-limit";
import { uploadAudioFile } from "../middleware/upload";
import { validate } from "../middleware/validate";
import { transcriptionSchema } from "../schemas/transcription.schema";

export function createTranscriptionRoutes(controller: ReturnType<typeof createTranscriptionController>): Router {
  const router = Router();
  router.post(
    "/audio/transcriptions",
    authenticateApiKey,
    apiRateLimit,
    uploadAudioFile,
    validate(transcriptionSchema),
    controller.createTranscription,
  );
  return router;
}
