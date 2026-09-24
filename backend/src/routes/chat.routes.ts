import { Router } from "express";
import type { createChatController } from "../controllers/chat.controller";
import { authenticateApiKey } from "../middleware/api-key-auth";
import { apiRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { chatSchema } from "../schemas/chat.schema";

export function createChatRoutes(controller: ReturnType<typeof createChatController>): Router {
  const router = Router();
  router.post("/chat/completions", authenticateApiKey, apiRateLimit, validate(chatSchema), controller.createCompletion);
  return router;
}
