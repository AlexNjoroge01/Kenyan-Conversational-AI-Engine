import type { RequestHandler } from "express";
import type { SpeechService } from "../services/speech.service";
import { sendAudio } from "../utils/response";

export function createSpeechController(speech: SpeechService) {
  return {
    createSpeech: (async (req, res) => {
      res.locals.usage = { model: req.body.model, inputCharacters: req.body.input.length };
      const result = await speech.createSpeech(req.body);
      res.locals.usage = {
        ...res.locals.usage,
        audioDurationSeconds: result.durationSeconds,
        providerLatencyMs: result.latencyMs,
      };
      sendAudio(res, result.audio, result.contentType, result.filename);
    }) as RequestHandler,
  };
}
