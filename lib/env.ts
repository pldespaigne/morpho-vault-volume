import { z } from "zod";

const envSchema = z.object({
  MORPHO_API_URL: z.url(),
});

export const env = envSchema.parse(process.env);
