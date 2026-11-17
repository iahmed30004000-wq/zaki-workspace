import { z } from "zod";

/** What the owner's card sends. The token is optional: absent or empty = keep the saved one. */
export const omsInputSchema = z.object({
  baseUrl: z.string().max(300),
  token: z.string().max(4000).optional(),
  tokenExpiresAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
