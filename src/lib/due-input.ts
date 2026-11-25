import { z } from "zod";
import { parseDueInput } from "@/lib/due-day";

/** A due date as a client sends it (the day, the day and the hour in company time, or a full instant): checked here, turned into an instant with the company's zone. */
export const dueTextSchema = z
  .string()
  .max(40)
  .refine((text) => parseDueInput(text, "UTC") !== null, "validation.invalid_date");
