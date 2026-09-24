import { z } from "zod";
import { env } from "../config/env";
import { TTS_FORMATS, TTS_VOICES } from "../config/constants";

export const speechSchema = z.object({
  body: z.object({
    model: z.string().min(1),
    input: z
      .string()
      .refine((v) => v.trim().length > 0, "Input must not be empty.")
      .refine((v) => v.length <= env.TTS_MAX_INPUT_CHARACTERS, `Input must be at most ${env.TTS_MAX_INPUT_CHARACTERS} characters.`),
    voice: z.enum(TTS_VOICES).default("default"),
    response_format: z.enum(TTS_FORMATS).default("mp3"),
    stream: z.boolean().default(false),
  }),
});

export type SpeechRequest = z.infer<typeof speechSchema>["body"];
