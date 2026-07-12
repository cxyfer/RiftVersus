import { Download, LoaderCircle } from "lucide-react";
import { useState } from "react";

import type { ComparisonQuery, ComparisonResponse } from "@riftversus/contracts";

import type { ComparisonApi } from "../../api/types.js";
import { downloadExportArtifact, exportComparison } from "./export-result.js";

export function ExportButton({ api, query, initial }: { api: Pick<ComparisonApi, "compare">; query: ComparisonQuery; initial: ComparisonResponse }) {
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const exportResult = async () => {
    if (status === "working") return;
    setStatus("working");
    setError(null);
    try {
      const artifact = await exportComparison({ api, query, initial });
      downloadExportArtifact(artifact);
      setStatus("done");
    } catch (reason) {
      setStatus("idle");
      setError(reason instanceof Error ? reason.message : "匯出失敗，請稍後重試。");
    }
  };

  return <div className="export-control">
    <button className="export-button" type="button" onClick={() => void exportResult()} disabled={status === "working"} aria-describedby={error ? "export-error" : "export-status"}>
      {status === "working" ? <LoaderCircle className="export-button__spinner" size={16} aria-hidden="true" /> : <Download size={16} aria-hidden="true" />}
      <span>{status === "working" ? "準備匯出" : "匯出 PNG / ZIP"}</span>
    </button>
    <p id="export-status" className="sr-only" aria-live="polite">{status === "working" ? "正在整理完整對戰紀錄並產生匯出檔。" : status === "done" ? "匯出檔已準備完成。" : ""}</p>
    {error && <p id="export-error" className="export-error" role="alert">{error}</p>}
  </div>;
}
