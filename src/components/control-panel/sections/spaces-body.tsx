import { EmptyState } from "@/components/ui/card";
import { getServerT } from "@/lib/i18n/server";
import { currentSpace } from "@/server/services/current-space";
import { spacesOverview } from "@/server/services/spaces-overview";
import { archivedSpaces } from "@/server/services/space-manage";
import type { Actor } from "@/server/policy/actor";
import { UnplacedPanel } from "@/components/unplaced-panel";
import { ArchivedSpaces, SpacesBoard, type BoardCard } from "@/components/spaces-board";

/**
 * «كل المساحات» — the owner's and the admins' look over every space they can open: a card per space with what is open, late and waiting there, and the way in.
 * Entering a space (`/go`) opens its «اليوم»; nothing of its work is shown here. The cards are managed in place (drag to order, rename, archive, delete: `SpacesBoard`);
 * under them the archived spaces, and «أشيا قديمة بلا مساحة». ONE body: the page /spaces and the section «المساحات» of the control panel draw THIS (moved, not rebuilt: A2.1).
 * `settingsLinks` (S3.3, «الإعدادات» is ONE door): each card is a list entry with a gear to the space's own settings page, where its name, its people, its archive and its delete live, once.
 * The caller decided who may look (`mayOverview`). `heading`: the page carries the h1, inside the panel this is an h2.
 */
export async function SpacesBody({ actor, heading = "h1", settingsLinks = false }: { actor: Actor; heading?: "h1" | "h2"; settingsLinks?: boolean }) {
  const { t } = getServerT();
  const Title = heading;
  const [cards, here, archived] = await Promise.all([spacesOverview(actor), currentSpace(actor), archivedSpaces(actor)]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-4 md:px-6 md:py-6">
      <header>
        <Title className="text-xl font-semibold text-fg">{t("spaces.overview.title")}</Title>
        <p className="text-sm text-fg-muted">{t("spaces.overview.hint")}</p>
      </header>
      {cards.length === 0 ? (
        <EmptyState title={t("shell.spaces.empty")} hint={t("spaces.overview.empty_hint")} />
      ) : (
        <SpacesBoard cards={cards as BoardCard[]} hereId={here?.id ?? null} manage owner={actor.role === "OWNER"} settingsLinks={settingsLinks} />
      )}
      <ArchivedSpaces rows={archived} />
      <UnplacedPanel spaces={cards.map((c) => ({ id: c.id, name: c.name }))} />
    </div>
  );
}
