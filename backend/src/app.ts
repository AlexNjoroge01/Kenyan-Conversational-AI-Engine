import cookieParser from "cookie-parser";
import express, { type Express } from "express";
import helmet from "helmet";
import swaggerUi from "swagger-ui-express";
import { env } from "./config/env";
import { createChatController } from "./controllers/chat.controller";
import { createHealthController } from "./controllers/health.controller";
import { createSpeechController } from "./controllers/speech.controller";
import { createTranscriptionController } from "./controllers/transcription.controller";
import { openApiDocument } from "./docs/openapi";
import { corsMiddleware } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { notFoundHandler } from "./middleware/not-found";
import { generalRateLimit } from "./middleware/rate-limit";
import { requestId } from "./middleware/request-id";
import { requestLogger } from "./middleware/request-logger";
import { usageTracker } from "./middleware/usage-tracker";
import { createApiKeyRoutes } from "./routes/api-key.routes";
import { createAuthRoutes } from "./routes/auth.routes";
import { createChatRoutes } from "./routes/chat.routes";
import { createHealthRoutes } from "./routes/health.routes";
import { createSpeechRoutes } from "./routes/speech.routes";
import { createTranscriptionRoutes } from "./routes/transcription.routes";
import type { Services } from "./services/container";
import { AppError } from "./utils/errors";

export function createApp(services: Services): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", env.TRUST_PROXY);

  app.use(requestId);
  app.use(requestLogger);
  app.use(corsMiddleware);

  // Swagger UI needs inline scripts, so it is mounted before helmet's strict default CSP.
  app.get("/openapi.json", (_req, res) => {
    res.json(openApiDocument);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, { customSiteTitle: "Kenya Conversational AI API" }));

  app.use(helmet());
  app.use(express.json({ limit: env.MAX_JSON_BODY_BYTES }));
  app.use(cookieParser());

  app.use(createHealthRoutes(createHealthController(services)));

  app.use("/auth", createAuthRoutes());
  app.use("/api-keys", generalRateLimit, createApiKeyRoutes());

  // Public AI API. usageTracker is first so rejected requests are recorded too.
  const v1 = express.Router();
  v1.use(usageTracker);
  v1.use(createSpeechRoutes(createSpeechController(services.speech)));
  v1.use(createTranscriptionRoutes(createTranscriptionController(services.stt)));
  v1.use(createChatRoutes(createChatController(services.slm)));
  // Reserved for a later phase (full-duplex realtime); intentionally not built in the MVP.
  v1.all("/realtime", (_req, _res, next) => {
    next(new AppError("NOT_IMPLEMENTED", "The realtime API is not available yet.", 501));
  });
  app.use("/v1", v1);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
