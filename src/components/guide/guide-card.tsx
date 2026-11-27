"use client";

import { useEffect, useState } from "react";
import { Compass } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { browserStore, dismissHint, isHintDismissed, isTourSeen } from "@/lib/guide/storage";
import { startTour } from "./tour-runner";

/** The hint id «بعدين» is remembered under (this device). */
export const GUIDE_CARD_HINT = "guide-card";

/**
 * «أهلين! أنا ذكي» — the guide's welcome on «اليوم» («نجمة وطريق»): «يلا» starts the real tour of the frame
 * (the `shell` tour: the places, the search, the bell, «جديد», the avatar), «بعدين» puts the card away on this
 * device. It is not shown once the tour was taken or the card was put away; what this device remembers is read
 * after the page has loaded, so the server and the first paint agree (nothing until the device was asked).
 *
 * `View` is the card alone, so every state can be rendered and tested.
 */
export function GuideCardView({ onStart, onLater }: { onStart: () => void; onLater: () => void }) {
  const { t } = useI18n();
  return (
    <section aria-labelledby="guide-card-title" className="rounded-card border border-dashed border-accent-2 bg-surface-1 p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-accent-2/15 text-accent-2">
          <Compass className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="guide-card-title" className="text-base font-semibold text-fg">
            {t("guide.card.title")}
          </h2>
          <p className="mt-1 text-sm leading-6 text-fg-muted">{t("guide.card.body")}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onStart}
          className="inline-flex min-h-11 items-center justify-center rounded-lg bg-accent px-5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
        >
          {t("guide.card.start")}
        </button>
        <button
          type="button"
          onClick={onLater}
          className="inline-flex min-h-11 items-center justify-center rounded-lg border border-border px-4 text-sm font-medium text-fg transition-colors hover:bg-surface-2"
        >
          {t("guide.card.later")}
        </button>
      </div>
    </section>
  );
}

export function GuideCard() {
  const { t } = useI18n();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const store = browserStore();
    setShown(!isTourSeen(store, "shell") && !isHintDismissed(store, GUIDE_CARD_HINT));
  }, []);

  if (!shown) return null;
  return (
    <GuideCardView
      onStart={() => {
        setShown(false);
        void startTour("shell", t);
      }}
      onLater={() => {
        dismissHint(browserStore(), GUIDE_CARD_HINT);
        setShown(false);
      }}
    />
  );
}
