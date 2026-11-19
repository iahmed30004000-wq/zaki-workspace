"use client";

import React from "react";
import type { AttachmentDto, MessageKind } from "@/server/chat/dto";
import { ImageText } from "@/components/image-text";
import { VoicePlayer } from "@/components/chat/message/voice-player";
import { VoiceTranscript } from "@/components/chat/message/voice-transcript";
import { ct } from "@/lib/chat/text";
import { VOICE_ROW_PX, imageBox } from "@/lib/chat/viewport/sizes";

const OCR_MIMES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Only our own attachment address is ever drawn (a message cannot point the page at a remote file). */
const safeMediaUrl = (url: string) => (url.startsWith("/api/chat/attachments/") ? url : undefined);

/** The fixed box of a voice note: the row's height (`VOICE_ROW_PX`) less the bubble's padding and footer, so nothing moves when the player loads. */
const VOICE_BOX_PX = VOICE_ROW_PX - 32;

/**
 * The files of a message (C2 §5, built from `message-item.tsx`): a picture and a video RESERVE their box from the attachment's own size (`imageBox`: the
 * same function the virtual list's estimate uses, so the estimate and the drawing agree and nothing jumps when the file loads), a voice note has a fixed
 * height, any other file is a download line. The transcript and «اقرا النص» keep their switches.
 */
export function BubbleMedia({ attachments, kind, canTranscribe, canReadImages }: { attachments: AttachmentDto[]; kind: MessageKind; canTranscribe: boolean; canReadImages: boolean }) {
  return (
    <>
      {attachments.map((file) => {
        const url = safeMediaUrl(file.url);
        if (!url) {
          return (
            <span key={file.id} aria-disabled="true" className="block text-xs text-fg-muted">
              {file.name}
            </span>
          );
        }
        if (kind === "VOICE" && file.mime.startsWith("audio/")) {
          return (
            <div key={file.id} data-voice-box>
              <div className="flex items-center" style={{ height: VOICE_BOX_PX }}>
                <VoicePlayer src={url} peaks={file.peaks} durationMs={file.durationMs} />
              </div>
              {canTranscribe && <VoiceTranscript attachmentId={file.id} />}
            </div>
          );
        }
        const box = imageBox(file);
        const reserved = { width: box.width, maxWidth: "100%", aspectRatio: `${box.width} / ${box.height}` };
        return (
          <div key={file.id} className="my-1.5">
            {file.kind === "IMAGE" && file.mime.startsWith("image/") ? (
              <span data-image-box className="block overflow-hidden rounded-lg bg-surface-2" style={reserved}>
                {/* eslint-disable-next-line @next/next/no-img-element -- our own attachment address (checked above), already boxed from its own size: next/image would need a loader for a private route */}
                <img src={url} alt={file.name} loading="lazy" width={box.width} height={box.height} className="size-full object-cover" />
              </span>
            ) : null}
            <a href={url} download={file.name} className="mt-0.5 block text-xs underline">
              {ct("chatc.download", { name: file.name })}
            </a>
            {canReadImages && file.kind === "IMAGE" && OCR_MIMES.has(file.mime) && <ImageText endpoint={`/api/chat/attachments/${encodeURIComponent(file.id)}/text`} />}
            {file.kind === "VIDEO" && file.mime.startsWith("video/") && <video src={url} controls preload="metadata" className="mt-1 rounded-lg bg-surface-2" style={reserved} />}
            {file.kind === "AUDIO" && file.mime.startsWith("audio/") && <audio src={url} controls preload="metadata" className="mt-1 w-full" />}
          </div>
        );
      })}
    </>
  );
}
