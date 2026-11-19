"use client";

import React from "react";
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ct } from "@/lib/chat/text";
import { enterSends } from "@/lib/chat/conversation/client";

/** Object URLs for some files, given back when the files change or the dialog goes. */
function usePreviews(files: File[] | null): string[] {
  const [urls, setUrls] = React.useState<string[]>([]);
  React.useEffect(() => {
    const made = (files ?? []).map((file) => URL.createObjectURL(file));
    setUrls(made);
    return () => {
      for (const url of made) URL.revokeObjectURL(url);
    };
  }, [files]);
  return urls;
}

/**
 * C2.5 — a picture pasted into the box (Telegram's send-photo dialog): a preview, a caption, and «ابعتها كملف» to send the original bytes without
 * compression. «ابعت» goes through the same upload and send path as a picture picked from the menu; «إلغاء» leaves the box as it was.
 */
export function PasteSendDialog({ files, initialCaption, onSend, onCancel, portal = true }: { files: File[] | null; initialCaption: string; onSend: (caption: string, asFile: boolean) => void; onCancel: () => void; portal?: boolean }) {
  const [caption, setCaption] = React.useState(initialCaption);
  const [asFile, setAsFile] = React.useState(false);
  const open = files !== null && files.length > 0;
  React.useEffect(() => {
    if (open) {
      setCaption(initialCaption);
      setAsFile(false);
    }
    // the caption starts from what was typed when the paste happened, and is not reset while it is edited
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const previews = usePreviews(open ? files : null);
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onCancel())}>
      <DialogContent size="md" portal={portal} data-paste-dialog>
        <DialogHeader>
          <DialogTitle>{ct("chatui.composer.paste_title")}</DialogTitle>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <ul className="flex flex-wrap gap-2" aria-label={ct("chatc.attach")}>
            {(files ?? []).map((file, index) => (
              <li key={`${file.name}-${index}`} className="size-24 overflow-hidden rounded-lg border border-border bg-surface-2">
                {previews[index] ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a local blob: preview, nothing for next/image to optimise
                  <img src={previews[index]} alt={file.name} className="size-full object-cover" />
                ) : null}
              </li>
            ))}
          </ul>
          <label className="sr-only" htmlFor="chat-paste-caption">
            {ct("chatui.composer.paste_caption")}
          </label>
          <textarea
            id="chat-paste-caption"
            rows={2}
            value={caption}
            onChange={(event) => setCaption(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (enterSends({ key: event.key, shiftKey: event.shiftKey, isComposing: event.nativeEvent.isComposing })) {
                event.preventDefault();
                onSend(caption, asFile);
              }
            }}
            placeholder={ct("chatui.composer.paste_caption")}
            className="min-h-11 w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-base"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{ct("chatui.composer.paste_as_file")}</span>
            <Switch checked={asFile} onChange={setAsFile} label={ct("chatui.composer.paste_as_file")} />
          </div>
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" onClick={onCancel}>
            {ct("chatc.cancel")}
          </Button>
          <Button type="button" data-paste-send onClick={() => onSend(caption, asFile)}>
            {ct("chatui.composer.paste_send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
