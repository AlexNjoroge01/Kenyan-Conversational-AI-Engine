import { z } from "zod";

export const transcriptionSchema = z.object({
  body: z.object({
    model: z.string().min(1),
    language: z
      .string()
      .regex(/^[a-z]{2,3}$/, "Language must be an ISO 639 code such as 'en' or 'sw'.")
      .optional(),
  }),
});

export type TranscriptionRequest = z.infer<typeof transcriptionSchema>["body"];
