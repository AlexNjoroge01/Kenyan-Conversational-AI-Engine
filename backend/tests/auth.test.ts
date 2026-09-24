import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PASSWORD, cookieFrom, randomEmail, registerUser, startServer, type TestServer } from "./helpers";

let server: TestServer;
beforeAll(async () => {
  server = await startServer();
});
afterAll(() => server.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${server.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

describe("registration", () => {
  test("creates a user, returns a safe representation and sets an HTTP-only cookie", async () => {
    const email = randomEmail();
    const res = await post("/auth/register", { email, password: PASSWORD });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.email).toBe(email);
    expect(body.id).toBeString();
    expect(body.password).toBeUndefined();
    expect(body.passwordHash).toBeUndefined();

    const setCookie = res.headers.getSetCookie()[0]!;
    expect(setCookie).toContain("auth_token=");
    expect(setCookie).toContain("HttpOnly");
  });

  test("rejects a duplicate email", async () => {
    const { email } = await registerUser(server.url);
    const res = await post("/auth/register", { email, password: PASSWORD });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("EMAIL_ALREADY_EXISTS");
  });

  test("treats emails case-insensitively", async () => {
    const { email } = await registerUser(server.url);
    const res = await post("/auth/register", { email: email.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(409);
  });

  test("validates email and password", async () => {
    const res = await post("/auth/register", { email: "not-an-email", password: "short" });
    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error.code).toBe("VALIDATION_ERROR");
    expect(error.requestId).toStartWith("req_");
    expect(error.details.map((d: { field: string }) => d.field).sort()).toEqual(["email", "password"]);
  });

  test("rejects malformed JSON", async () => {
    const res = await fetch(`${server.url}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_ERROR");
  });
});

describe("login", () => {
  test("succeeds with correct credentials", async () => {
    const { email } = await registerUser(server.url);
    const res = await post("/auth/login", { email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect((await res.json()).email).toBe(email);
    expect(res.headers.getSetCookie()[0]).toContain("HttpOnly");
  });

  test("rejects a wrong password", async () => {
    const { email } = await registerUser(server.url);
    const res = await post("/auth/login", { email, password: "wrong-password" });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });

  test("rejects an unknown email with the same error", async () => {
    const res = await post("/auth/login", { email: randomEmail(), password: PASSWORD });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("INVALID_CREDENTIALS");
  });
});

describe("session", () => {
  test("GET /auth/me returns the current user when authenticated", async () => {
    const { email, cookie } = await registerUser(server.url);
    const res = await fetch(`${server.url}/auth/me`, { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.email).toBe(email);
    expect(body.passwordHash).toBeUndefined();
  });

  test("GET /auth/me rejects requests without a cookie", async () => {
    const res = await fetch(`${server.url}/auth/me`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  test("GET /auth/me rejects a tampered cookie", async () => {
    const res = await fetch(`${server.url}/auth/me`, { headers: { Cookie: "auth_token=abc.def.ghi" } });
    expect(res.status).toBe(401);
  });

  test("logout clears the cookie", async () => {
    const { cookie } = await registerUser(server.url);
    const res = await post("/auth/logout", {}, { Cookie: cookie });
    expect(res.status).toBe(204);
    const cleared = res.headers.getSetCookie()[0]!;
    expect(cleared).toContain("auth_token=;");
    expect(cookieFrom(res)).toBe("auth_token=");
  });
});
