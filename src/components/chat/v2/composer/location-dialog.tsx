"use client";

import React from "react";
import { LoaderCircle, MapPin, Send } from "lucide-react";
import type { MessageDto } from "@/server/chat/dto";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { messageClientId } from "@/lib/chat/conversation/client";
import { errorKeyOf } from "@/lib/chat/poll-client";
import { playChatSound } from "@/lib/chat/sounds";
import { accuracyWords, askPosition, coordsText, WEAK_ACCURACY_M, type LocateFailure, type LocateResult, type SharedPlace } from "@/lib/chat/location";
import { ct } from "@/lib/chat/text";

export type LocationState = { step: "locating" } | { step: "found"; place: SharedPlace } | { step: "failed"; reason: LocateFailure };

/**
 * «إرسال الموقع» — what the person sees before anything is sent: that the place is being read, then the point and HOW ACCURATE it is, with the warning and its fix, and only
 * then «ابعت موقعي». A refusal or a failure says what to do about it. There is no map here: a map would be a request to somebody else.
 */
export function LocationView({ state, busy, error, onSend, onAgain, onCancel }: { state: LocationState; busy: boolean; error: string; onSend: () => void; onAgain: () => void; onCancel: () => void }) {
  const accuracy = state.step === "found" ? accuracyWords(state.place.accuracy) : null;
  return (
    <>
      <DialogBody>
        <div data-location-step={state.step} className="flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="grid size-14 place-items-center rounded-full bg-accent/10 text-accent">
            {state.step === "locating" ? <LoaderCircle className="size-7 motion-safe:animate-spin" /> : <MapPin className="size-7" />}
          </span>
          {state.step === "locating" ? (
            <p role="status" className="text-sm text-fg-muted">
              {ct("chatloc.locating")}
            </p>
          ) : null}
          {state.step === "found" && accuracy ? (
            <>
              <p className="text-base font-semibold text-fg">{ct("chatloc.found")}</p>
              <bdi dir="ltr" data-location-coords="" className="text-sm text-fg-muted">
                {coordsText(state.place)}
              </bdi>
              <p data-location-accuracy="" role="status" className="text-sm font-medium text-fg">
                {ct(accuracy.key, { n: accuracy.n })}
              </p>
              {state.place.accuracy > WEAK_ACCURACY_M ? (
                <div data-location-weak="" className="w-full rounded-lg border border-warn/40 bg-warn/10 p-2 text-start text-xs">
                  <p className="text-warn">{ct("chatloc.weak_warn")}</p>
                  <p className="text-fg">{ct("chatloc.weak_fix")}</p>
                </div>
              ) : null}
              <div className="w-full rounded-lg bg-surface-2 p-2 text-start text-xs">
                <p className="text-warn">{ct("chatloc.warn")}</p>
                <p className="text-fg-muted">{ct("chatloc.fix")}</p>
              </div>
            </>
          ) : null}
          {state.step === "failed" ? (
            <div role="alert" data-location-failed={state.reason} className="w-full rounded-lg border border-warn/40 bg-warn/10 p-3 text-start text-sm">
              <p className="font-medium text-warn">{ct(`chatloc.err.${state.reason}`)}</p>
              <p className="text-fg">{ct(`chatloc.fix.${state.reason}`)}</p>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          {ct("chatloc.cancel")}
        </Button>
        {state.step === "locating" ? null : (
          <Button type="button" variant="ghost" data-location-again="" disabled={busy} onClick={onAgain}>
            {ct("chatloc.again")}
          </Button>
        )}
        {state.step === "found" ? (
          <Button type="button" data-location-send="" disabled={busy} onClick={onSend} className="gap-2">
            {busy ? <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" /> : <Send aria-hidden="true" className="size-4" />}
            {ct(busy ? "chatloc.sending" : "chatloc.send")}
          </Button>
        ) : null}
      </DialogFooter>
    </>
  );
}

/**
 * The dialog «الموقع» opens. It is mounted only by the person's tap on «الموقع», and that is the one moment the browser is asked (`askPosition`: one reading, never a watch);
 * «حدّد من جديد» asks once more. Closing it drops the reading: nothing is kept.
 */
export function LocationDialog({
  open,
  conversationId,
  onClose,
  onSent,
  locate = askPosition,
  portal = true,
}: {
  open: boolean;
  conversationId: string;
  onClose: () => void;
  onSent: (message: MessageDto) => void;
  /** how the place is read (a test hands in its own) */
  locate?: () => Promise<LocateResult>;
  portal?: boolean;
}) {
  const [state, setState] = React.useState<LocationState>({ step: "locating" });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  // one id per reading: a retry after a lost answer never sends the place twice, and a new reading is a new message
  const clientId = React.useRef(messageClientId());
  // an answer that arrives after a newer question, or after the dialog closed, is nobody's
  const asked = React.useRef(0);
  const read = React.useCallback(() => {
    const mine = ++asked.current;
    setState({ step: "locating" });
    setError("");
    void locate().then((result) => {
      if (asked.current !== mine) return;
      clientId.current = messageClientId();
      setState(result.ok ? { step: "found", place: result.place } : { step: "failed", reason: result.reason });
    });
  }, [locate]);
  React.useEffect(() => {
    if (!open) return;
    read();
    return () => {
      asked.current += 1;
    };
  }, [open, read]);

  async function send() {
    if (busy || state.step !== "found") return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/chat/conversations/${encodeURIComponent(conversationId)}/location`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...state.place, clientId: clientId.current }),
      });
      if (!response.ok) {
        // the server's own sentence where it has one for the chat, else the dialog's
        setError(ct(errorKeyOf(await response.json().catch(() => null)) ?? "chatloc.send_failed"));
        setBusy(false);
        return;
      }
      playChatSound("sent");
      onSent((await response.json()) as MessageDto);
    } catch {
      setError(ct("chatloc.send_failed"));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent size="sm" portal={portal} aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{ct("chatloc.title")}</DialogTitle>
        </DialogHeader>
        <LocationView state={state} busy={busy} error={error} onSend={() => void send()} onAgain={read} onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}
