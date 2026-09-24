import { z } from "zod";

const email = z.string().trim().toLowerCase().pipe(z.email().max(320));

export const registerSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(8, "Password must be at least 8 characters.").max(72, "Password must be at most 72 characters."),
  }),
});

export const loginSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(1).max(72),
  }),
});
