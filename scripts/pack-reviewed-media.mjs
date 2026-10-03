/* global process, console, URL, Buffer */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
const require = createRequire(new URL("../apps/data/package.json", import.meta.url));
const JSZip = require("jszip");
const [cache, output, manifestOutput] = process.argv.slice(2);
if (!cache || !output || !manifestOutput) throw new Error("Usage: node scripts/pack-reviewed-media.mjs AUDIT_CACHE OUTPUT_DIRECTORY MANIFEST_OUTPUT");
const manifest = JSON.parse(await readFile("data/overrides/media.json", "utf8"));
if (manifest.status !== "reviewed" || manifest.version !== 1) throw new Error("Only an explicitly reviewed manifest can be packed.");
const sha = (bytes, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const files = new Map();
let total = 0;
for (const asset of manifest.assets) {
  const bytes = await readFile(join(resolve(cache), `image-${sha(asset.sourceUrl)}.bin`));
  if (sha(bytes) !== asset.rightsBasis.fileChecksum || !bytes.length || bytes.length > 10_000_000) throw new Error("Reviewed image pin/size mismatch.");
  const type = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? ["image/png", "png"]
    : bytes[0] === 255 && bytes[1] === 216 ? ["image/jpeg", "jpg"]
    : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" ? ["image/webp", "webp"]
    : bytes.toString("ascii", 0, 3) === "GIF" ? ["image/gif", "gif"] : null;
  if (type === null) throw new Error("Reviewed image format is unrecognized.");
  asset.byteSize = bytes.length; asset.contentType = type[0];
  const filename = `${asset.rightsBasis.fileChecksum}.${type[1]}`;
  if (!files.has(filename)) { files.set(filename, bytes); total += bytes.length; }
}
if (total > 256 * 1024 * 1024) throw new Error("Reviewed media exceeds archive capacity.");
const zip = new JSZip();
for (const [filename, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) zip.file(filename, bytes, { date: new Date("1980-01-01T00:00:00Z"), createFolders: false });
const bundle = await zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
const checksum = sha(bundle);
manifest.archive = { tag: `media-reviewed-${checksum}`, checksum, byteSize: bundle.length };
await mkdir(resolve(output), { recursive: true });
const artifact = join(resolve(output), `media-${checksum}.zip`);
await writeFile(artifact, bundle);
await writeFile(resolve(manifestOutput), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ artifact, archive: manifest.archive, files: files.size, imageBytes: total, manifestOutput: resolve(manifestOutput) }));
