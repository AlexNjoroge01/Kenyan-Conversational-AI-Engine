import { z } from "zod";

export const createApiKeySchema = z.object({
  body: z.object({
    name: z.string().trim().min(1, "Name is required.").max(100),
  }),
});

export const revokeApiKeySchema = z.object({
  params: z.object({ id: z.uuid("Invalid API key id.") }),
});
