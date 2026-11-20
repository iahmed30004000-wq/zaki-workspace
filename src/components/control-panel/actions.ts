"use server";

import { revalidatePath } from "next/cache";
import { ForbiddenError, NotFoundError, UnauthorizedError, ValidationError } from "@/server/auth";
import { requireActor } from "@/server/policy/actor";
import { saveCompanySettings, type CompanySettingsView } from "@/server/services/control-panel";

/**
 * The one write of «إعدادات الشركة» (A2.1): the owner's landing page, pinned work tabs, menu order and time zone. A server action, because the settings have no JSON
 * door of their own and this package adds none: the action is nothing but `requireActor` + `saveCompanySettings`, which decides everything (the OWNER rank, the switch,
 * the strict check of every value, the row lock, the audit row). The answer is a view or a dictionary key, never an exception text.
 */
export type SaveCompanyResult = { ok: true; view: CompanySettingsView } | { ok: false; key: string };

export async function saveCompanySettingsAction(input: unknown): Promise<SaveCompanyResult> {
  try {
    const view = await saveCompanySettings(await requireActor(), input);
    // the menu and the landing page are read by the layout of every page: draw them again
    revalidatePath("/", "layout");
    return { ok: true, view };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, key: err.issues[0]?.message ?? "common.error" };
    if (err instanceof ForbiddenError || err instanceof NotFoundError || err instanceof UnauthorizedError) return { ok: false, key: err.message };
    throw err;
  }
}
