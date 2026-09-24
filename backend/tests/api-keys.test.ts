import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { db } from "../src/db/client";
import { apiKeys } from "../src/db/schema";
import { bearer, createApiKey, postJson, registerUser, startServer, type TestServer } from "./helpers";

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

const speech = (key?: string) =>
  postJson(
    `${server.url}/v1/audio/speech`,
    { model: "sauti-v2", input: "Habari", response_format: "wav" },
    key ? bearer(key) : {},
  );

describe("management", () => {
  test("requires authentication", async () => {
    expect((await fetch(`${server.url}/api-keys`)).status).toBe(401);
    expect((await postJson(`${server.url}/api-keys`, { name: "x" })).status).toBe(401);
    expect((await fetch(`${server.url}/api-keys/${crypto.randomUUID()}`, { method: "DELETE" })).status).toBe(401);
  });

  test("creates a key that is shown in full once and stored only as a hash", async () => {
    const { cookie } = await registerUser(server.url);
    const created = await createApiKey(server.url, cookie, "Local Development");
    expect(created.key).toStartWith("sk_live_");
    expect(created.name).toBe("Local Development");

    const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
    expect(row!.keyHash).not.toBe(created.key);
    expect(JSON.stringify(row)).not.toContain(created.key);
    expect(row!.keyPrefix).toBe(created.key.slice(0, 12));
  });

  test("lists keys without exposing the full key", async () => {
    const { cookie } = await registerUser(server.url);
    const created = await createApiKey(server.url, cookie);
    const res = await fetch(`${server.url}/api-keys`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const list = await res.json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: created.id, name: "test key", lastUsedAt: null, revokedAt: null });
    expect(list[0].keyPrefix).toBe(created.key.slice(0, 12));
    expect(JSON.stringify(list)).not.toContain(created.key);
    expect(list[0].keyHash).toBeUndefined();
  });

  test("only lists the caller's own keys", async () => {
    const a = await registerUser(server.url);
    const b = await registerUser(server.url);
    await createApiKey(server.url, a.cookie);
    const res = await fetch(`${server.url}/api-keys`, { headers: { Cookie: b.cookie } });
    expect(await res.json()).toEqual([]);
  });

  test("validates the name", async () => {
    const { cookie } = await registerUser(server.url);
    const res = await postJson(`${server.url}/api-keys`, { name: "  " }, { Cookie: cookie });
    expect(res.status).toBe(400);
  });

  test("rejects a malformed id and unknown ids", async () => {
    const { cookie } = await registerUser(server.url);
    const bad = await fetch(`${server.url}/api-keys/not-a-uuid`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(bad.status).toBe(400);
    const missing = await fetch(`${server.url}/api-keys/${crypto.randomUUID()}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(missing.status).toBe(404);
  });

  test("cannot revoke another user's key", async () => {
    const owner = await registerUser(server.url);
    const other = await registerUser(server.url);
    const created = await createApiKey(server.url, owner.cookie);
    const res = await fetch(`${server.url}/api-keys/${created.id}`, { method: "DELETE", headers: { Cookie: other.cookie } });
    expect(res.status).toBe(404);
    expect((await speech(created.key)).status).toBe(200);
  });
});

describe("authenticating with a key", () => {
  test("a valid key works and updates last_used_at", async () => {
    const { cookie } = await registerUser(server.url);
    const created = await createApiKey(server.url, cookie);
    expect((await speech(created.key)).status).toBe(200);

    let lastUsedAt: Date | null = null;
    for (let i = 0; i < 40 && !lastUsedAt; i++) {
      await Bun.sleep(25);
      const [row] = await db.select().from(apiKeys).where(eq(apiKeys.id, created.id));
      lastUsedAt = row?.lastUsedAt ?? null;
    }
    expect(lastUsedAt).not.toBeNull();
  });

  test("an unknown key is rejected", async () => {
    const res = await speech("sk_live_thisisnotarealkey");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("API_KEY_INVALID");
  });

  test("a key without the expected prefix is rejected", async () => {
    const res = await speech("garbage");
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("API_KEY_INVALID");
  });

  test("a revoked key is rejected and stays in the list as revoked", async () => {
    const { cookie } = await registerUser(server.url);
    const created = await createApiKey(server.url, cookie);
    expect((await speech(created.key)).status).toBe(200);

    const revoke = await fetch(`${server.url}/api-keys/${created.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(revoke.status).toBe(204);

    const res = await speech(created.key);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("API_KEY_REVOKED");

    const list = await (await fetch(`${server.url}/api-keys`, { headers: { Cookie: cookie } })).json();
    expect(list[0].revokedAt).toBeString();

    // Revoking twice is harmless.
    const again = await fetch(`${server.url}/api-keys/${created.id}`, { method: "DELETE", headers: { Cookie: cookie } });
    expect(again.status).toBe(204);
  });
});
