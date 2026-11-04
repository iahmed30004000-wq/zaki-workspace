"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import { fmtDateTime } from "@/lib/format";

interface Device {
  id: string;
  name: string;
  lastSeenAt: string | null;
}

type Phase = "idle" | "pairing" | "done" | "failed";

/** The key goes to the app as an intent addressed to its package, so no other app on the phone can catch it. */
function pairingLink(token: string): string {
  return `intent://pair?token=${encodeURIComponent(token)}#Intent;scheme=zaki;package=io.zakiai.workspace;end`;
}

/** «Pixel 7» out of "…; Android 14; Pixel 7) …": the name the person will recognise in the list ("Android" when the browser hides it). */
function phoneName(): string {
  const m = /Android[^;]*;\s*([^)]+)\)/.exec(navigator.userAgent);
  const name = (m?.[1] ?? "").replace(/\s*Build\/.*$/, "").trim();
  return name && name !== "K" ? name.slice(0, 60) : "Android";
}

/**
 * «ربط التطبيق»: pairs this phone with the Android app. The site asks the server for a key and hands it to the app through the link
 * `zaki://pair` (the app is the one that opens it); nothing else keeps the key. The app opens this page itself with `?app=1` when it has
 * no key yet, and the pairing then happens by itself.
 */
export function AppLink({ auto }: { auto: boolean }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [link, setLink] = useState<string | null>(null);
  const started = useRef(false);

  const load = useCallback(async () => {
    const res = await fetch("/api/me/app-devices", { cache: "no-store" });
    if (res.ok) setDevices(((await res.json()) as { devices: Device[] }).devices);
  }, []);

  const pair = useCallback(async () => {
    setPhase("pairing");
    try {
      const res = await fetch("/api/me/app-devices", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: phoneName() }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { token } = (await res.json()) as { token: string };
      setPhase("done");
      const link = pairingLink(token);
      setLink(link);
      window.location.href = link;
      void load();
    } catch {
      setPhase("failed");
    }
  }, [load]);

  useEffect(() => {
    void load();
    if (auto && !started.current) {
      started.current = true;
      void pair();
    }
  }, [auto, load, pair]);

  async function remove(id: string) {
    await fetch(`/api/me/app-devices/${id}`, { method: "DELETE" });
    await load();
  }

  return (
    <div className="space-y-5">
      <p className="text-sm leading-7 text-fg-muted">{ct("appLink.intro")}</p>
      <div className="space-y-2">
        <Button type="button" disabled={phase === "pairing"} onClick={() => void pair()}>
          {phase === "pairing" ? ct("appLink.pairing") : ct("appLink.pair")}
        </Button>
        {phase === "done" ? (
          <p role="status" className="text-sm text-fg">
            {ct("appLink.done")} <span className="text-fg-muted">{ct("appLink.no_app")}</span>
          </p>
        ) : null}
        {phase === "done" && link ? (
          <a href={link} className="inline-flex min-h-11 items-center rounded-lg border border-muted px-4 text-sm text-fg hover:bg-surface-2">
            {ct("appLink.open_app")}
          </a>
        ) : null}
        {phase === "failed" ? (
          <p role="alert" className="text-sm text-danger">
            {ct("appLink.failed")}
          </p>
        ) : null}
      </div>
      <section aria-labelledby="app-devices" className="space-y-2">
        <h2 id="app-devices" className="text-base font-semibold text-fg">
          {ct("appLink.devices")}
        </h2>
        {devices && devices.length === 0 ? <p className="text-sm text-fg-muted">{ct("appLink.none")}</p> : null}
        <ul className="space-y-2">
          {(devices ?? []).map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-xl border border-muted bg-surface p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-fg">{d.name}</p>
                <p className="text-xs text-fg-muted">
                  {d.lastSeenAt ? ct("appLink.last_seen", { when: fmtDateTime(d.lastSeenAt) }) : ct("appLink.never")}
                </p>
              </div>
              <Button type="button" size="sm" variant="ghost" onClick={() => void remove(d.id)}>
                {ct("appLink.remove")}
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
