"use client";

import { PhoneCall } from "lucide-react";
import { ct } from "@/lib/chat/text";
import { GUIDE_CALL_EVENT } from "@/lib/site-guide/rules";

/**
 * «اتصل بالمساعد»: in the owner's OWN conversation with the assistant the header's call button rings the assistant instead of starting a
 * call with nobody. It asks the guide (src/components/site-guide/site-guide.tsx, mounted once in the shell) to open and start its voice call:
 * the browser's own speech recognition and voice, nothing on the server, nothing to pay.
 */
export function AssistantCallButton() {
  return (
    <button
      type="button"
      data-assistant-call
      onClick={() => window.dispatchEvent(new CustomEvent(GUIDE_CALL_EVENT))}
      aria-label={ct("assistantChat.call")}
      title={ct("assistantChat.call")}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-info hover:bg-surface-2"
    >
      <PhoneCall className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
