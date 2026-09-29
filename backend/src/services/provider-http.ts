import { AppError, type ErrorCode } from "../utils/errors";
import { logger } from "../utils/logger";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface ProviderErrorCodes {
  unavailable: ErrorCode;
  failed: ErrorCode;
}

export interface ProviderContext {
  /** Client-facing service name, e.g. "text-to-speech". */
  label: string;
  /** Internal provider name for logs only (never sent to clients), e.g. "groq" or "gpu-worker". */
  provider: string;
  codes: ProviderErrorCodes;
}

export interface ProviderRequest extends ProviderContext {
  url: string;
  timeoutMs: number;
  init?: RequestInit;
  fetch?: FetchLike;
}

/** Options shared by the providers that call a self-hosted GPU worker. */
export interface WorkerProviderOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Sent as X-Worker-Key. */
  workerApiKey?: string;
  fetch?: FetchLike;
}

const PROBE_TIMEOUT_MS = 3_000;
const MAX_RETRY_AFTER_SECONDS = 120;

/** Headers every self-hosted GPU worker call carries: the shared secret, and the ngrok interstitial bypass. */
export function workerHeaders(workerApiKey?: string): Record<string, string> {
  return {
    "ngrok-skip-browser-warning": "true",
    ...(workerApiKey ? { "X-Worker-Key": workerApiKey } : {}),
  };
}

const unavailable = (ctx: ProviderContext, reason = "is currently unavailable") =>
  new AppError(ctx.codes.unavailable, `The ${ctx.label} service ${reason}.`, 503);

const failed = (ctx: ProviderContext, reason = "failed to process the request", status = 502) =>
  new AppError(ctx.codes.failed, `The ${ctx.label} service ${reason}.`, status);

/** A 2xx response whose body does not match the expected contract. */
export const invalidResponse = (ctx: ProviderContext, reason = "returned an invalid response") => failed(ctx, reason);

const isTimeout =(err: unknown) => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

function retryAfterSeconds(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(Math.ceil(seconds), MAX_RETRY_AFTER_SECONDS);
}

/**
 * Maps a provider's non-2xx status to one of our error codes. Provider bodies, URLs and keys are never
 * forwarded to the client or written to logs; only the provider name and status are logged.
 */
function mapErrorStatus(ctx: ProviderContext, response: Response): AppError {
  const { status } = response;
  const log = { provider: ctx.provider, service: ctx.label, status };

  if (status === 401 || status === 403) {
    logger.error(log, "model provider rejected our credentials; check the provider API key or WORKER_API_KEY");
    return unavailable(ctx);
  }
  if (status === 429) {
    logger.warn(log, "model provider rate limited the request");
    const retryAfter = retryAfterSeconds(response);
    return new AppError(
      "RATE_LIMITED",
      `The ${ctx.label} service is receiving too many requests. Please retry shortly.`,
      429,
      undefined,
      retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
    );
  }
  if (status === 413) {
    return new AppError("PAYLOAD_TOO_LARGE", `The input is too large for the ${ctx.label} service.`, 413);
  }
  if (status === 400 || status === 422) {
    logger.warn(log, "model provider rejected the input");
    return failed(ctx, "could not process this input", 422);
  }
  // 404: an offline ngrok tunnel answers 404 (ERR_NGROK_3200), as does a wrong base URL.
  if ([404, 408, 502, 503, 504].includes(status)) {
    logger.warn(log, "model provider unavailable");
    return unavailable(ctx);
  }
  logger.warn(log, "model provider failed");
  return failed(ctx);
}

/** Calls a model provider with a timeout. Returns only 2xx responses; everything else becomes an AppError. */
export async function callProvider(req: ProviderRequest): Promise<Response> {
  const doFetch = req.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(req.url, { ...req.init, signal: AbortSignal.timeout(req.timeoutMs) });
  } catch (err) {
    const timedOut = isTimeout(err);
    logger.warn({ provider: req.provider, service: req.label, reason: timedOut ? "timeout" : "network" }, "model provider unreachable");
    throw unavailable(req, timedOut ? "did not respond in time" : undefined);
  }
  if (response.ok) return response;
  await response.body?.cancel().catch(() => undefined);
  throw mapErrorStatus(req, response);
}

/** Reads a JSON object body. A body that times out mid-read is "unavailable"; anything unparsable is "failed". */
export async function readJsonObject(response: Response, ctx: ProviderContext): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    if (isTimeout(err)) throw unavailable(ctx, "did not respond in time");
    throw invalidResponse(ctx);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidResponse(ctx);
  return body as Record<string, unknown>;
}

/** Reads a binary body (e.g. audio). */
export async function readBytes(response: Response, ctx: ProviderContext): Promise<Buffer> {
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (err) {
    throw isTimeout(err) ? unavailable(ctx, "did not respond in time") : unavailable(ctx);
  }
}

/** A short health probe. Resolves to the response on 2xx, or null on any failure. Never throws. */
export async function probe(url: string, init: RequestInit = {}, fetchImpl: FetchLike = fetch): Promise<Response | null> {
  try {
    const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (res.ok) return res;
    await res.body?.cancel().catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}

/**
 * Checks a GPU worker's /health. The worker reports which models are loaded ({"models": {"tts": true, ...}});
 * a worker that omits the field is treated as healthy when it answers 2xx.
 */
export async function workerModelHealthy(
  baseUrl: string,
  model: "stt" | "slm" | "tts",
  workerApiKey: string | undefined,
  fetchImpl: FetchLike = fetch,
): Promise<boolean> {
  const res = await probe(`${baseUrl}/health`, { headers: workerHeaders(workerApiKey) }, fetchImpl);
  if (!res) return false;
  const body = (await res.json().catch(() => null)) as { models?: Record<string, unknown> } | null;
  const loaded = body?.models?.[model];
  return typeof loaded === "boolean" ? loaded : true;
}

/**
 * Wraps a health check so repeated /ready calls reuse a recent result instead of hitting a remote
 * provider (and its rate limits) every time. Concurrent callers share one in-flight probe.
 */
export function cachedHealthCheck(check: () => Promise<boolean>, ttlMs = 10_000): () => Promise<boolean> {
  let cached: { value: boolean; at: number } | undefined;
  let inFlight: Promise<boolean> | undefined;
  return () => {
    if (cached && Date.now() - cached.at < ttlMs) return Promise.resolve(cached.value);
    inFlight ??= check()
      .catch(() => false)
      .then((value) => {
        cached = { value, at: Date.now() };
        inFlight = undefined;
        return value;
      });
    return inFlight;
  };
}
