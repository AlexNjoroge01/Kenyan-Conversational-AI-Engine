export type ErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "EMAIL_ALREADY_EXISTS"
  | "INVALID_CREDENTIALS"
  | "API_KEY_INVALID"
  | "API_KEY_REVOKED"
  | "MODEL_NOT_FOUND"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "NOT_IMPLEMENTED"
  | "STT_UNAVAILABLE"
  | "STT_TRANSCRIPTION_FAILED"
  | "SLM_UNAVAILABLE"
  | "SLM_COMPLETION_FAILED"
  | "TTS_UNAVAILABLE"
  | "TTS_GENERATION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  issue: string;
}

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const validationError = (message = "Invalid request.", details?: ErrorDetail[]) =>
  new AppError("VALIDATION_ERROR", message, 400, details);
export const unauthorized = (message = "Authentication required.") =>
  new AppError("UNAUTHORIZED", message, 401);
export const notFound = (message = "Resource not found.") => new AppError("NOT_FOUND", message, 404);
export const modelNotFound = (model: string) =>
  new AppError("MODEL_NOT_FOUND", `The model '${model}' does not exist or is not supported.`, 404);
