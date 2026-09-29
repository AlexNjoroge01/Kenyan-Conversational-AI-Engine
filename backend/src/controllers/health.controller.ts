import type { RequestHandler } from "express";
import { SERVICE } from "../config/constants";
import { env } from "../config/env";
import { checkDatabase } from "../db/client";
import type { Services } from "../services/container";

type Status = "ok" | "unavailable";

export function createHealthController(services: Services) {
  return {
    /** Service banner; also what the hosting platform's health probe hits. */
    root: ((_req, res) => {
      res.json({ name: SERVICE.name, version: SERVICE.version, docs: "/docs", openapi: "/openapi.json" });
    }) as RequestHandler,

    health: ((_req, res) => {
      res.json({ status: "ok" });
    }) as RequestHandler,

    /**
     * Reachability of the database and each active model provider (hosted API or GPU worker).
     * Provider names and URLs are deliberately not included.
     */
    ready: (async (_req, res) => {
      const [database, stt, slm, tts] = await Promise.all([
        checkDatabase(),
        services.stt.isHealthy(),
        services.slm.isHealthy(),
        services.tts.isHealthy(),
      ]);
      const toStatus = (ok: boolean): Status => (ok ? "ok" : "unavailable");
      const dependencies = { database: toStatus(database), stt: toStatus(stt), slm: toStatus(slm), tts: toStatus(tts) };
      const ready = env.readinessRequired.every((d) => dependencies[d] === "ok");
      res.status(ready ? 200 : 503).json({ status: ready ? "ready" : "not_ready", dependencies });
    }) as RequestHandler,
  };
}
