import { Router } from "express";
import { apiKeyController } from "../controllers/api-key.controller";
import { authenticateUser } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { createApiKeySchema, revokeApiKeySchema } from "../schemas/api-key.schema";

export function createApiKeyRoutes(): Router {
  const router = Router();
  router.use(authenticateUser);
  router.post("/", validate(createApiKeySchema), apiKeyController.create);
  router.get("/", apiKeyController.list);
  router.delete("/:id", validate(revokeApiKeySchema), apiKeyController.revoke);
  return router;
}
