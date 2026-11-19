import { atStartEdge, commitsBack, dragOffset, inwardOf, swipeIntent } from "@/lib/chat/v2/phone/edge-swipe";
import { SLIDE_MS } from "@/lib/chat/v2/phone/motion";

/**
 * C2.8 — the listener behind «swipe from the start edge goes back», with no React in it so it can be driven by a test with a plain event target. The hook
 * `use-edge-swipe.ts` attaches it to the screen's box; the rules it applies are the pure ones of `edge-swipe.ts`.
 *
 * It follows the finger by writing the box's own `transform` (no render per move), and on release either calls `onBack` (the box is hidden by the route
 * change, so its transform is cleared at once) or slides back to where it was (instantly under reduced motion).
 */
export interface SwipeBox {
  style: { transform: string; transition: string };
  addEventListener: (type: string, listener: (event: never) => void) => void;
  removeEventListener: (type: string, listener: (event: never) => void) => void;
  setPointerCapture: (id: number) => void;
  releasePointerCapture: (id: number) => void;
}

export interface SwipeEnv {
  /** is the page right-to-left (read at the moment of a touch: a screen can change direction) */
  rtl: () => boolean;
  /** the width of the window */
  width: () => number;
  reducedMotion: () => boolean;
  onBack: () => void;
}

/** The pointer fields the controller reads (a real PointerEvent has them all). */
interface Touch {
  pointerId: number;
  pointerType: string;
  isPrimary: boolean;
  clientX: number;
  clientY: number;
  timeStamp: number;
}

export function attachEdgeSwipe(box: SwipeBox, env: SwipeEnv): () => void {
  let start: { id: number; x: number; y: number; at: number } | null = null;
  let dragging = false;
  let settle: ReturnType<typeof setTimeout> | null = null;

  const clear = () => {
    if (settle) clearTimeout(settle);
    settle = null;
    box.style.transition = "";
    box.style.transform = "";
  };
  const snapBack = () => {
    if (env.reducedMotion()) return clear();
    box.style.transition = `transform ${SLIDE_MS}ms ease-out`;
    box.style.transform = "";
    settle = setTimeout(clear, SLIDE_MS + 40);
  };
  const end = (event: Touch, cancelled: boolean) => {
    if (!start || event.pointerId !== start.id) return;
    const from = start;
    start = null;
    if (!dragging) return;
    dragging = false;
    try {
      box.releasePointerCapture(event.pointerId);
    } catch {
      /* the capture is already gone */
    }
    const inward = inwardOf(from.x, event.clientX, env.rtl());
    if (!cancelled && commitsBack({ inward, dy: event.clientY - from.y, ms: event.timeStamp - from.at })) {
      clear();
      env.onBack();
    } else snapBack();
  };

  const down = (event: Touch) => {
    // a mouse never swipes; only the first finger; only from the strip along the START edge
    if (event.pointerType === "mouse" || !event.isPrimary) return;
    if (!atStartEdge(event.clientX, env.width(), env.rtl())) return;
    clear();
    start = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp };
    dragging = false;
  };
  const move = (event: Touch) => {
    if (!start || event.pointerId !== start.id) return;
    const rtl = env.rtl();
    const inward = inwardOf(start.x, event.clientX, rtl);
    if (!dragging) {
      const intent = swipeIntent(inward, event.clientY - start.y);
      if (intent === "undecided") return;
      if (intent === "scroll") {
        start = null;
        return;
      }
      dragging = true;
      try {
        box.setPointerCapture(event.pointerId);
      } catch {
        /* a pointer that is already gone */
      }
      box.style.transition = "none";
    }
    box.style.transform = `translateX(${(rtl ? -1 : 1) * dragOffset(inward)}px)`;
  };
  const up = (event: Touch) => end(event, false);
  const cancel = (event: Touch) => end(event, true);

  const listeners: [string, (event: never) => void][] = [
    ["pointerdown", down as (event: never) => void],
    ["pointermove", move as (event: never) => void],
    ["pointerup", up as (event: never) => void],
    ["pointercancel", cancel as (event: never) => void],
  ];
  for (const [type, listener] of listeners) box.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of listeners) box.removeEventListener(type, listener);
    clear();
  };
}
