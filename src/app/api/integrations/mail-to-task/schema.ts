import { z } from "zod";
import { MAIL_LIMITS } from "@/lib/mail-to-task";

/** What the owner's card sends (the same body for «احفظ» and «افحص الاتصال»). The password is optional: absent = keep the saved one. */
export const mailTaskInputSchema = z.object({
  host: z.string().max(MAIL_LIMITS.host),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().max(MAIL_LIMITS.field),
  password: z.string().max(MAIL_LIMITS.password).optional(),
  folder: z.string().max(120),
  workspaceId: z.string().min(1).max(64),
  projectId: z.string().min(1).max(64),
  assigneeId: z.string().min(1).max(64).nullable(),
  allowList: z.array(z.string().max(MAIL_LIMITS.field)).max(200),
  markSeen: z.boolean(),
});
