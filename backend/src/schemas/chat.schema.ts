import { z } from "zod";

export const chatSchema = z.object({
  body: z.object({
    model: z.string().min(1),
    messages: z
      .array(
        z.object({
          role: z.enum(["system", "user", "assistant"]),
          content: z.string().min(1, "Message content must not be empty."),
        }),
      )
      .min(1, "At least one message is required.")
      .max(100),
    stream: z.boolean().default(false),
    temperature: z.number().min(0).max(2).optional(),
    max_tokens: z.number().int().positive().max(4096).optional(),
    response_format: z.object({ type: z.enum(["text", "json_object"]) }).optional(),
  }),
});

export type ChatRequest = z.infer<typeof chatSchema>["body"];
