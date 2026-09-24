import type { RequestHandler } from "express";
import { apiKeyService } from "../services/api-key.service";
import { sendJson } from "../utils/response";

export const apiKeyController = {
  create: (async (req, res) => {
    sendJson(res, await apiKeyService.create(req.user!.id, req.body.name), 201);
  }) as RequestHandler,

  list: (async (req, res) => {
    sendJson(res, await apiKeyService.list(req.user!.id));
  }) as RequestHandler,

  revoke: (async (req, res) => {
    await apiKeyService.revoke(req.user!.id, req.params.id as string);
    res.status(204).end();
  }) as RequestHandler,
};
