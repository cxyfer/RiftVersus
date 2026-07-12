import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { ComparisonQuery, ComparisonResponse } from "@riftversus/contracts";

import { ExportButton } from "./ExportButton.js";

const mocks = vi.hoisted(() => ({
  exportComparison: vi.fn(),
  downloadExportArtifact: vi.fn(),
}));

vi.mock("./export-result.js", () => ({
  exportComparison: mocks.exportComparison,
  downloadExportArtifact: mocks.downloadExportArtifact,
}));

const query = {
  left: { kind: "team", id: "11111111-1111-4111-8111-111111111111" },
  right: { kind: "region", id: "77777777-7777-4777-7777-777777777777" },
  eventCategories: [], leagues: [], bestOf: [], tournamentIds: [], limit: 50,
} as unknown as ComparisonQuery;
const initial = { query } as ComparisonResponse;

describe("ExportButton", () => {
  it("disables a duplicate export while retaining an accessible progress status", async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocks.exportComparison.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const user = userEvent.setup();
    render(<ExportButton api={{ compare: vi.fn() }} query={query} initial={initial} />);

    const button = screen.getByRole("button", { name: "匯出 PNG / ZIP" });
    await user.click(button);
    expect(button).toBeDisabled();
    expect(screen.getByText("正在整理完整對戰紀錄並產生匯出檔。")).toHaveAttribute("aria-live", "polite");
    await user.click(button);
    expect(mocks.exportComparison).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ blob: new Blob(["png"]), filename: "result.png", kind: "png", pageCount: 1, rowCount: 1 }); });
  });

  it("shows an export failure through an alert", async () => {
    mocks.exportComparison.mockRejectedValueOnce(new Error("超過 1,000 筆"));
    const user = userEvent.setup();
    render(<ExportButton api={{ compare: vi.fn() }} query={query} initial={initial} />);

    await user.click(screen.getByRole("button", { name: "匯出 PNG / ZIP" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("超過 1,000 筆");
  });
});
