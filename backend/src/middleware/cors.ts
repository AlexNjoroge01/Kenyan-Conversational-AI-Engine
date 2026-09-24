import cors from "cors";
import { env } from "../config/env";
import { REQUEST_ID_HEADER } from "../config/constants";

/** Explicit allow-list from CORS_ORIGINS. Credentials are enabled so the future frontend can use the auth cookie. */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // Non-browser clients (curl, server-to-server) send no Origin header.
    if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  exposedHeaders: [REQUEST_ID_HEADER],
  maxAge: 600,
});
