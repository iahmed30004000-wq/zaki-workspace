import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALBUM_GAP,
  ALBUM_MAX,
  ALBUM_MAX_H,
  ALBUM_W,
  albumMediaOf,
  albumPlan,
  cellCrop,
  layoutAlbum,
  takeRoom,
  type AlbumLayout,
} from "@/lib/chat/album-layout";
import { MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/chat/file-kinds";
import { IMAGE_MAX_H, IMAGE_MAX_W, albumBox, estimateRowHeight, imageBox } from "@/lib/chat/viewport/sizes";
import { buildRows } from "@/lib/chat/viewport/rows";
import { shortcutOf } from "@/lib/chat/shortcuts";
import {
  DOUBLE_TAP_SCALE,
  MAX_SCALE,
  clampPan,
  clampScale,
  indexOfItem,
  safeMediaUrl,
  stepIndex,
  stepOfKey,
  swipeStepOf,
  viewerItemsOf,
  wheelScale,
  zoomAt,
} from "@/components/chat/v2/media-viewer";
import { AR } from "@/lib/i18n/dict";
import type { AttachmentDto, MessageDto } from "@/server/chat/dto";
import { makeConversation } from "./chat-history-model.test";

/**
 * C3b.3 — albums: ONE pure layout function from the attachments' own width / height (1 full, 2 side by side, 3 one big + two, 4 a 2x2, 5 to 10 rows of 2 or 3),
 * the virtual list's estimate that reserves the album's box, the composer's ten-file limit, and the media viewer's pure rules (what it can show, which key and
 * which swipe is «next» in a right-to-left screen, the zoom arithmetic).
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file: string) => readFileSync(path.join(ROOT, file), "utf8");

const sized = (n: number, aspects: number[] = [4 / 3]) => Array.from({ length: n }, (_, i) => {
  const a = aspects[i % aspects.length]!;
  return { width: Math.round(1000 * a), height: 1000 };
});

const att = (over: Partial<AttachmentDto> = {}): AttachmentDto => ({ id: "a1", kind: "IMAGE", name: "x.jpg", mime: "image/jpeg", size: 1000, url: "/api/chat/attachments/a1", width: 800, height: 600, ...over });
const attachments = (n: number, over: (i: number) => Partial<AttachmentDto> = () => ({})) => Array.from({ length: n }, (_, i) => att({ id: `a${i}`, url: `/api/chat/attachments/a${i}`, ...over(i) }));

function rowsOf(layout: AlbumLayout): number[][] {
  const rows = new Map<number, number[]>();
  for (const c of layout.cells) rows.set(c.y, [...(rows.get(c.y) ?? []), c.index]);
  return [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([, indexes]) => indexes);
}

describe("the album layout: every count has its shape", () => {
  it("one picture is one full cell", () => {
    const l = layoutAlbum(sized(1));
    expect(l.cells).toHaveLength(1);
    expect(l.cells[0]).toMatchObject({ index: 0, x: 0, y: 0, width: l.width, height: l.height });
  });

  it("two are side by side: one row, the first at the start", () => {
    const l = layoutAlbum(sized(2));
    expect(rowsOf(l)).toEqual([[0, 1]]);
    expect(l.cells[0]!.x).toBe(0);
    expect(l.cells[1]!.x).toBe(l.cells[0]!.width + ALBUM_GAP);
    expect(l.cells[0]!.height).toBe(l.cells[1]!.height);
  });

  it("three are one big picture over two", () => {
    const l = layoutAlbum(sized(3));
    expect(rowsOf(l)).toEqual([[0], [1, 2]]);
    expect(l.cells[0]!.width).toBe(l.width);
    expect(l.cells[0]!.height).toBeGreaterThan(l.cells[1]!.height);
  });

  it("four are a 2x2: two rows of two equal cells", () => {
    const l = layoutAlbum(sized(4, [0.8, 2, 1, 1.5]));
    expect(rowsOf(l)).toEqual([[0, 1], [2, 3]]);
    const [a, b, c, d] = l.cells;
    expect(new Set([a!.width, b!.width, c!.width, d!.width]).size).toBeLessThanOrEqual(2); // the two columns (they differ by at most the pixel the gap takes)
    expect(Math.abs(a!.width - b!.width)).toBeLessThanOrEqual(1);
    expect(a!.x).toBe(c!.x);
    expect(b!.x).toBe(d!.x);
    expect(a!.height).toBe(b!.height);
    expect(c!.height).toBe(d!.height);
    expect(a!.height).toBe(c!.height);
  });

  it("five to ten are rows of two or three, in order, none alone", () => {
    for (let n = 5; n <= ALBUM_MAX; n += 1) {
      const l = layoutAlbum(sized(n, [1, 0.7, 1.6]));
      const rows = rowsOf(l);
      expect(rows.flat()).toEqual(Array.from({ length: n }, (_, i) => i));
      for (const row of rows) {
        expect(row.length).toBeGreaterThanOrEqual(2);
        expect(row.length).toBeLessThanOrEqual(3);
      }
      expect(albumPlan(n)).toEqual(rows.map((r) => r.length));
    }
  });

  it("the plan is a table of 1..10 whose rows add up to the count", () => {
    for (let n = 1; n <= ALBUM_MAX; n += 1) expect(albumPlan(n).reduce((a, b) => a + b, 0)).toBe(n);
    expect(albumPlan(0)).toEqual([]);
  });
});

describe("the album layout: a tile with no hole, no overlap, nothing outside the box", () => {
  const shapes = [[1], [0.5], [3], [0.6, 1.9], [1.33, 0.75, 1], [0.4, 2.8, 1, 1, 0.9, 1.7, 1.2]];
  for (let n = 1; n <= ALBUM_MAX; n += 1) {
    it(`${n} picture(s): every row spans the whole width, the rows touch, the box is within the limits`, () => {
      for (const aspects of shapes) {
        const l = layoutAlbum(sized(n, aspects));
        expect(l.width).toBeLessThanOrEqual(ALBUM_W);
        expect(l.height).toBeLessThanOrEqual(ALBUM_MAX_H);
        expect(l.width).toBeGreaterThan(0);
        let y = 0;
        for (const indexes of rowsOf(l)) {
          const cells = indexes.map((i) => l.cells[i]!);
          expect(cells[0]!.y).toBe(y);
          let x = 0;
          for (const c of cells) {
            expect(c.x).toBe(x);
            expect(c.width).toBeGreaterThan(0);
            expect(c.height).toBe(cells[0]!.height);
            x = c.x + c.width + ALBUM_GAP;
          }
          expect(x - ALBUM_GAP).toBe(l.width);
          y += cells[0]!.height + ALBUM_GAP;
        }
        expect(y - ALBUM_GAP).toBe(l.height);
        for (const c of l.cells) {
          expect(c.x).toBeGreaterThanOrEqual(0);
          expect(c.y).toBeGreaterThanOrEqual(0);
          expect(c.x + c.width).toBeLessThanOrEqual(l.width);
          expect(c.y + c.height).toBeLessThanOrEqual(l.height);
        }
      }
    });
  }

  it("is a pure function: the same input is the same answer", () => {
    expect(layoutAlbum(sized(7, [1, 0.7, 1.6]))).toEqual(layoutAlbum(sized(7, [1, 0.7, 1.6])));
  });

  it("a picture is never cropped beyond a bound: ordinary photos lose at most a quarter, a very thin one at most about half", () => {
    for (let n = 1; n <= ALBUM_MAX; n += 1) {
      for (const aspect of [0.75, 1, 1.33, 1.78]) {
        const l = layoutAlbum(sized(n, [aspect]));
        for (const c of l.cells) expect(cellCrop(c, sized(n, [aspect])[c.index]!)).toBeLessThanOrEqual(0.3);
      }
      for (const aspect of [0.45, 0.5, 2.5, 3]) {
        const l = layoutAlbum(sized(n, [aspect, 1, 1.33]));
        for (const c of l.cells) expect(cellCrop(c, sized(n, [aspect, 1, 1.33])[c.index]!)).toBeLessThanOrEqual(0.66);
      }
    }
  });

  it("a picture whose size is missing (or nonsense) takes the 4:3 fallback and never breaks the tile", () => {
    const l = layoutAlbum([{}, { width: 0, height: 0 }, { width: Number.NaN, height: 5 }, { width: -4, height: 9 }]);
    expect(l.cells).toHaveLength(4);
    expect(l.cells.every((c) => c.width > 0 && c.height > 0)).toBe(true);
    const same = layoutAlbum(sized(4, [4 / 3]));
    expect(l.height).toBe(same.height);
  });

  it("no picture, or more than ten: an empty box, or the first ten", () => {
    expect(layoutAlbum([])).toEqual({ width: 0, height: 0, rows: [], cells: [] });
    expect(layoutAlbum(sized(14)).cells).toHaveLength(ALBUM_MAX);
  });

  it("a very tall stack is made narrower (the picture's shape is kept), never taller than the limit", () => {
    const l = layoutAlbum(sized(10, [0.5]));
    expect(l.height).toBeLessThanOrEqual(ALBUM_MAX_H);
    expect(l.width).toBeLessThanOrEqual(ALBUM_W);
  });
});

describe("what makes an album", () => {
  it("pictures and videos on our own kinds; a file, a voice note and an audio file are not media", () => {
    const list = [att({ id: "i" }), att({ id: "v", kind: "VIDEO", mime: "video/mp4" }), att({ id: "f", kind: "FILE", mime: "application/pdf" }), att({ id: "a", kind: "AUDIO", mime: "audio/webm" }), att({ id: "x", kind: "IMAGE", mime: "application/pdf" })];
    expect(albumMediaOf(list).map((a) => a.id)).toEqual(["i", "v"]);
  });

  it("an address that is not ours is never in an album (the bubble and the list's estimate ask the same function, so they agree)", () => {
    const list = [...attachments(2), att({ id: "far", url: "https://elsewhere.example/a.png" })];
    expect(albumMediaOf(list).map((a) => a.id)).toEqual(["a0", "a1"]);
    const [m] = makeConversation(1, 1, () => ({ body: "x", attachments: list }));
    const row = buildRows([m!], {}).find((r) => r.type === "message")!;
    const two = estimateRowHeight(row, { albums: true });
    const [m2] = makeConversation(1, 1, () => ({ body: "x", attachments: attachments(2) }));
    const row2 = buildRows([m2!], {}).find((r) => r.type === "message")!;
    // the third picture is no album member: it is one more picture-sized line, exactly as the bubble draws it (a name line is estimated as a picture box: close enough, and the same for both)
    expect(two - estimateRowHeight(row2, { albums: true })).toBe(imageBox(list[2]!).height + 8);
  });

  it("at most ten: the eleventh is an ordinary attachment", () => {
    expect(albumMediaOf(attachments(12))).toHaveLength(ALBUM_MAX);
  });
});

describe("the virtual list reserves the album's box", () => {
  const messageRow = (list: AttachmentDto[]) => {
    const [m] = makeConversation(1, 1, () => ({ body: "x", attachments: list }));
    return buildRows([m!], {}).find((r) => r.type === "message")!;
  };

  it("one picture keeps the box it always had", () => {
    const one = att({ width: 400, height: 300 });
    expect(albumBox([one])).toEqual(imageBox(one));
    expect(IMAGE_MAX_W).toBeLessThanOrEqual(ALBUM_W);
    expect(IMAGE_MAX_H).toBeLessThan(ALBUM_MAX_H);
  });

  it("two or more pictures: the album box is the layout's own", () => {
    const list = attachments(4);
    const l = layoutAlbum(list);
    expect(albumBox(list)).toEqual({ width: l.width, height: l.height });
  });

  it("the estimate of a row with an album is the album's height, not the pictures stacked", () => {
    const one = estimateRowHeight(messageRow(attachments(1)), { albums: true });
    const four = estimateRowHeight(messageRow(attachments(4)), { albums: true });
    const l = layoutAlbum(attachments(4));
    const text = estimateRowHeight(messageRow([]));
    expect(four - text).toBe(l.height + 8);
    expect(four).toBeLessThan(one * 4);
    expect(estimateRowHeight(messageRow(attachments(10)), { albums: true })).toBeGreaterThan(four);
  });

  it("with no option, or albums off, the estimate is the old stack of pictures (C1.7's pinned numbers do not move)", () => {
    const row = messageRow(attachments(3));
    const stacked = estimateRowHeight(row);
    expect(estimateRowHeight(row, { albums: false })).toBe(stacked);
    const text = estimateRowHeight(messageRow([]));
    expect(stacked - text).toBe(3 * (imageBox(att()).height + 8));
  });

  it("a file and a voice note beside the pictures keep their own height", () => {
    const withFile = estimateRowHeight(messageRow([...attachments(2), att({ id: "f", kind: "FILE", mime: "application/pdf" })]), { albums: true });
    const without = estimateRowHeight(messageRow(attachments(2)), { albums: true });
    expect(withFile - without).toBe(64);
  });
});

describe("the composer: up to ten files in ONE message with ONE caption", () => {
  it("the album's limit and the composer's limit are the same number", () => {
    expect(ALBUM_MAX).toBe(MAX_ATTACHMENTS_PER_MESSAGE);
    expect(MAX_ATTACHMENTS_PER_MESSAGE).toBe(10);
    expect(AR["chatc.too_many_files"]).toContain("10");
  });

  it("takeRoom keeps what fits and counts the rest", () => {
    expect(takeRoom(0, [1, 2, 3])).toEqual({ accepted: [1, 2, 3], dropped: 0 });
    expect(takeRoom(8, [1, 2, 3, 4])).toEqual({ accepted: [1, 2], dropped: 2 });
    expect(takeRoom(10, [1])).toEqual({ accepted: [], dropped: 1 });
    expect(takeRoom(0, Array.from({ length: 12 }, (_, i) => i)).accepted).toHaveLength(10);
    expect(takeRoom(11, [1])).toEqual({ accepted: [], dropped: 1 });
  });

  it("the tray refuses the eleventh at pick time (the words appear at once, not after the upload) and one send carries all the ids with one body", () => {
    const hook = read("src/lib/chat/v2/composer/use-composer.ts");
    expect(hook).toContain("takeRoom(");
    expect(hook).toContain('setError(ct("chatc.too_many_files"))');
    // the send is ONE post: every file is uploaded, then ONE message with the ids and the one body
    expect(hook.match(/await postMessage\(\{ body: text\.trim\(\), attachmentIds,/g)).toHaveLength(1);
    expect(hook).toMatch(/attachmentIds\.push\(result\["id"\]\)/);
    expect(hook).toMatch(/await postMessage\(\{ body: text\.trim\(\), attachmentIds,/);
  });

  it("the tray says how many of the ten are in and that they go as one message", () => {
    const tray = read("src/components/chat/v2/composer/file-tray.tsx");
    expect(tray).toContain("data-tray-count");
    expect(tray).toContain('ct("chatalb.tray_count"');
    expect(AR["chatalb.tray_count"]).toContain("{count}");
    expect(AR["chatalb.tray_count"]).toContain("{max}");
  });
});

describe("the media viewer: what it shows", () => {
  const message = (id: string, over: Partial<MessageDto> = {}): MessageDto => ({
    id,
    kind: "TEXT",
    body: null,
    deleted: false,
    edited: false,
    pinned: false,
    mine: false,
    authorId: "u1",
    authorName: "سلمى",
    createdAt: "2026-11-19T08:00:00.000Z",
    mentions: [],
    attachments: [],
    reactions: [],
    ...over,
  });

  it("lists the pictures and videos of the loaded messages in order, with the message and its caption", () => {
    const items = viewerItemsOf([
      message("m1", { body: "صور الرحلة", attachments: attachments(2, (i) => ({ id: `p${i}`, url: `/api/chat/attachments/p${i}` })) }),
      message("m2", { body: "**فيديو**", attachments: [att({ id: "v1", url: "/api/chat/attachments/v1", kind: "VIDEO", mime: "video/mp4" })] }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["p0", "p1", "v1"]);
    expect(items.map((i) => i.messageId)).toEqual(["m1", "m1", "m2"]);
    expect(items[0]!.caption).toBe("صور الرحلة");
    expect(items[2]!.caption).toBe("فيديو");
    expect(items[2]!.attachment.kind).toBe("VIDEO");
  });

  it("NEVER lists the files of a deleted message, a voice note, a pending send, a file, an address that is not ours", () => {
    const items = viewerItemsOf([
      message("gone", { deleted: true, body: null, attachments: [att({ id: "secret", url: "/api/chat/attachments/secret" })] }),
      message("voice", { kind: "VOICE", attachments: [att({ id: "vn", kind: "AUDIO", mime: "audio/webm", url: "/api/chat/attachments/vn" })] }),
      message("pending:c1", { pending: { state: "sending" }, attachments: [att({ id: "pend", url: "/api/chat/attachments/pend" })] }),
      message("doc", { attachments: [att({ id: "pdf", kind: "FILE", mime: "application/pdf", url: "/api/chat/attachments/pdf" })] }),
      message("remote", { attachments: [att({ id: "far", url: "https://elsewhere.example/a.png" })] }),
      message("ok", { attachments: [att({ id: "fine", url: "/api/chat/attachments/fine" })] }),
    ]);
    expect(items.map((i) => i.id)).toEqual(["fine"]);
    expect(safeMediaUrl("/api/chat/attachments/a")).toBe("/api/chat/attachments/a");
    expect(safeMediaUrl("https://x.example/a")).toBeUndefined();
    expect(safeMediaUrl("//x.example/api/chat/attachments/a")).toBeUndefined();
  });

  it("the caption is the words without their markers, and a spoiler stays hidden in it", () => {
    const [item] = viewerItemsOf([message("m", { body: "شوفوا ||كلمة السر||", attachments: attachments(1) })]);
    expect(item!.caption).not.toContain("كلمة السر");
    expect(item!.caption).not.toContain("||");
    expect(item!.caption).toContain("شوفوا");
  });

  it("the list is live and the picture is followed by its id: a deleted message drops out at once and an older page put in front moves nothing", () => {
    const viewer = read("src/components/chat/v2/media-viewer.tsx");
    const bubble = read("src/components/chat/v2/bubble/bubble-media.tsx");
    expect(viewer).toContain("items.findIndex((candidate) => candidate.id === currentId)");
    expect(bubble).toContain("viewerItems(openId)");
    // no copy of the list is kept when the viewer opens
    expect(bubble).not.toMatch(/useState<\{ items/);
    const before = viewerItemsOf([message("m1", { attachments: attachments(2) }), message("m2", { attachments: attachments(1, () => ({ id: "late", url: "/api/chat/attachments/late" })) })]);
    const after = viewerItemsOf([message("m1", { attachments: attachments(2) }), message("m2", { deleted: true, attachments: attachments(1, () => ({ id: "late", url: "/api/chat/attachments/late" })) })]);
    expect(before.map((i) => i.id)).toContain("late");
    expect(after.map((i) => i.id)).not.toContain("late");
  });

  it("finds the picture that was tapped, and steps without wrapping past the ends", () => {
    const items = viewerItemsOf([message("m", { attachments: attachments(3) })]);
    expect(indexOfItem(items, "a1")).toBe(1);
    expect(indexOfItem(items, "nope")).toBe(0);
    expect(stepIndex(0, 1, 3)).toBe(1);
    expect(stepIndex(2, 1, 3)).toBe(2);
    expect(stepIndex(0, -1, 3)).toBe(0);
    expect(stepIndex(1, -1, 3)).toBe(0);
    expect(stepIndex(0, 1, 0)).toBe(0);
  });
});

describe("the media viewer: direction (the screen is right to left)", () => {
  it("in a right-to-left screen the left arrow is NEXT and the right arrow is PREVIOUS; left to right is the other way", () => {
    expect(stepOfKey("ArrowLeft", true)).toBe(1);
    expect(stepOfKey("ArrowRight", true)).toBe(-1);
    expect(stepOfKey("ArrowLeft", false)).toBe(-1);
    expect(stepOfKey("ArrowRight", false)).toBe(1);
    expect(stepOfKey("Enter", true)).toBe(0);
  });

  it("a swipe: a finger moving to the right brings the NEXT one in a right-to-left screen; short, slow or mostly vertical swipes do nothing", () => {
    expect(swipeStepOf(120, 10, true)).toBe(1);
    expect(swipeStepOf(-120, 10, true)).toBe(-1);
    expect(swipeStepOf(120, 10, false)).toBe(-1);
    expect(swipeStepOf(-120, 10, false)).toBe(1);
    expect(swipeStepOf(30, 0, true)).toBe(0);
    expect(swipeStepOf(100, 200, true)).toBe(0);
  });
});

describe("the media viewer: zoom arithmetic", () => {
  it("the scale stays between 1 and the maximum; the wheel zooms in on a negative delta and out on a positive one", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(1);
    expect(wheelScale(1, -100)).toBeGreaterThan(1);
    expect(wheelScale(2, 100)).toBeLessThan(2);
    expect(wheelScale(1, 100)).toBe(1);
  });

  it("zooming at a point keeps that point still; zooming back to 1 recentres", () => {
    const view = zoomAt({ scale: 1, x: 0, y: 0 }, 2, { x: 100, y: 50 });
    expect(view.scale).toBe(2);
    // the point under the finger: (focal - translate) / scale is the same before and after
    expect((100 - view.x) / 2).toBeCloseTo(100, 5);
    expect((50 - view.y) / 2).toBeCloseTo(50, 5);
    expect(zoomAt(view, 1, { x: 100, y: 50 })).toEqual({ scale: 1, x: 0, y: 0 });
    expect(DOUBLE_TAP_SCALE).toBeGreaterThan(1);
    expect(DOUBLE_TAP_SCALE).toBeLessThanOrEqual(MAX_SCALE);
  });

  it("the pan never leaves the picture's edge, and a picture that fits cannot be moved", () => {
    const stage = { w: 400, h: 400 };
    expect(clampPan({ scale: 1, x: 80, y: 80 }, { w: 400, h: 300 }, stage)).toEqual({ scale: 1, x: 0, y: 0 });
    const out = clampPan({ scale: 2, x: 999, y: -999 }, { w: 400, h: 300 }, stage);
    expect(out.x).toBe(200); // (400 * 2 - 400) / 2
    expect(out.y).toBe(-100); // (300 * 2 - 400) / 2
  });
});

describe("the media viewer: the rules of the screen it opens over", () => {
  const viewer = read("src/components/chat/v2/media-viewer.tsx");

  it("is a real dialog (focus kept inside, the page behind inert): the shortcut layer treats it as an overlay and the Esc that closes it does not also leave the conversation", () => {
    expect(viewer).toContain("@radix-ui/react-dialog");
    expect(viewer).toContain("DialogPrimitive.Content");
    expect(viewer).toContain("DialogPrimitive.Title");
    expect(viewer).toContain("useReturnFocus");
    // what Esc looks like to the app's own key layer: Radix handles it first (the event is then `defaultPrevented`), and a dialog is on the page
    expect(shortcutOf({ key: "Escape", code: "Escape", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, defaultPrevented: true })).toBeNull();
    expect(shortcutOf({ key: "Escape", code: "Escape", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toEqual({ type: "escape" });
    expect(read("src/lib/chat/shortcuts.ts")).toContain('[role="dialog"]');
  });

  it("the events of the viewer do not reach the bubble it was opened from (a portal passes React events up: a double click would reply, a right click would open the menu)", () => {
    for (const name of ["onPointerDown", "onPointerUp", "onPointerMove", "onDoubleClick", "onContextMenu", "onClick", "onKeyDown", "onTouchStart"]) {
      expect(viewer, name).toContain(name);
    }
    expect(viewer).toContain("stopPropagation");
  });

  it("the viewer lives above the list when a provider exists (a bubble that is deleted or scrolled away does not take it along) and keeps its own place otherwise", () => {
    const bubble = read("src/components/chat/v2/bubble/bubble-media.tsx");
    expect(viewer).toContain("open: setRequest");
    expect(viewer).toContain("{request ? <MediaViewer ");
    expect(bubble).toContain("source.open({");
    expect(bubble).toContain("setOpenId(id)");
  });

  it("Radix draws the content one commit after the viewer: the stage and the direction come from callback refs, not from a mount effect that would see null", () => {
    expect(viewer).toContain("ref={setStage}");
    expect(viewer).toContain("ref={setContent}");
    expect(viewer).not.toContain("stageRef");
    expect(viewer).not.toContain("useLayoutEffect");
    expect(read("node_modules/@radix-ui/react-portal/dist/index.js")).toContain("setMounted(true)");
  });

  it("«اعرض بالمحادثة» does not hand focus back to the bubble it was opened from (that would scroll it into view and undo the jump); a right or middle button is no gesture", () => {
    expect(viewer).toContain("jumping.current = true");
    expect(viewer).toContain("if (jumping.current) event.preventDefault()");
    expect(viewer).toContain('event.pointerType === "mouse" && event.button !== 0');
  });

  it("uses theme tokens only, logical sides, native video controls, a download line, no raw HTML", () => {
    expect(viewer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(viewer).not.toMatch(/(?<![\w-])(?:bg|text|border)-(?:white|black)\b/);
    expect(viewer).not.toMatch(/(?<![\w-])(?:ml|mr|pl|pr|left|right)-\d/);
    expect(viewer).not.toContain("dangerouslySetInnerHTML");
    expect(viewer).toMatch(/<video[^>]*controls/);
    expect(viewer).toContain("download=");
    expect(viewer).toContain('ct("chatalb.show"');
  });

  it("the words the viewer shows are in the dictionary", () => {
    for (const key of ["chatalb.viewer", "chatalb.open", "chatalb.prev", "chatalb.next", "chatalb.close", "chatalb.show", "chatalb.position", "chatalb.zoom_in", "chatalb.zoom_out", "chatalb.play"]) {
      expect(AR[key], key).toBeTruthy();
    }
    expect(AR["chatalb.show"]).toBe("اعرض بالمحادثة");
  });
});
