import { Router } from "express";
import { authController } from "../controllers/auth.controller";
import { authenticateUser } from "../middleware/auth";
import { authRateLimit } from "../middleware/rate-limit";
import { validate } from "../middleware/validate";
import { loginSchema, registerSchema } from "../schemas/auth.schema";

export function createAuthRoutes(): Router {
  const router = Router();
  router.post("/register", authRateLimit, validate(registerSchema), authController.register);
  router.post("/login", authRateLimit, validate(loginSchema), authController.login);
  router.post("/logout", authController.logout);
  router.get("/me", authenticateUser, authController.me);
  return router;
}
