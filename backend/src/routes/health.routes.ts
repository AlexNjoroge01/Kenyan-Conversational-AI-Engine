import { Router } from "express";
import type { createHealthController } from "../controllers/health.controller";

export function createHealthRoutes(controller: ReturnType<typeof createHealthController>): Router {
  const router = Router();
  router.get("/", controller.root);
  router.get("/health", controller.health);
  router.get("/ready", controller.ready);
  return router;
}
