import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { App } from "./app.js";
import { SUBJECT_IDS } from "./model.js";

function renderApp(search = "") {
  window.history.replaceState({}, "", `/${search}`);
  return render(<App />);
}

describe("comparison workspace", () => {
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the series-first comparison result", async () => {
    renderApp();
    expect((await screen.findAllByText("World Championship")).length).toBeGreaterThan(0);
    expect(screen.getByText("3 series wins")).toBeInTheDocument();
    expect(screen.getByText("Games 9-3")).toBeInTheDocument();
  });

  it("selects a search result from the keyboard", async () => {
    const user = userEvent.setup();
    renderApp();
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "Faker");
    await screen.findByText("Faker");
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(window.location.search).toContain(`leftId=${SUBJECT_IDS.faker}`));
  });

  it("swaps both URL subjects", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(screen.getByRole("button", { name: "交換比較雙方" }));
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
    expect(container.querySelector(".avatar svg")).not.toBeNull();
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
});
