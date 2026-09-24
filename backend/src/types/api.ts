import type { ApiKeyPrincipal, AuthUser } from "./auth";

export interface UsageContext {
  model?: string;
  inputCharacters?: number;
  audioDurationSeconds?: number;
  /** Time spent inside the model worker, logged for latency measurement. */
  providerLatencyMs?: number;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      user?: AuthUser;
      apiKey?: ApiKeyPrincipal;
    }
    interface Locals {
      usage?: UsageContext;
      errorCode?: string;
    }
  }
}

export {};
