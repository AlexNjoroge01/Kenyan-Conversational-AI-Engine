import { usageRepository } from "../repositories/usage.repository";
import type { NewUsageEvent } from "../db/schema";
import { logger } from "../utils/logger";

export const usageService = {
  /** Fire-and-forget: usage logging must never fail or slow a customer request. */
  record(event: NewUsageEvent): void {
    usageRepository.insert(event).catch((err) => {
      logger.error({ err, requestId: event.requestId }, "failed to record usage event");
    });
  },
};
