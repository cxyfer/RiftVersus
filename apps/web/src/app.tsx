import { useEffect, useId, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { BrowserRouter, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Bookmark, CalendarDays, Check, ChevronDown, Database, ImageOff, Search, Trash2, Trophy, X } from "lucide-react";
import type { BestOf, ComparisonResponse, EntityKind, EventCategory } from "@riftversus/contracts";

import { ENTITY_OPTIONS, getComparison, searchEntities, type EntityOption } from "./mock-api.js";
import { parseRouteState, serializeRouteState, swapRouteState, toContractQuery, type ComparisonRouteState, type LeagueCode } from "./model.js";
import { loadSavedComparisons, removeSavedComparison, saveComparison, type SavedComparison } from "./storage.js";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });

const kindLabel: Record<EntityKind, string> = { player: "選手", team: "戰隊", region: "賽區" };
const eventOptions: Array<[EventCategory, string]> = [["league", "聯賽"], ["fst", "FST"], ["msi", "MSI"], ["worlds", "Worlds"]];
const leagueOptions: LeagueCode[] = ["LCK", "LPL", "LEC", "LCS"];
const bestOfOptions: BestOf[] = [1, 3, 5];

function Avatar({ src, name, size = "normal" }: { src: string | undefined; name: string; size?: "normal" | "large" }) {
  const [failed, setFailed] = useState(false);
  return (
    <span className={`avatar avatar--${size}`} aria-label={`${name} 頭像`}>
      {!failed && src ? <img src={src} alt="" onError={() => setFailed(true)} /> : <ImageOff aria-hidden="true" />}
    </span>
  );
}

function EntityCombobox({ value, onPick, label }: { value: EntityOption; onPick: (option: EntityOption) => void; label: string }) {
  const inputId = useId();
  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const search = useQuery({ queryKey: ["entities", term], queryFn: () => searchEntities(term, []), enabled: open });
  const options = search.data ?? [];
  const pick = (option: EntityOption) => {
    onPick(option);
    setTerm("");
    setOpen(false);
    setActive(0);
  };
  return (
    <div className="entity-combobox">
      <label htmlFor={inputId}>{label}</label>
      <div className="entity-input">
        <Avatar src={value.mediaUrl} name={value.displayName} />
        <input
          id={inputId}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${inputId}-options`}
          value={open ? term : value.displayName}
          onFocus={() => { setOpen(true); setTerm(""); }}
          onChange={(event) => { setTerm(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={(event) => {
            if (!open) return;
            if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => Math.min(current + 1, Math.max(options.length - 1, 0))); }
            if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
            if (event.key === "Enter" && options[active]) { event.preventDefault(); pick(options[active]); }
            if (event.key === "Escape") setOpen(false);
          }}
        />
        <Search aria-hidden="true" size={16} />
      </div>
      {open && (
        <ul id={`${inputId}-options`} className="entity-options" role="listbox" aria-label={`${label} 搜尋結果`}>
          {search.isLoading && <li className="entity-empty">搜尋中</li>}
          {!search.isLoading && options.map((option, index) => (
            <li key={option.id} role="option" aria-selected={index === active} className={index === active ? "is-active" : ""}>
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(option)}>
                <Avatar src={option.mediaUrl} name={option.displayName} />
                <span><strong>{option.displayName}</strong><small>{option.subtitle} · {kindLabel[option.kind]}</small></span>
              </button>
            </li>
          ))}
          {!search.isLoading && options.length === 0 && <li className="entity-empty">沒有符合的對象</li>}
        </ul>
      )}
    </div>
  );
}

function ToggleGroup<T extends string | number>({ label, values, selected, onChange, format }: { label: string; values: readonly T[]; selected: T[]; onChange: (values: T[]) => void; format: (value: T) => string }) {
  const toggle = (value: T) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  return <fieldset className="toggle-group"><legend>{label}</legend><div>{values.map((value) => <button key={String(value)} type="button" className={selected.includes(value) ? "selected" : ""} aria-pressed={selected.includes(value)} onClick={() => toggle(value)}>{format(value)}{selected.includes(value) && <Check size={13} aria-hidden="true" />}</button>)}</div></fieldset>;
}

function Summary({ result }: { result: ComparisonResponse }) {
  const series = result.seriesSummary;
  const games = result.gameSummary;
  return (
    <section className="result-summary" aria-label="比較摘要">
      <div className="subject subject--left"><Avatar src={result.mediaUrls.left} name={result.subjects.left.displayName} size="large" /><strong>{result.subjects.left.displayName}</strong><span>{series.wins} series wins</span></div>
      <div className="scoreboard"><span>Series</span><strong>{series.wins}<i>-</i>{series.losses}</strong><small>Games {games.wins}-{games.losses}</small></div>
      <div className="subject subject--right"><Avatar src={result.mediaUrls.right} name={result.subjects.right.displayName} size="large" /><strong>{result.subjects.right.displayName}</strong><span>{series.losses} series wins</span></div>
    </section>
  );
}

function Results({ result, onMore, loadingMore }: { result: ComparisonResponse; onMore: () => void; loadingMore: boolean }) {
  return <section className="results" aria-live="polite">
    <div className="result-meta"><span className="chip"><Database size={14} /> {result.dataset.version}</span><span className="chip"><CalendarDays size={14} /> {result.dataset.coverage.from} - {result.dataset.coverage.to}</span><span className="chip chip--good">fresh {new Date(result.dataset.lastSuccessfulSyncAt).toLocaleDateString("en-CA")}</span></div>
    {result.coverageWarnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
    <div className="match-table" role="table" aria-label="對戰紀錄">
      <div className="match-head" role="row"><span>日期 / 賽事</span><span>系列賽</span><span>結果</span></div>
      {result.rows.map((row) => <div className="match-row" role="row" key={row.id}><span><strong>{row.event.name}</strong><small>{row.date} · BO{row.bestOf}</small></span><span>{row.leftName} <b>{row.leftScore}:{row.rightScore}</b> {row.rightName}</span><span className={row.winner === "left" ? "outcome win" : "outcome loss"}>{row.winner === "left" ? "WIN" : "LOSS"}</span></div>)}
    </div>
    {result.nextCursor && <button className="load-more" type="button" onClick={onMore} disabled={loadingMore}>{loadingMore ? "載入中" : "載入更多"}<ChevronDown size={16} aria-hidden="true" /></button>}
  </section>;
}

function SavedDrawer({ items, onLoad, onRemove, onClose }: { items: SavedComparison[]; onLoad: (state: ComparisonRouteState) => void; onRemove: (id: string) => void; onClose: () => void }) {
  return <aside className="saved-drawer" aria-label="已保存結果"><div className="drawer-heading"><h2>保存結果</h2><button type="button" className="icon-button" onClick={onClose} aria-label="關閉保存結果" title="關閉"><X size={18} /></button></div>{items.length === 0 ? <p className="empty-state">目前沒有保存的比較。</p> : <ul>{items.map((item) => {
    const left = ENTITY_OPTIONS.find((entity) => entity.id === item.state.leftId)?.displayName ?? "未知對象";
    const right = ENTITY_OPTIONS.find((entity) => entity.id === item.state.rightId)?.displayName ?? "未知對象";
    return <li key={item.id}><button type="button" className="saved-load" onClick={() => onLoad(item.state)}>{left} <ArrowLeftRight size={13} /> {right}<small>{new Date(item.createdAt).toLocaleDateString("zh-TW")}</small></button><button type="button" className="icon-button" onClick={() => onRemove(item.id)} aria-label={`刪除 ${left} 與 ${right} 的保存結果`} title="刪除"><Trash2 size={16} /></button></li>;
  })}</ul>}</aside>;
}

function ComparisonWorkspace() {
  const [params, setParams] = useSearchParams();
  const parsed = useMemo(() => parseRouteState(params), [params]);
  const state = parsed.state;
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState(() => loadSavedComparisons());
  const [extraRows, setExtraRows] = useState<ComparisonResponse["rows"]>([]);
  const mainQuery = useQuery({ queryKey: ["comparison", serializeRouteState(state).toString()], queryFn: () => { toContractQuery(state); return getComparison(state); } });
  const write = (next: ComparisonRouteState, replace = false) => { setExtraRows([]); setParams(serializeRouteState(next), { replace }); };
  useEffect(() => { if (parsed.recovered || params.toString() !== serializeRouteState(state).toString()) write(state, true); }, [parsed.recovered, params, state]);
  const optionFor = (id: string) => ENTITY_OPTIONS.find((entity) => entity.id === id) ?? ENTITY_OPTIONS[0]!;
  const result = mainQuery.data ? { ...mainQuery.data, rows: [...mainQuery.data.rows, ...extraRows], nextCursor: extraRows.length ? undefined : mainQuery.data.nextCursor } : undefined;
  const mutate = (update: Partial<ComparisonRouteState>) => write({ ...state, ...update });
  const save = () => setSaved(saveComparison(state));
  const load = (next: ComparisonRouteState) => { write(next); setSavedOpen(false); };
  const more = async () => { if (!mainQuery.data?.nextCursor) return; const page = await getComparison(state, mainQuery.data.nextCursor); setExtraRows(page.rows); };
  return <main className="terminal-shell">
    <header className="topbar"><a className="wordmark" href="/" aria-label="RiftVersus 首頁"><span>RIFT</span><b>VERSUS</b></a><div className="topbar-actions"><span className="dataset-status"><i />資料已發布</span><button type="button" className="icon-button" onClick={save} aria-label="保存目前比較" title="保存目前比較"><Bookmark size={18} /></button><button type="button" className="icon-button" onClick={() => setSavedOpen(true)} aria-label="查看保存結果" title="保存結果"><Trophy size={18} /></button></div></header>
    <section className="compare-panel" aria-label="比較條件">
      <div className="panel-heading"><p>HEAD-TO-HEAD ARCHIVE</p><h1>賽事對戰紀錄</h1></div>
      <div className="subject-grid">
        <EntityCombobox label="比較對象" value={optionFor(state.leftId)} onPick={(entity) => {
          const next = { ...state, leftKind: entity.kind, leftId: entity.id };
          delete next.leftEraId;
          write(next);
        }} />
        <button className="swap-button" type="button" onClick={() => write(swapRouteState(state))} aria-label="交換比較雙方" title="交換比較雙方"><ArrowLeftRight size={19} /></button>
        <EntityCombobox label="對戰對象" value={optionFor(state.rightId)} onPick={(entity) => {
          const next = { ...state, rightKind: entity.kind, rightId: entity.id };
          delete next.rightEraId;
          write(next);
        }} />
      </div>
      <div className="filters">
        <label className="date-field"><span>起始日期</span><input type="date" value={state.from ?? ""} onChange={(event) => {
          if (event.target.value) mutate({ from: event.target.value });
          else { const next = { ...state }; delete next.from; write(next); }
        }} /></label>
        <label className="date-field"><span>結束日期</span><input type="date" value={state.to ?? ""} onChange={(event) => {
          if (event.target.value) mutate({ to: event.target.value });
          else { const next = { ...state }; delete next.to; write(next); }
        }} /></label>
        <ToggleGroup label="賽事類型" values={eventOptions.map(([value]) => value)} selected={state.events} onChange={(values) => mutate({ events: values })} format={(value) => eventOptions.find(([item]) => item === value)?.[1] ?? value} />
        <ToggleGroup label="聯賽" values={leagueOptions} selected={state.leagues} onChange={(values) => mutate({ leagues: values })} format={(value) => value} />
        <ToggleGroup label="賽制" values={bestOfOptions} selected={state.bestOf} onChange={(values) => mutate({ bestOf: values })} format={(value) => `BO${value}`} />
      </div>
    </section>
    {mainQuery.isLoading && <section className="loading">正在彙整對戰紀錄</section>}
    {mainQuery.isError && <section className="loading">資料目前無法取得</section>}
    {result && <><Summary result={result} /><Results result={result} onMore={() => void more()} loadingMore={false} /></>}
    {savedOpen && <SavedDrawer items={saved} onLoad={load} onRemove={(id) => setSaved(removeSavedComparison(id))} onClose={() => setSavedOpen(false)} />}
  </main>;
}

export function App() {
  return <QueryClientProvider client={queryClient}><BrowserRouter><ComparisonWorkspace /></BrowserRouter></QueryClientProvider>;
}
