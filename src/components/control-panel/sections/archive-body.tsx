import { activeOrgCtx } from "@/server/services/integrations";
import { readArchiveFilterOptions } from "@/server/chat/archive";
import { getServerT } from "@/lib/i18n/server";
import { ArchiveClient } from "@/lib/chat/archive/archive-client";

/**
 * «الأرشيف والرقابة» — the owner's silent oversight list (`archive.view`; the caller checked it, and every route behind the screen checks it again). The body of /archive,
 * MOVED (A2.1): the page and the section of the control panel draw the same screen. `heading`: the page carries the h1, inside the panel this is an h2.
 * `titled` false (S3.3, «الإعدادات» is ONE door): the section already wears the name «الأرشيف» above, so the body draws its line and no second title.
 */
export async function ArchiveBody({ heading, titled = true }: { heading: "h1" | "h2"; titled?: boolean }) {
  const { t } = getServerT();
  const Title = heading;
  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <header>
        {titled ? <Title className="text-xl font-semibold tracking-tight">{t("archive.title")}</Title> : null}
        <p className={titled ? "mt-1 text-sm text-fg-muted" : "text-sm text-fg-muted"}>{t("archive.subtitle")}</p>
      </header>
      <ArchiveClient options={await readArchiveFilterOptions(await activeOrgCtx())} />
    </div>
  );
}
