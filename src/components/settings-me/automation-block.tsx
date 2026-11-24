"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPatch } from "@/lib/api-client";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { Group, WarnFix } from "@/components/settings-me/parts";
import { AWAY_TEXT_MAX, DEFAULT_WORK_TZ, type ChatAutomation, type WorkHours } from "@/lib/chat/work-hours";

/**
 * «ساعات الدوام» and «أتمتة المحادثة» on the account screen (docs/contracts/telegram-look.md): the days and hours I work, and an away line a colleague sees when they write to me in a
 * private chat outside them. Mine alone (`/api/me/automation`); the block is drawn only while the company's switch `chatAutomation` is on (the page decides).
 */
interface Mine {
  workHours: WorkHours | null;
  chatAutomation: ChatAutomation;
}
const KEY = ["me-automation"] as const;
const DAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export function AutomationBlock() {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const query = useQuery({ queryKey: KEY, queryFn: () => apiGet<Mine>("/api/me/automation"), staleTime: 30_000, retry: false });
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("17:00");
  const [hasHours, setHasHours] = useState(false);
  const [on, setOn] = useState(false);
  const [text, setText] = useState("");

  // the saved values fill the form once they arrive (and again after a save)
  useEffect(() => {
    const mine = query.data;
    if (!mine) return;
    setHasHours(mine.workHours !== null);
    if (mine.workHours) {
      setDays(mine.workHours.days);
      setFrom(mine.workHours.from);
      setTo(mine.workHours.to);
    }
    setOn(mine.chatAutomation.on);
    setText(mine.chatAutomation.text);
  }, [query.data]);

  const save = useMutation({
    mutationFn: (body: { workHours: WorkHours | null; chatAutomation: ChatAutomation }) => apiPatch<Mine>("/api/me/automation", body),
    onSuccess: (next) => {
      qc.setQueryData(KEY, next);
      toast(t("workhours.saved"), "success");
    },
    onError: () => toast(t("workhours.failed"), "error"),
  });

  if (query.isError || !query.data) return null;
  const hours: WorkHours | null = hasHours ? { days: [...days].sort(), from, to, tz: query.data.workHours?.tz ?? DEFAULT_WORK_TZ } : null;
  const lacksHours = on && hours === null;

  return (
    <Group title={t("workhours.title")} hint={t("workhours.hint")}>
      <form
        data-automation=""
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (lacksHours || save.isPending) return;
          save.mutate({ workHours: hours, chatAutomation: { on, text: text.trim() } });
        }}
      >
        <div role="group" aria-label={t("workhours.days")} className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => {
            const picked = hasHours && days.includes(day);
            return (
              <button
                key={day}
                type="button"
                data-automation-day={day}
                aria-pressed={picked}
                onClick={() => {
                  setHasHours(true);
                  setDays((cur) => (cur.includes(day) ? (cur.length > 1 ? cur.filter((d) => d !== day) : cur) : [...cur, day]));
                }}
                className={cn("min-h-10 rounded-full px-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent", picked ? "bg-accent text-accent-fg" : "bg-surface-2 text-fg")}
              >
                {t(`workhours.day_${day}`)}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-fg">
            {t("workhours.from")}
            <Input type="time" dir="ltr" value={from} className="w-32" onChange={(e) => { setHasHours(true); setFrom(e.target.value); }} />
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            {t("workhours.to")}
            <Input type="time" dir="ltr" value={to} className="w-32" onChange={(e) => { setHasHours(true); setTo(e.target.value); }} />
          </label>
          {hasHours ? (
            <Button type="button" variant="ghost" data-automation-clear="" onClick={() => { setHasHours(false); setOn(false); }}>
              {t("workhours.clear_hours")}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-fg">{t("workhours.on")}</span>
          <Switch checked={on} onChange={setOn} label={t("workhours.on")} />
        </div>
        <label className="block space-y-1 text-sm font-medium text-fg">
          {t("workhours.text")}
          <Textarea value={text} maxLength={AWAY_TEXT_MAX} rows={3} placeholder={t("workhours.text_placeholder")} onChange={(e) => setText(e.target.value)} />
        </label>
        {lacksHours ? <p role="alert" className="text-sm text-danger">{t("workhours.needs_hours")}</p> : null}
        <WarnFix warn={t("workhours.warn")} fix={t("workhours.fix")} />
        <div className="flex justify-end">
          <Button type="submit" disabled={lacksHours || save.isPending || (on && text.trim() === "")}>
            {t("workhours.save")}
          </Button>
        </div>
      </form>
    </Group>
  );
}
