import assert from "node:assert/strict";
import { PNG } from "pngjs";

export function assertExportImage(bytes) {
  const { width, height, data } = PNG.sync.read(bytes);
  assert.ok(width > 0 && height > 0, "Export must have positive dimensions");
  const colors = new Set();
  let detailPixels = 0;
  for (let offset = 0; offset < data.length; offset += 4) {
    const color = data.readUInt32BE(offset);
    if (colors.size < 64) colors.add(color);
    const distance = Math.abs(data[offset] - 11)
      + Math.abs(data[offset + 1] - 17)
      + Math.abs(data[offset + 2] - 18);
    if (data[offset + 3] > 0 && distance > 60) detailPixels += 1;
  }
  const detailRatio = detailPixels / (width * height);
  assert.ok(colors.size >= 16 && detailRatio > 0.005, "Export must contain visible result content, not only a background");
  return { width, height, distinctColors: colors.size, detailRatio };
}
