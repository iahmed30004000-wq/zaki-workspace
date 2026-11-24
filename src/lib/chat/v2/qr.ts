import QRCode from "qrcode";

/**
 * «رمز QR» of a person's profile address, as plain numbers: the size of the square and ONE path that draws every dark module as a 1 × 1 square. The screen draws it as an SVG made of
 * that path (no markup from a string, nothing sent anywhere: the library works in the browser). Error correction «M»: a little damage still scans.
 */
export function qrModel(text: string, level: "M" | "Q" | "H" = "M"): { size: number; path: string } {
  const code = QRCode.create(text, { errorCorrectionLevel: level });
  const size = code.modules.size;
  const data = code.modules.data;
  let path = "";
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (data[y * size + x]) path += `M${x} ${y}h1v1h-1z`;
    }
  }
  return { size, path };
}

/** The address a person's QR holds: their page inside the app (it asks for a sign-in, so a stranger who scans it only reaches the login). */
export function profileQrUrl(origin: string, userId: string): string {
  return `${origin.replace(/\/$/, "")}/u/${encodeURIComponent(userId)}`;
}

/** The square in the middle of a code of `size` modules that the app's mark covers: odd, centred, about a fifth of the side (under 8% of the area, which level H recovers). */
export function qrLogoBox(size: number): { x: number; y: number; side: number } {
  let side = Math.floor(size * 0.22);
  if (side % 2 === 0) side -= 1;
  side = Math.max(3, side);
  const x = (size - side) / 2;
  return { x, y: x, side };
}

/** The picture's file name: the person's name as a PNG, without the characters a file name may not hold. */
export function qrFileName(name: string): string {
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${clean === "" ? "qr" : clean}.png`;
}
