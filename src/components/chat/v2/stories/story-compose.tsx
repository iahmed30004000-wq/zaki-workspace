"use client";

import React from "react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ct } from "@/lib/chat/text";
import { uploadWithProgress } from "@/lib/chat/upload-with-progress";
import { kindOfPick, pickProblem } from "@/lib/chat/v2/stories/model";
import { prepareStoryImage, videoDurationOf } from "@/lib/chat/v2/stories/prepare";
import { STORY_CAPTION_MAX } from "@/lib/chat/v2/stories/types";
import { AR } from "@/lib/i18n/dict";

/** The server's own line when it has one (`stories.*`, `chat.f.*`), else «ما انتشرت». */
const failText = (error: unknown): string => (error instanceof Error && AR[error.message] ? ct(error.message) : ct("tgstories.compose.failed"));

/**
 * The step between picking and posting: what was picked, a caption, who will see it, and «انشر». Nothing goes up before that press.
 * Mounted once per picked file (its owner keys it by the file), so nothing of one draft is left in the next.
 */
export function StoryCompose({ file, onClose, onPosted }: { file: File; onClose: () => void; onPosted: () => void }) {
  const kind = kindOfPick(file.type);
  const [url, setUrl] = React.useState<string | null>(null);
  React.useEffect(() => {
    const made = URL.createObjectURL(file);
    setUrl(made);
    return () => URL.revokeObjectURL(made);
  }, [file]);
  const [caption, setCaption] = React.useState("");
  const [durationMs, setDurationMs] = React.useState<number | undefined>(undefined);
  const [measuring, setMeasuring] = React.useState(kind === "VIDEO");
  const [busy, setBusy] = React.useState(false);
  const [percent, setPercent] = React.useState(0);
  const [error, setError] = React.useState("");
  React.useEffect(() => {
    if (kind !== "VIDEO" || !url) return;
    let live = true;
    void videoDurationOf(url).then((ms) => {
      if (!live) return;
      setDurationMs(ms);
      setMeasuring(false);
    });
    return () => {
      live = false;
    };
  }, [kind, url]);
  // a picture is judged by its size after it is drawn again (a camera's 20 MB photo shrinks far under the ceiling)
  const problem = kind === "IMAGE" ? null : pickProblem(file, durationMs);

  const publish = async () => {
    if (busy || measuring || problem || !kind) return;
    setBusy(true);
    setError("");
    setPercent(0);
    try {
      let upload = file;
      if (kind === "IMAGE") {
        upload = await prepareStoryImage(file).catch(() => {
          throw new Error("stories.unsupported");
        });
        const after = pickProblem(upload, undefined);
        if (after) throw new Error(after);
      }
      const form = new FormData();
      form.append("file", upload);
      form.append("caption", caption.trim());
      if (durationMs !== undefined) form.append("durationMs", String(durationMs));
      await uploadWithProgress("/api/stories", form, setPercent);
      onPosted();
    } catch (e) {
      setError(failText(e));
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open || busy ? undefined : onClose())}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{ct("tgstories.compose.title")}</DialogTitle>
          <DialogDescription>{ct("tgstories.compose.who")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div data-story-preview="" className="grid max-h-[45dvh] min-h-40 place-items-center overflow-hidden rounded-xl bg-surface-2">
            {url && kind === "VIDEO" ? (
              <video src={url} controls playsInline preload="metadata" className="max-h-[45dvh] w-full" />
            ) : url && kind === "IMAGE" ? (
              // eslint-disable-next-line @next/next/no-img-element -- the picked file itself, before it is sent anywhere
              <img src={url} alt={ct("tgstories.compose.preview")} className="max-h-[45dvh] w-full object-contain" />
            ) : null}
          </div>
          <label htmlFor="story-caption" className="sr-only">
            {ct("tgstories.compose.caption")}
          </label>
          <textarea
            id="story-caption"
            rows={2}
            maxLength={STORY_CAPTION_MAX}
            value={caption}
            onChange={(event) => setCaption(event.currentTarget.value)}
            placeholder={ct("tgstories.compose.caption")}
            className="mt-3 w-full resize-none rounded-lg border border-muted bg-surface px-3 py-2 text-base text-fg placeholder:text-fg-muted"
          />
          {problem || error || !kind ? (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error || ct(problem ?? "stories.unsupported")}
            </p>
          ) : null}
          {busy ? (
            <p role="status" className="mt-2 text-sm text-fg-muted">
              {ct("tgstories.compose.uploading", { n: percent })}
            </p>
          ) : null}
          <div className="mt-3 flex gap-2">
            <Button type="button" data-story-publish="" onClick={() => void publish()} disabled={busy || measuring || problem !== null || !kind} className="flex-1">
              {ct("tgstories.compose.publish")}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
              {ct("tgstories.cancel")}
            </Button>
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
