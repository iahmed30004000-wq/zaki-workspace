import { pageActor } from "@/app/(app)/_access";
import { getServerT } from "@/lib/i18n/server";

/**
 * C4.1 — «إعداداتي», the index. On the phone the frame draws only the list of sections (this page is hidden there); on the computer the list is the start column and
 * this is the empty end column: a line that says what to do.
 */
export default async function SettingsMePage() {
  const { t } = getServerT();
  await pageActor();
  return (
    <div className="grid min-h-48 place-items-center px-3 py-10 text-sm text-fg-muted">
      <p>{t("settingsMe.pick")}</p>
    </div>
  );
}

export const dynamic = "force-dynamic";
