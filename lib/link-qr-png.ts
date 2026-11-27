import { linkQrPngLayout, QR_DARK, QR_LIGHT } from "./link-qr";

/**
 * The poster code as a PNG (browser only: it draws on a canvas), about
 * 2000 px square (linkQrPngLayout): the white plate with its quiet zone, then
 * each dark module as a whole-pixel square, so nothing is antialiased.
 * Rejects when the browser can't make one (no 2D context, or `toBlob` gives
 * nothing, as it can for a canvas too big for the device's memory).
 */
export function linkQrPngBlob(matrix: boolean[][]): Promise<Blob> {
  const { scale, quiet, side } = linkQrPngLayout(matrix.length);
  const canvas = document.createElement("canvas");
  canvas.width = side;
  canvas.height = side;
  const context = canvas.getContext("2d");
  if (!context) return Promise.reject(new Error("This browser can't draw the PNG."));
  context.fillStyle = QR_LIGHT;
  context.fillRect(0, 0, side, side);
  context.fillStyle = QR_DARK;
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) context.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    });
  });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("This browser couldn't make the PNG."))), "image/png");
  });
}
