import { eq } from "drizzle-orm";
import type { Server } from "node:http";
import { createApp } from "../src/app";
import { db } from "../src/db/client";
import { usageEvents } from "../src/db/schema";
import { createServices, type Providers } from "../src/services/container";
import { fakeProviders } from "./fakes";

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startServer(overrides: Partial<Providers> = {}): Promise<TestServer> {
  const app = createApp(createServices({ ...fakeProviders(), ...overrides }));
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
        // Bun can leave the close callback pending after an aborted upload; don't let that hang the suite.
        setTimeout(resolve, 300);
      }),
  };
}

export const randomEmail = () => `dev-${crypto.randomUUID()}@example.com`;
export const PASSWORD = "correct-horse-battery";

/** Extracts "name=value" cookie pairs from a response so they can be replayed on later requests. */
export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function registerUser(baseUrl: string, email = randomEmail()) {
  const res = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  return { res, email, cookie: cookieFrom(res) };
}

export async function createApiKey(baseUrl: string, cookie: string, name = "test key") {
  const res = await fetch(`${baseUrl}/api-keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name }),
  });
  return (await res.json()) as { id: string; key: string; name: string; createdAt: string };
}

/** Registers a fresh user and returns a ready-to-use API key. */
export async function newApiKey(baseUrl: string) {
  const { cookie } = await registerUser(baseUrl);
  const created = await createApiKey(baseUrl, cookie);
  return { ...created, cookie };
}

export const bearer = (key: string): Record<string, string> => ({ Authorization: `Bearer ${key}` });

export function postJson(url: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/** Usage events are written after the response finishes, so poll briefly. */
export async function waitForUsageEvent(requestId: string) {
  for (let i = 0; i < 40; i++) {
    const [row] = await db.select().from(usageEvents).where(eq(usageEvents.requestId, requestId));
    if (row) return row;
    await Bun.sleep(25);
  }
  return undefined;
}
