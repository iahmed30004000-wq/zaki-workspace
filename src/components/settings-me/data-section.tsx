"use client";

import { useEffect, useState } from "react";
import { Segmented } from "@/components/ui/segmented";
import { SwitchRow } from "@/components/members/switch-row";
import { useI18n } from "@/lib/i18n";
import { DEFAULT_AUTO_DOWNLOAD, IMAGE_QUALITIES, MEDIA_KINDS, autoDownloadOn, patchDevicePrefs, readDevicePrefs, type Connection, type DevicePrefs, type ImageQuality, type MediaKind } from "@/lib/device-prefs";
import { Group, Scope, WarnFix } from "@/components/settings-me/parts";
import { WipeButton } from "@/components/settings-me/privacy-section";

/**
 * C4.1 — «البيانات والتخزين». Everything here is a choice of THIS device (`zk-device-prefs`): a phone on mobile data and a laptop on the office wifi want
 * different things. The quality of the pictures a person sends is read by the composer when a picture is chosen (1600 px, or 3200 px for «عالية»). The wipe of the
 * device's copy of the messages is C1.5's one function. The automatic download is stored and shown with its ⚠️ and 🔧: the chat's picture, video and file
 * parts do not ask for it yet, so nothing on screen changes when it is switched.
 */

/** How much of the origin's storage is used, in the words of a person (`navigator.storage.estimate`; null when the browser does not say). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ك.ب`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} م.ب`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} غ.ب`;
}

function StorageUse() {
  const { t } = useI18n();
  const [use, setUse] = useState<{ used: number; quota: number } | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const estimate = typeof navigator !== "undefined" ? navigator.storage?.estimate : undefined;
    if (!estimate) {
      setUse(null);
      return;
    }
    void navigator.storage.estimate().then(
      (e) => alive && setUse(typeof e.usage === "number" && typeof e.quota === "number" ? { used: e.usage, quota: e.quota } : null),
      () => alive && setUse(null),
    );
    return () => {
      alive = false;
    };
  }, []);
  if (use === undefined) return <p className="text-sm text-fg-muted">{t("settingsMe.loading")}</p>;
  if (use === null) return <p className="text-sm text-fg-muted">{t("settingsMe.d.storage.unknown")}</p>;
  return (
    <p data-storage-use className="text-sm text-fg">
      {t("settingsMe.d.storage.of", { used: formatBytes(use.used), quota: formatBytes(use.quota) })}
    </p>
  );
}

export function DataSection() {
  const { t } = useI18n();
  const [device, setDevice] = useState<DevicePrefs>({});
  useEffect(() => setDevice(readDevicePrefs()), []);
  const quality: ImageQuality = device.imageQuality ?? "normal";

  function setAuto(connection: Connection, kind: MediaKind, on: boolean) {
    const auto = { ...(device.autoDownload ?? {}) };
    auto[connection] = { ...(auto[connection] ?? {}), [kind]: on };
    // a value equal to the default is not kept
    for (const k of MEDIA_KINDS) {
      if (auto[connection]?.[k] === DEFAULT_AUTO_DOWNLOAD[connection][k]) delete auto[connection]![k];
    }
    if (Object.keys(auto[connection] ?? {}).length === 0) delete auto[connection];
    setDevice(patchDevicePrefs({ autoDownload: Object.keys(auto).length === 0 ? undefined : auto }));
  }

  return (
    <div data-section-body="data">
      <Group title={t("settingsMe.d.quality")} hint={t("settingsMe.d.quality.hint")} id="d-quality">
        <Segmented<ImageQuality>
          value={quality}
          label={t("settingsMe.d.quality")}
          options={IMAGE_QUALITIES.map((key) => ({ value: key, label: t(`settingsMe.d.quality.${key}`) }))}
          onChange={(next) => setDevice(patchDevicePrefs({ imageQuality: next === "normal" ? undefined : next }))}
        />
        <Scope device />
      </Group>

      <Group title={t("settingsMe.d.auto")} hint={t("settingsMe.d.auto.hint")} id="d-auto">
        {(["wifi", "mobile"] as const).map((connection) => (
          <div key={connection} data-auto-download={connection} className="mb-2">
            <h3 className="mb-1 text-sm font-medium text-fg">{t(`settingsMe.d.auto.${connection}`)}</h3>
            {MEDIA_KINDS.map((kind) => (
              <SwitchRow key={kind} checked={autoDownloadOn(device, connection, kind)} onChange={(on) => setAuto(connection, kind, on)} title={t(`settingsMe.d.auto.${kind}`)} />
            ))}
          </div>
        ))}
        <WarnFix warn={t("settingsMe.d.auto.warn")} fix={t("settingsMe.d.auto.fix")} />
        <Scope device />
      </Group>

      <Group title={t("settingsMe.d.storage")} id="d-storage">
        <StorageUse />
      </Group>

      <Group title={t("settingsMe.p.wipe")} hint={t("settingsMe.p.wipe.hint")} id="d-wipe">
        <WipeButton />
      </Group>
    </div>
  );
}
