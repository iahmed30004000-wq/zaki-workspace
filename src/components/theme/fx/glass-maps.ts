/**
 * The two refraction maps of the glass knob, drawn once on a small canvas and cached:
 *
 *   magnify  every point of the glass samples nearer the middle (0.72x: the content looks 1/0.72 times larger);
 *   bevel    inside the bevel band at the edge (22% of the size, a circular profile) the sampling bends strongly inward.
 *
 * Encoded as a normal feDisplacementMap map: red = x, green = y, 128 = no shift. Nothing samples outside the knob, so the glass
 * never shows a transparent rim. The numbers come from the reference's own annotations ("0.72x magnification", "bevel 22% circular
 * profile", "dispersion R/B ±22%").
 */

export const MAG = 0.72;
export const BEVEL = 0.22;
export const DISPERSION = 0.22;
/** The corner radius of the knob as a share of its size. */
export const KNOB_RADIUS = 0.3;
/** The largest displacement each map encodes, as a share of the knob's size. */
export const MAG_REACH = (1 - MAG) * 0.5;
export const BEVEL_REACH = 0.11;

const MAP_PX = 128;
const cache = new Map<string, { mag: string; bevel: string }>();

/** The signed distance (negative inside) of a point to a rounded square centred at 0 with half-size h and corner radius r. */
export function roundedBoxSdf(x: number, y: number, h: number, r: number): number {
  const qx = Math.abs(x) - (h - r);
  const qy = Math.abs(y) - (h - r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
}

/** The bevel's strength 0..1 at a depth: 1 at the very edge, falling along a circular arc to 0 at the inner border of the band. */
export function bevelStrength(depth: number, band = BEVEL): number {
  if (depth <= 0) return 1;
  if (depth >= band) return 0;
  const t = depth / band;
  return 1 - Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
}

export function makeGlassMaps(): { mag: string; bevel: string } | null {
  if (typeof document === "undefined") return null;
  const hit = cache.get("k");
  if (hit) return hit;
  const mag = document.createElement("canvas");
  const bev = document.createElement("canvas");
  mag.width = mag.height = bev.width = bev.height = MAP_PX;
  const mc = mag.getContext("2d");
  const bc = bev.getContext("2d");
  if (!mc || !bc) return null;
  const mi = mc.createImageData(MAP_PX, MAP_PX);
  const bi = bc.createImageData(MAP_PX, MAP_PX);
  for (let py = 0; py < MAP_PX; py++) {
    for (let px = 0; px < MAP_PX; px++) {
      const x = (px + 0.5) / MAP_PX - 0.5;
      const y = (py + 0.5) / MAP_PX - 0.5;
      const sdf = roundedBoxSdf(x, y, 0.5, KNOB_RADIUS);
      const i = (py * MAP_PX + px) * 4;
      let mx = 0;
      let my = 0;
      let bx = 0;
      let by = 0;
      if (sdf < 0) {
        mx = -x * (1 - MAG);
        my = -y * (1 - MAG);
        const depth = -sdf;
        const strength = bevelStrength(depth);
        if (strength > 0) {
          // the outward normal of the box at this point
          const qx = Math.abs(x) - (0.5 - KNOB_RADIUS);
          const qy = Math.abs(y) - (0.5 - KNOB_RADIUS);
          let nx: number;
          let ny: number;
          if (qx > 0 && qy > 0) {
            const l = Math.hypot(qx, qy) || 1;
            nx = (qx / l) * Math.sign(x);
            ny = (qy / l) * Math.sign(y);
          } else if (qx > qy) {
            nx = Math.sign(x);
            ny = 0;
          } else {
            nx = 0;
            ny = Math.sign(y);
          }
          bx = -nx * strength * strength * BEVEL_REACH;
          by = -ny * strength * strength * BEVEL_REACH;
        }
      }
      const enc = (v: number, reach: number) => Math.round(128 + Math.max(-1, Math.min(1, v / reach)) * 127);
      mi.data[i] = enc(mx, MAG_REACH);
      mi.data[i + 1] = enc(my, MAG_REACH);
      mi.data[i + 2] = 128;
      mi.data[i + 3] = 255;
      bi.data[i] = enc(bx, BEVEL_REACH);
      bi.data[i + 1] = enc(by, BEVEL_REACH);
      bi.data[i + 2] = 128;
      bi.data[i + 3] = 255;
    }
  }
  mc.putImageData(mi, 0, 0);
  bc.putImageData(bi, 0, 0);
  const out = { mag: mag.toDataURL("image/png"), bevel: bev.toDataURL("image/png") };
  cache.set("k", out);
  return out;
}
