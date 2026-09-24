import { AppError, type ErrorCode } from "../utils/errors";

interface WorkerErrorCodes {
  unavailable: ErrorCode;
  failed: ErrorCode;
}

interface WorkerRequest {
  url: string;
  timeoutMs: number;
  init?: RequestInit;
  codes: WorkerErrorCodes;
  label: string;
}

/**
 * Calls an internal model worker. Network failures, timeouts and 502/503/504 map to the
 * "unavailable" code; any other non-2xx maps to the "failed" code. Worker internals are
 * never forwarded to the client.
 */
export async function callWorker({ url, timeoutMs, init, codes, label }: WorkerRequest): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new AppError(codes.unavailable, `The ${label} service is currently unavailable.`, 503);
  }
  if (response.ok) return response;
  if ([502, 503, 504].includes(response.status)) {
    throw new AppError(codes.unavailable, `The ${label} service is currently unavailable.`, 503);
  }
  throw new AppError(codes.failed, `The ${label} service failed to process the request.`, 502);
}

export async function checkWorkerHealth(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    return res.ok;
  } catch {
    return false;
  }
}
