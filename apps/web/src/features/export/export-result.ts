import { toPng } from "html-to-image";
import JSZip from "jszip";

import type { ComparisonQuery, ComparisonResponse } from "@riftversus/contracts";

import type { ComparisonApi } from "../../api/types.js";

const EXPORT_PAGE_SIZE = 50;
const EXPORT_ROW_CAP = 1_000;
const EXPORT_WIDTH = 1_200;
const EXPORT_PIXEL_RATIO = 2;
const PLACEHOLDER_MEDIA = `${import.meta.env.BASE_URL}media-placeholder.svg`;
type SeriesRow = ComparisonResponse["rows"][number];

export interface ExportInput {
  api: Pick<ComparisonApi, "compare">;
  query: ComparisonQuery;
  initial: ComparisonResponse;
  now?: Date;
  document?: Document;
}

export interface ExportArtifact {
  blob: Blob;
  filename: string;
  kind: "png" | "zip";
  pageCount: number;
  rowCount: number;
}

export class ExportLimitError extends Error {
  constructor() {
    super("匯出最多支援 1,000 筆系列賽，請縮小篩選範圍後重試。");
    this.name = "ExportLimitError";
  }
}

export function partitionSeries<T>(rows: T[], pageSize = EXPORT_PAGE_SIZE): T[][] {
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new RangeError("pageSize must be a positive integer");
  const pages: T[][] = [];
  for (let index = 0; index < rows.length; index += pageSize) pages.push(rows.slice(index, index + pageSize));
  return pages;
}

function sameValues<T extends string | number>(left: readonly T[], right: readonly T[]): boolean {
  const canonical = (values: readonly T[]) => [...new Set(values)].sort((a, b) => String(a).localeCompare(String(b)));
  const leftValues = canonical(left);
  const rightValues = canonical(right);
  return leftValues.length === rightValues.length && leftValues.every((value, index) => value === rightValues[index]);
}

function sameComparisonQuery(left: ComparisonQuery, right: ComparisonQuery): boolean {
  return left.left.kind === right.left.kind
    && left.left.id === right.left.id
    && left.left.teamEraId === right.left.teamEraId
    && left.right.kind === right.right.kind
    && left.right.id === right.right.id
    && left.right.teamEraId === right.right.teamEraId
    && left.from === right.from
    && left.to === right.to
    && left.limit === right.limit
    && sameValues(left.eventCategories, right.eventCategories)
    && sameValues(left.leagues, right.leagues)
    && sameValues(left.bestOf, right.bestOf)
    && sameValues(left.tournamentIds, right.tournamentIds);
}

function mediaLoadError(placeholder: boolean): Error {
  return new Error(placeholder ? "匯出圖片載入失敗，預設圖片也無法載入。" : "匯出圖片載入失敗。");
}

async function waitForLoadedImage(image: HTMLImageElement, placeholder: boolean): Promise<void> {
  if (image.complete) {
    if (image.naturalWidth === 0) throw mediaLoadError(placeholder);
    if (typeof image.decode === "function") await image.decode();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(mediaLoadError(placeholder)), { once: true });
  });
}

async function waitForImage(image: HTMLImageElement): Promise<void> {
  try {
    await waitForLoadedImage(image, image.getAttribute("src") === PLACEHOLDER_MEDIA);
  } catch {
    if (image.getAttribute("src") === PLACEHOLDER_MEDIA) throw mediaLoadError(true);
    image.setAttribute("src", PLACEHOLDER_MEDIA);
    try {
      await waitForLoadedImage(image, true);
    } catch {
      throw mediaLoadError(true);
    }
  }
}

export async function waitForExportImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map(waitForImage));
}

function safeFilenamePart(value: string): string {
  const normalized = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const safe = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 56);
  return safe || "comparison";
}

function basename(initial: ComparisonResponse): string {
  return ["riftversus", safeFilenamePart(initial.subjects.left.displayName), "vs", safeFilenamePart(initial.subjects.right.displayName), safeFilenamePart(initial.dataset.version)].join("-");
}

function pageFilename(name: string, page: number): string {
  return `${name}-${String(page).padStart(2, "0")}.png`;
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("匯出圖片格式無法辨識。");
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: match[1]! });
}

function trustedMediaUrl(value: string, document: Document): string {
  if (value.startsWith("data:image/")) return value;
  try {
    const url = new URL(value, document.location.origin);
    return url.origin === document.location.origin ? url.pathname + url.search : PLACEHOLDER_MEDIA;
  } catch {
    return PLACEHOLDER_MEDIA;
  }
}

function appendText(parent: HTMLElement, tag: keyof HTMLElementTagNameMap, text: string, className?: string): HTMLElement {
  const element = parent.ownerDocument.createElement(tag);
  if (className) element.className = className;
  element.textContent = text;
  parent.append(element);
  return element;
}

function filters(query: ComparisonQuery): string {
  const values = [
    ...query.eventCategories.map((value) => value.toUpperCase()),
    ...query.leagues.map((value) => value.toUpperCase()),
    ...query.bestOf.map((value) => `BO${value}`),
  ];
  const range = query.from || query.to ? `${query.from ?? "開始"} - ${query.to ?? "現在"}` : "全部日期";
  return [values.join(" · ") || "全部賽事", range].join(" · ");
}

function createMedia(document: Document, src: string, alt: string): HTMLImageElement {
  const image = document.createElement("img");
  image.src = src;
  image.alt = alt;
  return image;
}

function renderExportPage(document: Document, initial: ComparisonResponse, rows: SeriesRow[], page: number, pageCount: number, now: Date): HTMLElement {
  const root = document.createElement("article");
  root.className = "export-sheet";
  root.setAttribute("aria-hidden", "true");

  const masthead = document.createElement("header");
  masthead.className = "export-sheet__masthead";
  appendText(masthead, "span", "RIFTVERSUS / ARCHIVE EXPORT", "export-sheet__eyebrow");
  appendText(masthead, "span", `PAGE ${page}/${pageCount}`, "export-sheet__page");
  root.append(masthead);

  const subjects = document.createElement("div");
  subjects.className = "export-sheet__subjects";
  const left = document.createElement("div");
  left.className = "export-sheet__subject";
  left.dataset.kind = initial.subjects.left.kind;
  left.append(createMedia(document, trustedMediaUrl(initial.mediaUrls.left, document), ""));
  appendText(left, "strong", initial.subjects.left.displayName);
  const score = document.createElement("div");
  score.className = "export-sheet__score";
  appendText(score, "span", "SERIES");
  appendText(score, "strong", `${initial.seriesSummary.wins} - ${initial.seriesSummary.losses}`);
  appendText(score, "small", `GAMES ${initial.gameSummary.wins} - ${initial.gameSummary.losses}`);
  const right = document.createElement("div");
  right.className = "export-sheet__subject export-sheet__subject--right";
  right.dataset.kind = initial.subjects.right.kind;
  right.append(createMedia(document, trustedMediaUrl(initial.mediaUrls.right, document), ""));
  appendText(right, "strong", initial.subjects.right.displayName);
  subjects.append(left, score, right);
  root.append(subjects);

  const metadata = document.createElement("div");
  metadata.className = "export-sheet__metadata";
  appendText(metadata, "span", `FILTERS ${filters(initial.query)}`);
  appendText(metadata, "span", `DATASET ${initial.dataset.version}`);
  appendText(metadata, "span", `GENERATED ${now.toISOString().replace("T", " ").replace(".000Z", " UTC")}`);
  root.append(metadata);

  const list = document.createElement("div");
  list.className = "export-sheet__rows";
  if (rows.length === 0) appendText(list, "p", "沒有符合目前篩選條件的對戰紀錄。", "export-sheet__empty");
  for (const row of rows) {
    const item = document.createElement("div");
    item.className = "export-sheet__row";
    appendText(item, "span", `${row.date} · ${row.event.name} · BO${row.bestOf}`);
    appendText(item, "strong", `${row.leftName} ${row.leftScore}:${row.rightScore} ${row.rightName}`);
    appendText(item, "span", row.winner === "left" ? "WIN" : "LOSS", row.winner === "left" ? "export-sheet__win" : "export-sheet__loss");
    list.append(item);
  }
  root.append(list);
  return root;
}

async function fetchAllRows(input: ExportInput): Promise<SeriesRow[]> {
  const rows = [...input.initial.rows];
  if (rows.length > EXPORT_ROW_CAP) throw new ExportLimitError();
  let cursor = input.initial.nextCursor;
  const visitedCursors = new Set<string>();

  while (cursor) {
    if (visitedCursors.has(cursor)) throw new Error("匯出資料分頁重複，請稍後重試。");
    visitedCursors.add(cursor);
    const page = await input.api.compare({ ...input.query, cursor });
    if (page.dataset.version !== input.initial.dataset.version) throw new Error("匯出資料集版本在分頁期間變更，請重新整理後重試。");
    if (!sameComparisonQuery(input.initial.query, page.query)) throw new Error("匯出篩選條件在分頁期間不一致，請重新整理後重試。");
    if (page.rows.length === 0 && page.nextCursor) throw new Error("匯出資料分頁未傳回紀錄卻要求繼續，請重新整理後重試。");
    rows.push(...page.rows);
    if (rows.length > EXPORT_ROW_CAP) throw new ExportLimitError();
    cursor = page.nextCursor;
  }
  return rows;
}

export async function exportComparison(input: ExportInput): Promise<ExportArtifact> {
  const document = input.document ?? window.document;
  const now = input.now ?? new Date();
  const rows = await fetchAllRows(input);
  const pages = partitionSeries(rows);
  const printablePages = pages.length === 0 ? [[]] : pages;
  const name = basename(input.initial);
  const images: Array<{ filename: string; blob: Blob }> = [];

  for (const [index, pageRows] of printablePages.entries()) {
    const root = renderExportPage(document, input.initial, pageRows, index + 1, printablePages.length, now);
    document.body.append(root);
    try {
      await waitForExportImages(root);
      const png = await toPng(root, {
        backgroundColor: "#0b1112",
        pixelRatio: EXPORT_PIXEL_RATIO,
        width: EXPORT_WIDTH,
        height: root.scrollHeight,
        style: { position: "static", left: "0", top: "0" },
        cacheBust: false,
        skipAutoScale: true,
      });
      images.push({ filename: pageFilename(name, index + 1), blob: dataUrlToBlob(png) });
    } finally {
      root.remove();
    }
  }

  if (images.length === 1) {
    const image = images[0]!;
    return { blob: image.blob, filename: `${name}.png`, kind: "png", pageCount: 1, rowCount: rows.length };
  }

  const zip = new JSZip();
  for (const image of images) zip.file(image.filename, image.blob);
  return {
    blob: await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } }),
    filename: `${name}.zip`,
    kind: "zip",
    pageCount: images.length,
    rowCount: rows.length,
  };
}

export function downloadExportArtifact(artifact: ExportArtifact, document = window.document): void {
  const url = URL.createObjectURL(artifact.blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = artifact.filename;
  anchor.style.display = "none";
  document.body.append(anchor);
  try {
    anchor.click();
  } finally {
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
