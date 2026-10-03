import type { PublicSnapshot } from "@riftversus/contracts";

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

export function renderMediaCredits(snapshot: Omit<PublicSnapshot, "snapshotId">, basePath: string): string {
  const groups = new Map<string, NonNullable<PublicSnapshot["attribution"]>>();
  for (const item of snapshot.attribution ?? []) {
    const key = JSON.stringify([item.objectKey, item.sourceUrl, item.rightsBasis?.sourcePageUrl]);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const rows = [...groups.values()].map(items => {
    const item = items[0]!;
    const entities = snapshot.entities.filter(entity => entity.retainedObjectKey === item.objectKey && items.some(credit =>
      credit.entityId === undefined && credit.teamEraId === undefined
        || (credit.teamEraId === undefined ? entity.id === credit.entityId && entity.teamEraId === undefined : entity.teamEraId === credit.teamEraId)));
    if (entities.length === 0) return "";
    const labels = [...new Set(entities.map(entity => entity.displayName))].join(" / ");
    const source = item.rightsBasis?.sourcePageUrl ?? item.sourceUrl;
    if (new URL(source).protocol !== "https:") throw new Error("Image credit source must use HTTPS.");
    return `<article><img loading="lazy" src="${escapeHtml(entities[0]!.mediaUrl)}" alt="${escapeHtml(labels)}"><div><h2>${escapeHtml(labels)}</h2><p>${escapeHtml(item.attribution)}</p><p>${escapeHtml(item.rightsBasis?.statement ?? item.license!)}</p>${item.rightsBasis ? `<p>非商業賽事資料展示；未宣稱取得再散布授權。來源版本 ${item.rightsBasis.revisionId}。</p>` : ""}<a href="${escapeHtml(source)}" rel="noreferrer">原始圖片頁</a></div></article>`;
  }).join("\n");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>圖片來源 - RiftVersus</title><style>body{margin:0;background:#f6f8fa;color:#1f2328;font:16px/1.6 system-ui,sans-serif}main{max-width:960px;margin:auto;padding:24px}a{color:#0969da}article{display:flex;gap:20px;padding:20px 0;border-bottom:1px solid #d0d7de}img{width:112px;height:144px;object-fit:contain;flex-shrink:0}h1{font-size:28px}h2{font-size:18px;margin:0}p{margin:8px 0;overflow-wrap:anywhere}@media(max-width:480px){main{padding:16px}article{gap:12px}img{width:72px;height:96px}}</style><main><a href="${escapeHtml(basePath)}">RiftVersus</a><h1>圖片來源與權利聲明</h1><p>圖片用於辨識賽事中的選手與戰隊；商標、肖像與照片權利屬於各自權利人。圖片來源或移除事宜請<a href="https://github.com/cxyfer" rel="noreferrer">聯絡維護者</a>。</p>${rows || "<p>目前沒有已發布的真實圖片。</p>"}</main></html>`;
}
