import { db } from "../db/client";
import { usageEvents, type NewUsageEvent } from "../db/schema";

export const usageRepository = {
  async insert(event: NewUsageEvent): Promise<void> {
    await db.insert(usageEvents).values(event);
  },
};
