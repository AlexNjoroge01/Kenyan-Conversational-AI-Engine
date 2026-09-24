import type { RequestHandler } from "express";
import type { SlmService } from "../services/slm/slm.service";
import { sendJson } from "../utils/response";

export function createChatController(slm: SlmService) {
  return {
    createCompletion: (async (req, res) => {
      const inputCharacters = (req.body.messages as { content: string }[]).reduce((n, m) => n + m.content.length, 0);
      res.locals.usage = { model: req.body.model, inputCharacters };
      const { latencyMs, ...completion } = await slm.complete(req.body);
      res.locals.usage = { ...res.locals.usage, providerLatencyMs: latencyMs };
      sendJson(res, completion);
    }) as RequestHandler,
  };
}
