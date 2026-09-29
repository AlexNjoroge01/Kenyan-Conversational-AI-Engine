import type { RequestHandler } from "express";
import type { SttService } from "../services/stt/stt.service";
import { sendJson } from "../utils/response";

export function createTranscriptionController(stt: SttService) {
  return {
    createTranscription: (async (req, res) => {
      res.locals.usage = { model: req.body.model };
      const file = req.file!;
      const result = await stt.transcribe(req.body, {
        buffer: file.buffer,
        originalname: file.originalname,
        mimetype: file.mimetype,
      });
      res.locals.usage = {
        ...res.locals.usage,
        audioDurationSeconds: result.durationSeconds,
        providerLatencyMs: result.latencyMs,
      };
      sendJson(res, { text: result.text, model: result.model, language: result.language });
    }) as RequestHandler,
  };
}
