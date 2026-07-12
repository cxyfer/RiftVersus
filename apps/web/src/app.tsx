import { useEffect, useId, useMemo, useState } from "react";
import { QueryClient, QueryClientProvider, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { BrowserRouter, useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Bookmark, CalendarDays, Check, ChevronDown, Database, Search, Trophy, Trash2, X } from "lucide-react";
import type { BestOf, ComparisonResponse, EntityKind, EventCategory, ResolvedSubject } from "@riftversus/contracts";

import { api as runtimeApi } from "@riftversus/api-runtime";
import { ExportButton } from "./features/export/ExportButton.js";
import { parseRouteState, serializeRouteState, swapRouteState, toContractQuery, type ComparisonRouteState, type LeagueCode } from "./model.js";
import { loadSavedComparisons, removeSavedComparison, saveComparison, type SavedComparison } from "./storage.js";
import type { ComparisonApi, EntityOption } from "./api/types.js";

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 5_000 } } });
const placeholderMedia = "/media-placeholder.svg";
const kindLabel: Record<EntityKind, string> = { player: "選手", team: "戰隊", region: "賽區" };
const eventOptions: Array<[EventCategory, string]> = [["league", "聯賽"], ["fst", "FST"], ["msi", "MSI"], ["worlds", "Worlds"]];
const leagueOptions: LeagueCode[] = ["lck", "lpl", "lec", "lcs"];
const bestOfOptions: BestOf[] = [1, 3, 5];

function subjectOption(subject: ResolvedSubject): EntityOption {
  return { ...subject, subtitle: kindLabel[subject.kind] };
}

function unknownOption(kind: EntityKind, id: string): EntityOption {
  return { kind, id, displayName: id.slice(0, 8), subtitle: kindLabel[kind] };
}

function Avatar({ src, name, size = "normal" }: { src: string | undefined; name: string; size?: "normal" | "large" }) {
  const [imageSrc, setImageSrc] = useState(src || placeholderMedia);
  useEffect(() => setImageSrc(src || placeholderMedia), [src]);
  return <span className={`avatar avatar--${size}`} aria-label={`${name} 頭像`}><img src={imageSrc} alt="" onError={() => { if (imageSrc !== placeholderMedia) setImageSrc(placeholderMedia); }} /></span>;
}

function EntityCombobox({ value, onPick, label, api }: { value: EntityOption; onPick: (option: EntityOption) => void; label: string; api: ComparisonApi }) {
  const inputId = useId();
  const [term, setTerm] = useState("");
  const [debouncedTerm, setDebouncedTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedTerm(term), 220); return () => window.clearTimeout(timer); }, [term]);
  const search = useQuery({ queryKey: ["entities", debouncedTerm], queryFn: () => api.searchEntities(debouncedTerm, []), enabled: open && debouncedTerm.trim().length > 0 });
  const options = search.data ?? [];
  const activeOptionId = open && debouncedTerm && options[active] ? `${inputId}-option-${active}` : undefined;
  const pick = (option: EntityOption) => { onPick(option); setTerm(""); setDebouncedTerm(""); setOpen(false); setActive(0); };
  return <div className="entity-combobox">
    <label htmlFor={inputId}>{label}</label>
    <div className="entity-input"><Avatar src={value.mediaUrl} name={value.displayName} /><input id={inputId} role="combobox" aria-expanded={open} aria-controls={`${inputId}-options`} aria-activedescendant={activeOptionId} value={open ? term : value.displayName} onFocus={() => { setOpen(true); setTerm(""); }} onChange={(event) => { setTerm(event.target.value); setOpen(true); setActive(0); }} onKeyDown={(event) => {
      if (!open) return;
      if (event.key === "ArrowDown") { event.preventDefault(); setActive((current) => Math.min(current + 1, Math.max(options.length - 1, 0))); }
      if (event.key === "ArrowUp") { event.preventDefault(); setActive((current) => Math.max(current - 1, 0)); }
      if (event.key === "Enter") { event.preventDefault(); if (options[active]) pick(options[active]); }
      if (event.key === "Escape") setOpen(false);
    }} /><Search aria-hidden="true" size={16} /></div>
    {open && <ul id={`${inputId}-options`} className="entity-options" role="listbox" aria-label={`${label} 搜尋結果`}>
      {search.isLoading && <li className="entity-empty">搜尋中</li>}
      {!search.isLoading && debouncedTerm && options.map((option, index) => <li id={`${inputId}-option-${index}`} key={option.id} role="option" aria-selected={index === active} className={index === active ? "is-active" : ""}><button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => pick(option)}><Avatar src={option.mediaUrl} name={option.displayName} /><span><strong>{option.displayName}</strong><small>{option.subtitle} · {kindLabel[option.kind]}</small></span></button></li>)}
      {!search.isLoading && debouncedTerm && options.length === 0 && <li className="entity-empty">沒有符合的對象</li>}
    </ul>}
  </div>;
}

function ToggleGroup<T extends string | number>({ label, values, selected, onChange, format }: { label: string; values: readonly T[]; selected: T[]; onChange: (values: T[]) => void; format: (value: T) => string }) {
  const toggle = (value: T) => onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  return <fieldset className="toggle-group"><legend>{label}</legend><div>{values.map((value) => <button key={String(value)} type="button" className={selected.includes(value) ? "selected" : ""} aria-pressed={selected.includes(value)} onClick={() => toggle(value)}>{format(value)}{selected.includes(value) && <Check size={13} aria-hidden="true" />}</button>)}</div></fieldset>;
}

function Summary({ result }: { result: ComparisonResponse }) {
  const series = result.seriesSummary; const games = result.gameSummary;
  return <section className="result-summary" aria-label="比較摘要"><div className="subject subject--left"><Avatar src={result.mediaUrls.left} name={result.subjects.left.displayName} size="large" /><div><strong>{result.subjects.left.displayName}</strong><span>{series.wins} series wins · {(series.winRate * 100).toFixed(0)}%</span></div></div><div className="scoreboard"><span>Series</span><strong>{series.wins}<i>-</i>{series.losses}</strong><small>Games {games.wins}-{games.losses} · {(games.winRate * 100).toFixed(0)}%</small></div><div className="subject subject--right"><Avatar src={result.mediaUrls.right} name={result.subjects.right.displayName} size="large" /><div><strong>{result.subjects.right.displayName}</strong><span>{series.losses} series wins</span></div></div></section>;
}

function Results({ result, onMore, loadingMore }: { result: ComparisonResponse; onMore: () => void; loadingMore: boolean }) {
  const activeFilters = [...result.query.eventCategories.map((item) => item.toUpperCase()), ...result.query.leagues.map((item) => item.toUpperCase()), ...result.query.bestOf.map((item) => `BO${item}`)];
  return <section className="results" aria-live="polite"><div className="result-meta"><span className="chip"><Database size={14} /> {result.dataset.version}</span><span className="chip"><CalendarDays size={14} /> {result.dataset.coverage.from} - {result.dataset.coverage.to}</span><span className="chip chip--good">fresh {new Date(result.dataset.lastSuccessfulSyncAt).toLocaleDateString("en-CA")}</span>{activeFilters.map((filter) => <span className="chip chip--active" key={filter}>{filter}</span>)}</div>{result.coverageWarnings.map((warning) => <p className="warning" key={warning.code}>{warning.message}</p>)}
    {result.rows.length === 0 ? <div className="empty-state result-empty">沒有符合目前篩選條件的對戰紀錄。</div> : <div className="match-table" role="table" aria-label="對戰紀錄"><div className="match-head" role="row"><span>日期 / 賽事</span><span>系列賽</span><span>結果</span></div>{result.rows.map((row) => <div className="match-row" role="row" key={row.id}><span><strong>{row.event.name}</strong><small>{row.date} · BO{row.bestOf}</small></span><span>{row.leftName} <b>{row.leftScore}:{row.rightScore}</b> {row.rightName}</span><span className={row.winner === "left" ? "outcome win" : "outcome loss"}>{row.winner === "left" ? "WIN" : "LOSS"}</span></div>)}</div>}
    {result.nextCursor && <button className="load-more" type="button" onClick={onMore} disabled={loadingMore}>{loadingMore ? "載入中" : "載入更多"}<ChevronDown size={16} aria-hidden="true" /></button>}
  </section>;
}

function SavedDrawer({ items, names, onLoad, onRemove, onClose }: { items: SavedComparison[]; names: Map<string, EntityOption>; onLoad: (state: ComparisonRouteState) => void; onRemove: (id: string) => void; onClose: () => void }) {
  const label = (id: string) => names.get(id)?.displayName ?? id.slice(0, 8);
  return <aside className="saved-drawer" aria-label="已保存結果"><div className="drawer-heading"><h2>保存結果</h2><button type="button" className="icon-button" onClick={onClose} aria-label="關閉保存結果" title="關閉"><X size={18} /></button></div>{items.length === 0 ? <p className="empty-state">目前沒有保存的比較。</p> : <ul>{items.map((item) => { const left = label(item.state.leftId); const right = label(item.state.rightId); return <li key={item.id}><button type="button" className="saved-load" onClick={() => onLoad(item.state)}>{left} <ArrowLeftRight size={13} /> {right}<small>{new Date(item.createdAt).toLocaleDateString("zh-TW")}</small></button><button type="button" className="icon-button" onClick={() => onRemove(item.id)} aria-label={`刪除 ${left} 與 ${right} 的保存結果`} title="刪除"><Trash2 size={16} /></button></li>; })}</ul>}</aside>;
}

function ComparisonWorkspace({ api }: { api: ComparisonApi }) {
  const [params, setParams] = useSearchParams();
  const paramsKey = params.toString();
  const parsed = useMemo(() => parseRouteState(new URLSearchParams(paramsKey)), [paramsKey]);
  const submitted = parsed.state;
  const [draft, setDraft] = useState(submitted);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [savedOpen, setSavedOpen] = useState(false);
  const [saved, setSaved] = useState(() => loadSavedComparisons());
  const [known, setKnown] = useState<Map<string, EntityOption>>(() => new Map());
  const query = useMemo(() => toContractQuery(submitted), [submitted]);
  const comparison = useInfiniteQuery({ queryKey: ["comparison", serializeRouteState(submitted).toString()], initialPageParam: undefined as string | undefined, queryFn: ({ pageParam }) => api.compare({ ...query, ...(pageParam ? { cursor: pageParam } : {}) }), getNextPageParam: (page) => page.nextCursor });
  const pages = comparison.data?.pages ?? [];
  const firstPage = pages[0];
  const result = firstPage ? { ...firstPage, rows: pages.flatMap((page) => page.rows), ...(pages.at(-1)?.nextCursor ? { nextCursor: pages.at(-1)!.nextCursor } : {}) } : undefined;
  useEffect(() => { setDraft(submitted); if (parsed.recovered || paramsKey !== serializeRouteState(submitted).toString()) setParams(serializeRouteState(submitted), { replace: true }); }, [paramsKey, parsed.recovered, setParams, submitted]);
  useEffect(() => { if (!firstPage) return; setKnown((current) => {
    const left = subjectOption(firstPage.subjects.left); const right = subjectOption(firstPage.subjects.right);
    if (current.get(left.id)?.displayName === left.displayName && current.get(right.id)?.displayName === right.displayName) return current;
    return new Map(current).set(left.id, left).set(right.id, right);
  }); }, [firstPage]);
  const entity = (kind: EntityKind, id: string) => known.get(id) ?? unknownOption(kind, id);
  const updateDraft = (update: Partial<ComparisonRouteState>) => setDraft((current) => ({ ...current, ...update }));
  const pick = (side: "left" | "right", option: EntityOption) => { setKnown((current) => new Map(current).set(option.id, option)); setDraft((current) => { const next = { ...current }; if (side === "left") { next.leftKind = option.kind; next.leftId = option.id; delete next.leftEraId; } else { next.rightKind = option.kind; next.rightId = option.id; delete next.rightEraId; } return next; }); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); try { toContractQuery(draft); setValidationMessage(null); setParams(serializeRouteState(draft)); } catch { setValidationMessage("日期範圍或比較對象無法套用，請修正後重試。"); } };
  const resetDraft = () => { setValidationMessage(null); setDraft(submitted); };
  const save = () => setSaved(saveComparison(submitted));
  const load = (state: ComparisonRouteState) => { setDraft(state); setParams(serializeRouteState(state)); setSavedOpen(false); };
  return <main className="terminal-shell"><header className="topbar"><a className="wordmark" href="/" aria-label="RiftVersus 首頁"><span>RIFT</span><b>VERSUS</b></a><div className="topbar-actions"><span className="dataset-status"><i />資料已發布</span><button type="button" className="icon-button" onClick={save} aria-label="保存目前比較" title="保存目前比較"><Bookmark size={18} /></button><button type="button" className="icon-button" onClick={() => setSavedOpen(true)} aria-label="查看保存結果" title="保存結果"><Trophy size={18} /></button></div></header>
    <form className="compare-panel" aria-label="比較條件" onSubmit={submit}><div className="panel-heading"><p>HEAD-TO-HEAD ARCHIVE</p><h1>賽事對戰紀錄</h1></div><div className="subject-grid"><EntityCombobox label="比較對象" value={entity(draft.leftKind, draft.leftId)} onPick={(option) => pick("left", option)} api={api} /><button className="swap-button" type="button" onClick={() => setDraft(swapRouteState(draft))} aria-label="交換比較雙方" title="交換比較雙方"><ArrowLeftRight size={19} /></button><EntityCombobox label="對戰對象" value={entity(draft.rightKind, draft.rightId)} onPick={(option) => pick("right", option)} api={api} /></div><div className="filters"><label className="date-field"><span>起始日期</span><input type="date" value={draft.from ?? ""} onChange={(event) => setDraft((current) => event.target.value ? { ...current, from: event.target.value } : (() => { const next = { ...current }; delete next.from; return next; })())} /></label><label className="date-field"><span>結束日期</span><input type="date" value={draft.to ?? ""} onChange={(event) => setDraft((current) => event.target.value ? { ...current, to: event.target.value } : (() => { const next = { ...current }; delete next.to; return next; })())} /></label><ToggleGroup label="賽事類型" values={eventOptions.map(([value]) => value)} selected={draft.events} onChange={(values) => updateDraft({ events: values })} format={(value) => eventOptions.find(([item]) => item === value)?.[1] ?? value} /><ToggleGroup label="聯賽" values={leagueOptions} selected={draft.leagues} onChange={(values) => updateDraft({ leagues: values })} format={(value) => value.toUpperCase()} /><ToggleGroup label="賽制" values={bestOfOptions} selected={draft.bestOf} onChange={(values) => updateDraft({ bestOf: values })} format={(value) => `BO${value}`} /></div><div className="form-actions"><button className="apply-button" type="submit">套用篩選</button>{validationMessage && <><p className="validation-error" role="alert">{validationMessage}</p><button type="button" className="reset-button" onClick={resetDraft}>重設</button></>}</div></form>
    {comparison.isLoading && <section className="loading">正在彙整對戰紀錄</section>}{comparison.isError && <section className="loading">資料目前無法取得</section>}{result && firstPage && <><Summary result={result} /><ExportButton api={api} query={query} initial={firstPage} /><Results result={result} onMore={() => void comparison.fetchNextPage()} loadingMore={comparison.isFetchingNextPage} /></>}{savedOpen && <SavedDrawer items={saved} names={known} onLoad={load} onRemove={(id) => setSaved(removeSavedComparison(id))} onClose={() => setSavedOpen(false)} />}
  </main>;
}

export function App({ api = runtimeApi }: { api?: ComparisonApi }) { return <QueryClientProvider client={queryClient}><BrowserRouter><ComparisonWorkspace api={api} /></BrowserRouter></QueryClientProvider>; }
