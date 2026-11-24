"use client";

import React from "react";
import { Brush, Crop, RotateCw, SlidersHorizontal, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ct } from "@/lib/chat/text";
import {
  adjustFilter,
  clampAdjust,
  CROP_PRESETS,
  cropBox,
  editedName,
  emptyEdit,
  isUntouched,
  PEN_COLORS,
  PEN_WIDTH,
  turnedSize,
  type CropPreset,
  type EditState,
  type Stroke,
} from "@/lib/chat/v2/composer/photo-edit";

type Tool = "crop" | "draw" | "adjust";
const TOOL_ICONS = { crop: Crop, draw: Brush, adjust: SlidersHorizontal } as const;
const TOOL_LABELS: Record<Tool, string> = { crop: "chatui.photoedit.crop", draw: "chatui.photoedit.draw", adjust: "chatui.photoedit.adjust" };
const PRESET_LABELS: Record<CropPreset, string> = { free: "chatui.photoedit.free", square: "chatui.photoedit.square", "four-three": "chatui.photoedit.four_three", "sixteen-nine": "chatui.photoedit.sixteen_nine" };
const COLOR_LABELS: Record<(typeof PEN_COLORS)[number], string> = {
  white: "chatui.photoedit.color_white",
  black: "chatui.photoedit.color_black",
  red: "chatui.photoedit.color_red",
  gold: "chatui.photoedit.color_gold",
  limegreen: "chatui.photoedit.color_green",
  dodgerblue: "chatui.photoedit.color_blue",
};
const PREVIEW_SIDE = 900;
const EXPORT_SIDE = 3200;

/** Draws the edit on `target`: turn, then the sliders' filter, then the crop, then the strokes (their points are fractions of the cropped picture). */
function renderEdit(bitmap: ImageBitmap, state: EditState, maxSide: number, target: HTMLCanvasElement, live: Stroke | null): void {
  const turned = turnedSize(bitmap.width, bitmap.height, state.turns);
  const scale = Math.min(1, maxSide / Math.max(turned.w, turned.h));
  const tw = Math.max(1, Math.round(turned.w * scale));
  const th = Math.max(1, Math.round(turned.h * scale));
  const temp = document.createElement("canvas");
  temp.width = tw;
  temp.height = th;
  const tctx = temp.getContext("2d");
  if (!tctx) return;
  tctx.filter = adjustFilter(state);
  tctx.translate(tw / 2, th / 2);
  tctx.rotate((state.turns * Math.PI) / 2);
  const dw = state.turns % 2 === 0 ? tw : th;
  const dh = state.turns % 2 === 0 ? th : tw;
  tctx.drawImage(bitmap, -dw / 2, -dh / 2, dw, dh);
  const box = cropBox(tw, th, state.crop);
  target.width = box.w;
  target.height = box.h;
  const ctx = target.getContext("2d");
  if (!ctx) return;
  ctx.drawImage(temp, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const stroke of live ? [...state.strokes, live] : state.strokes) {
    if (stroke.points.length === 0) continue;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(2, stroke.width * Math.min(box.w, box.h));
    ctx.beginPath();
    const [fx, fy] = stroke.points[0]!;
    ctx.moveTo(fx * box.w, fy * box.h);
    if (stroke.points.length === 1) ctx.lineTo(fx * box.w + 0.01, fy * box.h);
    for (const [px, py] of stroke.points.slice(1)) ctx.lineTo(px * box.w, py * box.h);
    ctx.stroke();
  }
}

/**
 * «تعديل الصورة» (Telegram's editor, S6.2): قص (free, square, 4:3, 16:9 and a quarter turn), رسم (a pen in six colours, undo), تعديل (تحسين, السطوع, التباين). The picture is
 * redrawn on a canvas; «تم» hands back a new JPEG file of the same stem, «إلغاء» leaves the original. The browser's `filter` on a canvas is what the three sliders use.
 */
export function PhotoEditor({ file, onCancel, onDone }: { file: File; onCancel: () => void; onDone: (edited: File) => void }) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = React.useState<ImageBitmap | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [state, setState] = React.useState<EditState>(emptyEdit);
  const [tool, setTool] = React.useState<Tool>("crop");
  const [color, setColor] = React.useState<(typeof PEN_COLORS)[number]>("red");
  const [live, setLive] = React.useState<Stroke | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    let opened: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: "from-image" }).then(
      (made) => {
        if (!alive) return made.close();
        opened = made;
        setBitmap(made);
      },
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
      opened?.close();
    };
  }, [file]);

  React.useEffect(() => {
    if (bitmap && canvasRef.current) renderEdit(bitmap, state, PREVIEW_SIDE, canvasRef.current, live);
  }, [bitmap, state, live]);

  const at = (event: React.PointerEvent<HTMLCanvasElement>): [number, number] => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))];
  };
  const drawing = tool === "draw";

  async function finish() {
    if (!bitmap) return;
    if (isUntouched(state)) return onCancel();
    setSaving(true);
    const out = document.createElement("canvas");
    renderEdit(bitmap, state, EXPORT_SIDE, out, null);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, "image/jpeg", 0.92));
    setSaving(false);
    if (!blob) return setFailed(true);
    onDone(new File([blob], editedName(file.name), { type: "image/jpeg" }));
  }

  const slider = (key: "enhance" | "exposure" | "contrast", label: string, min: number) => (
    <label key={key} className="flex items-center gap-3 text-sm text-fg">
      <span className="w-20 shrink-0">{label}</span>
      <input
        type="range"
        data-edit-slider={key}
        min={min}
        max={100}
        step={1}
        value={state[key]}
        onChange={(event) => setState((cur) => ({ ...cur, [key]: clampAdjust(Number(event.currentTarget.value)) }))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span dir="ltr" className="w-9 shrink-0 text-end text-xs text-fg-muted">
        {state[key]}
      </span>
    </label>
  );

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onCancel())}>
      <DialogContent size="lg" hideClose className="gap-3 p-3">
        <DialogTitle className="text-center text-base">{ct("chatui.photoedit.title")}</DialogTitle>
        <DialogDescription className="sr-only">{ct("chatui.photoedit.tools")}</DialogDescription>
        <div data-photo-editor className="flex min-h-40 items-center justify-center overflow-hidden rounded-lg bg-surface-2">
          {failed ? (
            <p role="alert" className="p-6 text-sm text-danger">
              {ct("chatui.photoedit.failed")}
            </p>
          ) : (
            <canvas
              ref={canvasRef}
              data-edit-canvas
              className={`max-h-[55dvh] max-w-full ${drawing ? "cursor-crosshair touch-none" : ""}`}
              onPointerDown={(event) => {
                if (!drawing) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setLive({ color, width: PEN_WIDTH, points: [at(event)] });
              }}
              onPointerMove={(event) => {
                if (!drawing || !live) return;
                setLive({ ...live, points: [...live.points, at(event)] });
              }}
              onPointerUp={() => {
                if (!live) return;
                setState((cur) => ({ ...cur, strokes: [...cur.strokes, live] }));
                setLive(null);
              }}
            />
          )}
        </div>
        <div data-edit-panel className="min-h-16 space-y-2 px-1">
          {tool === "crop" ? (
            <div className="flex flex-wrap items-center gap-2">
              {CROP_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  data-edit-crop={preset}
                  aria-pressed={state.crop === preset}
                  onClick={() => setState((cur) => ({ ...cur, crop: preset }))}
                  className="min-h-10 rounded-full bg-surface-2 px-4 text-sm text-fg aria-pressed:bg-accent aria-pressed:text-accent-fg"
                >
                  {ct(PRESET_LABELS[preset])}
                </button>
              ))}
              <button type="button" data-edit-turn aria-label={ct("chatui.photoedit.turn")} title={ct("chatui.photoedit.turn")} onClick={() => setState((cur) => ({ ...cur, turns: (((cur.turns + 1) % 4) as EditState["turns"]) }))} className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg hover:bg-surface-3">
                <RotateCw aria-hidden="true" className="size-5" />
              </button>
            </div>
          ) : null}
          {tool === "draw" ? (
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label={ct("chatui.photoedit.pen")}>
              {PEN_COLORS.map((name) => (
                <button
                  key={name}
                  type="button"
                  data-edit-color={name}
                  aria-label={ct(COLOR_LABELS[name])}
                  aria-pressed={color === name}
                  onClick={() => setColor(name)}
                  style={{ backgroundColor: name }}
                  className="size-9 rounded-full border-2 border-border aria-pressed:border-accent aria-pressed:ring-2 aria-pressed:ring-accent"
                />
              ))}
              <button type="button" data-edit-undo aria-label={ct("chatui.photoedit.undo")} title={ct("chatui.photoedit.undo")} disabled={state.strokes.length === 0} onClick={() => setState((cur) => ({ ...cur, strokes: cur.strokes.slice(0, -1) }))} className="flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg hover:bg-surface-3 disabled:opacity-50">
                <Undo2 aria-hidden="true" className="size-5" />
              </button>
            </div>
          ) : null}
          {tool === "adjust" ? (
            <div className="space-y-1">
              {slider("enhance", ct("chatui.photoedit.enhance"), 0)}
              {slider("exposure", ct("chatui.photoedit.exposure"), -100)}
              {slider("contrast", ct("chatui.photoedit.contrast"), -100)}
            </div>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            {ct("chatui.photoedit.cancel")}
          </Button>
          <div role="group" aria-label={ct("chatui.photoedit.tools")} className="flex items-center gap-1 rounded-full bg-surface-2 p-1">
            {(Object.keys(TOOL_ICONS) as Tool[]).map((id) => {
              const Icon = TOOL_ICONS[id];
              return (
                <button key={id} type="button" data-edit-tool={id} aria-pressed={tool === id} aria-label={ct(TOOL_LABELS[id])} title={ct(TOOL_LABELS[id])} onClick={() => setTool(id)} className="flex size-11 items-center justify-center rounded-full text-fg-muted aria-pressed:bg-accent aria-pressed:text-accent-fg">
                  <Icon aria-hidden="true" className="size-5" />
                </button>
              );
            })}
          </div>
          <Button type="button" data-edit-done disabled={!bitmap || saving} onClick={() => void finish()}>
            {ct("chatui.photoedit.done")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
