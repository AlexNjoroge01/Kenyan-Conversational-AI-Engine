import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "../db/client";
import { apiKeys, type ApiKey, type NewApiKey } from "../db/schema";

export const apiKeyRepository = {
  async create(values: Pick<NewApiKey, "userId" | "name" | "keyPrefix" | "keyHash">): Promise<ApiKey> {
    const [row] = await db.insert(apiKeys).values(values).returning();
    return row!;
  },

  async listByUser(userId: string): Promise<ApiKey[]> {
    return db.select().from(apiKeys).where(eq(apiKeys.userId, userId)).orderBy(desc(apiKeys.createdAt));
  },

  async findByHash(keyHash: string): Promise<ApiKey | undefined> {
    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, keyHash)).limit(1);
    return row;
  },

  /** Soft revocation. Returns undefined if the key doesn't exist or belongs to another user. */
  async revoke(id: string, userId: string): Promise<ApiKey | undefined> {
    const existing = await db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId)))
      .limit(1);
    if (!existing[0]) return undefined;
    if (existing[0].revokedAt) return existing[0];
    const [row] = await db
      .update(apiKeys)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt)))
      .returning();
    return row ?? existing[0];
  },

  async touchLastUsed(id: string): Promise<void> {
    await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
  },
};
