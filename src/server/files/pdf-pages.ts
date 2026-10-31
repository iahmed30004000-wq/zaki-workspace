/**
 * A cheap page count for a PDF, read straight from the bytes (no PDF library): the viewer shows «12 صفحة» next to the name.
 *
 * ⚠️ It is only as good as the file lets it be. A PDF that keeps its page tree inside compressed object streams (most files
 *    saved by modern tools) has nothing readable, and then the answer is `null`: the viewer simply shows no count.
 * 🔧 Never a wrong number: it answers `null` rather than guess, and the viewer works the same with or without it.
 */

/** Files bigger than this are not scanned (the count is a nicety, not worth reading a big file for). */
export const MAX_PAGE_SCAN_BYTES = 15 * 1024 * 1024;
const MAX_PAGES = 100_000;

export function countPdfPages(data: Uint8Array): number | null {
  if (data.length < 8 || data.length > MAX_PAGE_SCAN_BYTES) return null;
  // "%PDF" must open the file (the sniffer already said so when it was uploaded)
  if (data[0] !== 0x25 || data[1] !== 0x50 || data[2] !== 0x44 || data[3] !== 0x46) return null;
  const text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1");

  // 1. the page tree: every object that says /Type /Pages carries a /Count; the root holds the largest
  let best = 0;
  const trees = /\/Type\s*\/Pages\b/g;
  for (let m = trees.exec(text); m; m = trees.exec(text)) {
    const start = Math.max(text.lastIndexOf("obj", m.index), 0);
    const endAt = text.indexOf("endobj", m.index);
    const object = text.slice(start, endAt === -1 ? m.index + 4000 : endAt);
    const count = /\/Count\s+(\d{1,9})\b/.exec(object);
    if (count) best = Math.max(best, Number(count[1]));
  }
  if (best >= 1 && best <= MAX_PAGES) return best;
  if (best > MAX_PAGES) return null;

  // 2. no readable tree: count the page objects themselves (a /Type /Page that is not /Pages)
  const pages = text.match(/\/Type\s*\/Page(?![A-Za-z])/g);
  return pages && pages.length >= 1 && pages.length <= MAX_PAGES ? pages.length : null;
}
