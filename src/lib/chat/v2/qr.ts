import QRCode from "qrcode";

/**
 * «رمز QR» of a person's profile address, as plain numbers: the size of the square and ONE path that draws every dark module as a 1 × 1 square. The screen draws it as an SVG made of
 * that path (no markup from a string, nothing sent anywhere: the library works in the browser). Error correction «M»: a little damage still scans.
 */
export function qrModel(text: string): { size: number; path: string } {
  const code = QRCode.create(text, { errorCorrectionLevel: "M" });
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
