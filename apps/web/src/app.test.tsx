import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi } from "./api/mock-runtime.js";
import { App } from "./app.js";
import { SUBJECT_IDS } from "./model.js";

function renderApp(search = "", api = mockApi) {
  window.history.replaceState({}, "", `/${search}`);
  return render(<App api={api} />);
}

describe("comparison workspace", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the series-first comparison result", async () => {
    renderApp();
    expect((await screen.findAllByText("World Championship")).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 series wins/)).toBeInTheDocument();
    expect(screen.getByText(/Games 9-3/)).toBeInTheDocument();
  });

  it("selects a search result from the keyboard", async () => {
    const user = userEvent.setup();
    renderApp();
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "Faker");
    await screen.findByText("Faker", {}, { timeout: 1_000 });
    await user.keyboard("{ArrowDown}{Enter}");
    expect(window.location.search).not.toContain(`leftId=${SUBJECT_IDS.faker}`);
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    await waitFor(() => expect(window.location.search).toContain(`leftId=${SUBJECT_IDS.faker}`));
  });

  it("swaps both URL subjects", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "交換比較雙方" }));
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    await waitFor(() => {
      expect(window.location.search).toContain(`leftId=${SUBJECT_IDS.lpl}`);
      expect(window.location.search).toContain(`rightId=${SUBJECT_IDS.t1}`);
    });
  });

  it("uses a neutral fallback after an image error", async () => {
    const { container } = renderApp();
    await screen.findAllByText("World Championship");
    const image = container.querySelector(".avatar img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(image).toHaveAttribute("src", "/media-placeholder.svg");
  });

  it("saves, loads, and removes a comparison", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByText("World Championship");
    await user.click(screen.getByRole("button", { name: "保存目前比較" }));
    await user.click(screen.getByRole("button", { name: "查看保存結果" }));
    expect(screen.getByText("T1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /刪除 T1 與 LPL/ }));
    expect(screen.getByText("目前沒有保存的比較。")).toBeInTheDocument();
  });

  it("applies draft filters to the adapter and shows an empty result", async () => {
    const compare = vi.fn(mockApi.compare);
    const user = userEvent.setup();
    renderApp("", { ...mockApi, compare });
    await screen.findAllByText("World Championship");
    await user.click(screen.getByRole("button", { name: "Worlds" }));
    await user.click(screen.getByRole("button", { name: "聯賽" }));
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    expect(await screen.findByText("沒有符合目前篩選條件的對戰紀錄。")).toBeInTheDocument();
    expect(window.location.search).toContain("events=league");
    await waitFor(() => expect(compare).toHaveBeenLastCalledWith(expect.objectContaining({ eventCategories: ["league"] })));
  });

  it("loads subsequent cursor pages", async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findAllByText("World Championship");
    await user.click(screen.getByRole("button", { name: "載入更多" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(4));
  });

  it("replaces invalid route state with a canonical usable query", async () => {
    renderApp("?leftKind=team&leftId=invalid&rightKind=team&rightId=invalid");
    await screen.findAllByText("World Championship");
    expect(window.location.search).toContain(`leftId=${SUBJECT_IDS.t1}`);
  });
});
