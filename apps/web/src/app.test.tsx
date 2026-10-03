import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mockApi } from "./api/mock-runtime.js";
import { App, optionLabel, optionSubtitle } from "./app.js";
import { defaultRouteState, SUBJECT_IDS, toContractQuery } from "./model.js";
import { UnknownPublicSubjectError } from "@riftversus/domain";

function renderApp(search = "", api = mockApi, onReload?: () => void) {
  window.history.replaceState({}, "", `/${search}`);
  return render(onReload === undefined ? <App api={api} /> : <App api={api} onReload={onReload} />);
}

describe("optionLabel", () => {
  it.each([
    [{ kind: "player", displayName: "Faker", realName: "Lee Sang-hyeok" }, "Faker (Lee Sang-hyeok)"],
    [{ kind: "player", displayName: "Caps" }, "Caps"],
    [{ kind: "player", displayName: "Caps", realName: "Caps" }, "Caps"],
    [{ kind: "team", displayName: "T1", realName: "Ignored" }, "T1"],
    [{ kind: "region", displayName: "LCK" }, "LCK"],
  ] as const)("formats typed subject presentation without parsing", (subject, expected) => {
    expect(optionLabel(subject)).toBe(expected);
  });
});

describe("optionSubtitle", () => {
  it.each([
    [{ kind: "player", subtitle: "選手" }, "選手"],
    [{ kind: "player", subtitle: "T1 · Mid" }, "T1 · Mid · 選手"],
    [{ kind: "team", subtitle: "Korea · Team" }, "Korea · Team · 戰隊"],
  ] as const)("deduplicates the kind label without dropping richer context", (option, expected) => {
    expect(optionSubtitle(option)).toBe(expected);
  });
});

describe("comparison workspace", () => {
  it("loads readable links, canonicalizes legacy links and preserves scope", async () => {
    const api = { ...mockApi, async resolveSubject(subject: Parameters<typeof mockApi.resolveSubject>[0]) {
      const id = subject.kind === "team" ? SUBJECT_IDS.t1 : SUBJECT_IDS.lpl;
      return { ...await mockApi.resolveSubject({ ...subject, id }), publicId: subject.kind === "team" ? "t1" : "lpl" };
    } };
    renderApp(`?leftKind=team&leftId=${SUBJECT_IDS.t1}&rightKind=region&rightId=${SUBJECT_IDS.lpl}&from=2020-01-01&to=2020-12-31`, api);
    await waitFor(() => expect(window.location.search).toContain("leftId=t1"));
    expect(window.location.search).toContain("rightId=lpl");
    expect(window.location.search).toContain("from=2020-01-01");
    expect(window.location.search).toContain("to=2020-12-31");
    await waitFor(() => expect(screen.getByRole("combobox", { name: "比較對象" })).toHaveValue("T1"));
  });
  it("keeps unknown readable IDs in the URL and presents recovery instead of unrelated results", async () => {
    renderApp("?leftKind=player&leftId=missing-player&rightKind=region&rightId=lpl", {
      ...mockApi, resolveSubject: async () => { throw new UnknownPublicSubjectError(); },
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("找不到指定的比較對象");
    expect(window.location.search).toContain("leftId=missing-player");
    expect(screen.queryByRole("region", { name: "比較摘要" })).not.toBeInTheDocument();
  });
  it("retains selected player presentation after converting its picked UUID to a public ID", async () => {
    const api = { ...mockApi, async resolveSubject(subject: Parameters<typeof mockApi.resolveSubject>[0]) {
      const id = subject.kind === "player" ? SUBJECT_IDS.faker : subject.kind === "team" ? SUBJECT_IDS.t1 : SUBJECT_IDS.lpl;
      return { ...await mockApi.resolveSubject({ ...subject, id }), publicId: subject.kind === "player" ? "faker" : subject.kind === "team" ? "t1" : "lpl" };
    } };
    const user = userEvent.setup();
    renderApp("?from=2015-01-01&to=2026-12-30", api);
    await screen.findAllByText("World Championship");
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input); await user.type(input, "Faker");
    await user.click(await screen.findByRole("option", { name: /Faker \(Lee Sang-hyeok\)/ }));
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    await waitFor(() => expect(window.location.search).toContain("leftId=faker"));
    await user.click(input); await user.tab();
    expect(input).toHaveValue("Faker (Lee Sang-hyeok)");
    expect(input.closest(".entity-input")?.querySelector("img")).toHaveAttribute("src", (await mockApi.resolveSubject({ kind: "player", id: SUBJECT_IDS.faker })).mediaUrl);
  });
  beforeEach(() => localStorage.clear());
  afterEach(cleanup);

  it("shows the series-first comparison result", async () => {
    renderApp();
    expect((await screen.findAllByText("World Championship")).length).toBeGreaterThan(0);
    expect(screen.getByText(/3 series wins/)).toBeInTheDocument();
    expect(screen.getByText(/Games 9-3/)).toBeInTheDocument();
  });

  it("offers a page reload when comparison data cannot be loaded", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    const compare = vi.fn(async () => { throw new Error("snapshot unavailable"); });
    renderApp(`?leftKind=team&leftId=${SUBJECT_IDS.t1}&rightKind=region&rightId=${SUBJECT_IDS.lpl}&from=2020-01-01&to=2020-12-31`, { ...mockApi, compare }, reload);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("資料目前無法取得");
    expect(alert).toHaveTextContent("請重新載入頁面以重試");
    await user.click(within(alert).getByRole("button", { name: "重新載入資料" }));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("keeps selected subjects in the summary while rows show historical teams", async () => {
    renderApp(`?leftKind=player&leftId=${SUBJECT_IDS.faker}&rightKind=region&rightId=${SUBJECT_IDS.lpl}`);
    const summary = within(await screen.findByRole("region", { name: "比較摘要" }));
    expect(summary.getByText("Faker")).toBeInTheDocument();
    expect(summary.getByText("LPL")).toBeInTheDocument();
    const table = within(screen.getByRole("table", { name: "對戰紀錄" }));
    const rows = table.getAllByRole("row").slice(1);
    expect(rows[0]).toHaveTextContent("T1 3:1 Weibo Gaming");
    expect(rows[1]).toHaveTextContent("T1 3:0 Bilibili Gaming");
    expect(table.queryByText(/Faker/)).not.toBeInTheDocument();
    expect(table.queryByText(/LPL/)).not.toBeInTheDocument();
  });

  it("selects a search result from the keyboard", async () => {
    const user = userEvent.setup();
    renderApp();
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "Faker");
    await screen.findByText("Faker (Lee Sang-hyeok)", {}, { timeout: 1_000 });
    expect(input).toHaveAttribute("aria-autocomplete", "list");
    expect(input).toHaveAttribute("aria-activedescendant");
    const activeOption = document.getElementById(input.getAttribute("aria-activedescendant")!);
    expect(activeOption).toHaveAttribute("role", "option");
    expect(activeOption?.querySelector("button")).toBeNull();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(input).toHaveValue("Faker (Lee Sang-hyeok)");
    expect(window.location.search).not.toContain(`leftId=${SUBJECT_IDS.faker}`);
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    await waitFor(() => expect(window.location.search).toContain(`leftId=${SUBJECT_IDS.faker}`));
    const summary = within(await screen.findByRole("region", { name: "比較摘要" }));
    expect(summary.getByText("Faker")).toBeInTheDocument();
    expect(summary.queryByText(/Lee Sang-hyeok/)).not.toBeInTheDocument();
  });

  it("selects a search result with the mouse before updating the query identity", async () => {
    const compare = vi.fn(mockApi.compare);
    const user = userEvent.setup();
    renderApp("", { ...mockApi, compare });
    await screen.findAllByText("World Championship");
    compare.mockClear();
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "Faker");
    const option = await screen.findByRole("option", { name: /Faker \(Lee Sang-hyeok\)/ }, { timeout: 1_000 });
    await user.click(option);
    expect(input).toHaveValue("Faker (Lee Sang-hyeok)");
    await user.click(screen.getByRole("button", { name: "Worlds" }));
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    await waitFor(() => expect(compare).toHaveBeenLastCalledWith(expect.objectContaining({
      left: { kind: "player", id: SUBJECT_IDS.faker },
      eventCategories: [],
    })));
  });

  it("restores the selected subject when free text loses focus", async () => {
    const user = userEvent.setup();
    renderApp();
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "unselected text");
    await user.tab();
    expect(input).toHaveValue("T1");
  });

  it("restores free text before Apply and submits the selected identities", async () => {
    const compare = vi.fn(mockApi.compare);
    const user = userEvent.setup();
    renderApp("", { ...mockApi, compare });
    await screen.findAllByText("World Championship");
    compare.mockClear();
    const left = screen.getByRole("combobox", { name: "比較對象" });
    const right = screen.getByRole("combobox", { name: "對戰對象" });
    await user.click(screen.getByRole("button", { name: "聯賽" }));
    await user.click(right);
    await user.type(right, "not an explicit selection");
    await user.click(screen.getByRole("button", { name: "套用篩選" }));
    expect(left).toHaveValue("T1");
    expect(right).toHaveValue("LPL");
    await waitFor(() => expect(compare).toHaveBeenLastCalledWith(expect.objectContaining({
      left: { kind: "team", id: SUBJECT_IDS.t1 },
      right: { kind: "region", id: SUBJECT_IDS.lpl },
      eventCategories: ["league", "worlds"],
    })));
  });

  it("does not submit the comparison form when Enter has no search option", async () => {
    const compare = vi.fn(mockApi.compare);
    const user = userEvent.setup();
    renderApp("", { ...mockApi, compare });
    await screen.findAllByText("World Championship");
    compare.mockClear();
    await user.click(screen.getByRole("button", { name: "Worlds" }));
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "no-match");
    await screen.findByText("沒有符合的對象", {}, { timeout: 1_000 });
    await user.keyboard("{Enter}");
    expect(window.location.search).toContain("events=worlds");
    expect(compare).not.toHaveBeenCalled();
  });

  it("clears the active descendant when Escape closes a populated listbox", async () => {
    const user = userEvent.setup();
    renderApp();
    const input = screen.getByRole("combobox", { name: "比較對象" });
    await user.click(input);
    await user.type(input, "Faker");
    await screen.findByText("Faker (Lee Sang-hyeok)", {}, { timeout: 1_000 });
    expect(input).toHaveAttribute("aria-activedescendant");
    await user.keyboard("{Escape}");
    expect(input).not.toHaveAttribute("aria-activedescendant");
    expect(screen.queryByRole("option")).not.toBeInTheDocument();
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
    localStorage.setItem("riftversus.playwright-fixture", "long");
    const compare = vi.fn(async (query: Parameters<typeof mockApi.compare>[0]) => {
      localStorage.setItem("riftversus.playwright-fixture", "long");
      return mockApi.compare(query);
    });
    const user = userEvent.setup();
    renderApp(`?leftKind=team&leftId=${SUBJECT_IDS.t1}&rightKind=region&rightId=${SUBJECT_IDS.lpl}&from=2019-01-02&to=2026-12-31&events=worlds&bestOf=5`, { ...mockApi, compare });
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(51));
    await user.click(screen.getByRole("button", { name: "載入更多" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(101));
    await user.click(screen.getByRole("button", { name: "載入更多" }));
    await waitFor(() => expect(screen.getAllByRole("row")).toHaveLength(102));
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(101);
    expect(new Set(rows.map((row) => row.textContent)).size).toBe(101);
    await waitFor(() => expect(screen.queryByRole("button", { name: "載入更多" })).not.toBeInTheDocument());
    expect(compare).toHaveBeenCalledTimes(3);
  });

  it("paginates the 101-row mock in stable 50/50/1 pages", async () => {
    localStorage.setItem("riftversus.playwright-fixture", "long");
    const query = toContractQuery(defaultRouteState);
    const first = await mockApi.compare(query);
    const second = await mockApi.compare({ ...query, cursor: first.nextCursor });
    const third = await mockApi.compare({ ...query, cursor: second.nextCursor });
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([50, 50, 1]);
    expect(first.nextCursor).toBeDefined();
    expect(second.nextCursor).toBeDefined();
    expect(third.nextCursor).toBeUndefined();
    const rows = [...first.rows, ...second.rows, ...third.rows];
    expect(new Set(rows.map((row) => row.id)).size).toBe(101);
    expect(rows).toEqual([...rows].sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id)));
  });

  it("rejects unknown or mismatched mock subject identities", async () => {
    const query = toContractQuery(defaultRouteState);
    await expect(mockApi.compare({ ...query, left: { kind: "player", id: SUBJECT_IDS.t1 } })).rejects.toThrow(/Unknown player subject/);
    await expect(mockApi.compare({ ...query, right: { kind: "region", id: "99999999-9999-4999-8999-999999999999" } })).rejects.toThrow(/Unknown region subject/);
  });

  it("replaces invalid route state with a canonical usable query", async () => {
    renderApp("?leftKind=team&leftId=invalid&rightKind=team&rightId=invalid");
    await screen.findAllByText("World Championship");
    expect(window.location.search).toContain(`leftId=${SUBJECT_IDS.t1}`);
  });
});
