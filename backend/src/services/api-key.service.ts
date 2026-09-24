import { apiKeyRepository } from "../repositories/api-key.repository";
import type { ApiKeyPrincipal } from "../types/auth";
import { generateApiKey, hashApiKey } from "../utils/crypto";
import { AppError, notFound } from "../utils/errors";

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export const apiKeyService = {
  /** The plaintext key is returned here and never again; only its hash is stored. */
  async create(userId: string, name: string): Promise<{ id: string; name: string; key: string; createdAt: Date }> {
    const { key, keyPrefix, keyHash } = generateApiKey();
    const row = await apiKeyRepository.create({ userId, name, keyPrefix, keyHash });
    return { id: row.id, name: row.name, key, createdAt: row.createdAt };
  },

  async list(userId: string): Promise<ApiKeySummary[]> {
    const rows = await apiKeyRepository.listByUser(userId);
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.keyPrefix,
      createdAt: r.createdAt,
      lastUsedAt: r.lastUsedAt,
      revokedAt: r.revokedAt,
    }));
  },

  async revoke(userId: string, id: string): Promise<void> {
    const row = await apiKeyRepository.revoke(id, userId);
    if (!row) throw notFound("API key not found.");
  },

  /** Resolves a presented bearer key to its owner, rejecting unknown or revoked keys. */
  async authenticate(presentedKey: string): Promise<ApiKeyPrincipal> {
    const row = await apiKeyRepository.findByHash(hashApiKey(presentedKey));
    if (!row) throw new AppError("API_KEY_INVALID", "The API key provided is invalid.", 401);
    if (row.revokedAt) throw new AppError("API_KEY_REVOKED", "The API key provided has been revoked.", 401);
    // Best-effort: a failed timestamp update must not fail the request.
    void apiKeyRepository.touchLastUsed(row.id).catch(() => undefined);
    return { id: row.id, userId: row.userId };
  },
};
