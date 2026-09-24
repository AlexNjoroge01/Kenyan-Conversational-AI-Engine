import { index, integer, pgTable, real, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { apiKeys } from "./api-keys";
import { users } from "./users";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Usage history outlives the user/key it belongs to, so these are nulled rather than cascaded.
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    apiKeyId: uuid("api_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    endpoint: varchar("endpoint", { length: 100 }).notNull(),
    model: varchar("model", { length: 100 }),
    requestId: varchar("request_id", { length: 64 }).notNull(),
    status: integer("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    inputCharacters: integer("input_characters"),
    audioDurationSeconds: real("audio_duration_seconds"),
    errorCode: varchar("error_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("usage_events_user_id_created_at_idx").on(t.userId, t.createdAt),
    index("usage_events_api_key_id_idx").on(t.apiKeyId),
    index("usage_events_request_id_idx").on(t.requestId),
  ],
);

export type UsageEvent = typeof usageEvents.$inferSelect;
export type NewUsageEvent = typeof usageEvents.$inferInsert;
