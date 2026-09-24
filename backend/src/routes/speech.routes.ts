import { Router } from "express";
import type { createSpeechController } from "../controllers/speech.controller";
import { authenticateApiKey } from "../middleware/api-key-auth";
import { apiRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { speechSchema } from "../schemas/speech.schema";

export function createSpeechRoutes(controller: ReturnType<typeof createSpeechController>): Router {
  const router = Router();
  router.post("/audio/speech", authenticateApiKey, apiRateLimit, validate(speechSchema), controller.createSpeech);
  return router;
}
