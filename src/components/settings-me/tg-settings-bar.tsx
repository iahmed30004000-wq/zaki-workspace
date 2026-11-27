"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

/**
 * «تيليجرام على التلفون»: the settings' own bar. It is clear while the big picture is on screen; once that has scrolled away it comes in, blurred, with the
 * page's title. A line under the picture's height watches for that, so nothing listens to every scroll.
 */
export function TgSettingsBar() {
  const { t } = useI18n();
  const mark = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = mark.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const watch = new IntersectionObserver(([entry]) => setShown(entry ? !entry.isIntersecting : false));
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  return (
    <>
      <div data-tg-settings-bar="" aria-hidden={shown ? undefined : true} {...(shown ? { "data-shown": "" } : {})} className="border-b border-border text-base font-semibold text-fg md:hidden">
        {t("settingsMe.tg.title")}
      </div>
      <span ref={mark} aria-hidden="true" className="pointer-events-none absolute top-16 block h-px w-px md:hidden" />
    </>
  );
}
