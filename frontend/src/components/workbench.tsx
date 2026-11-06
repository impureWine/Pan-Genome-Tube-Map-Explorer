"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Dna, Focus, Minus, PanelLeftOpen, Plus, RefreshCw, Search } from "lucide-react";
import { clampRegion, format, parseRegion, resolveLOD, zoomRegion } from "@/lib/region";
import { useGenomeAPI } from "@/lib/use-genome-api";
import type { GenomeMeta, LODMode, Region, Subgraph, Variant } from "@/lib/types";
import { SampleSidebar } from "./sample-sidebar";
import { Minimap } from "./minimap";
import { Viewport } from "./viewport";

export function Workbench() {
  const [revision, setRevision] = useState(0);
  const metadata = useGenomeAPI<GenomeMeta>("/api/genome/meta", revision);
  const meta = metadata.data;
  const total = meta?.total_length ?? 0;
  const [requested, setRequested] = useState<Region>({ start: 1000, end: 5000 });
  const region = total ? clampRegion(requested.start, requested.end - requested.start, total) : requested;
  const [mode, setMode] = useState<LODMode>("auto");
  const lod = resolveLOD(mode, region);
  const path = total ? `/api/subgraph?start=${region.start}&end=${region.end}&lod=${lod}` : null;
  const remote = useGenomeAPI<Subgraph>(path, revision);
  const graph = remote.data && remote.data.start === region.start && remote.data.end === region.end && remote.data.lod === lod ? remote.data : null;
  const error = metadata.error ?? (total ? remote.error : meta ? "The database has no reference coordinates." : null);
  const loading = !error && (metadata.loading || remote.loading || !graph);
  const [sidebar, setSidebar] = useState(true);
  const [mobileSidebar, setMobileSidebar] = useState(false);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const selected = selection ?? new Set(meta?.samples.map(s => s.sample_id) ?? []);
  const [filters, setFilters] = useState(new Set<Variant>(["SNP", "InDel", "Inversion"]));
  const [input, setInput] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    function shortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); inputRef.current?.focus(); inputRef.current?.select(); }
      if (e.key === "Escape") setMobileSidebar(false);
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!mobileSidebar) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.getElementById("sample-controls");
    const focusable = () => Array.from(panel?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)") ?? []);
    focusable()[0]?.focus();
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const items = focusable(), first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); previous?.focus(); };
  }, [mobileSidebar]);

  function navigate(next: Region) { setRequested(next); setInput(null); setInputError(null); }
  function toggleSamples(ids: string[]) {
    const next = new Set(selected);
    const remove = ids.every(id => next.has(id));
    ids.forEach(id => remove ? next.delete(id) : next.add(id));
    setSelection(next);
  }
  function toggleFilter(type: Variant) {
    const next = new Set(filters); if (next.has(type)) next.delete(type); else next.add(type); setFilters(next);
  }
  const nodeMap = new Map(graph?.nodes.map(n => [n.id, n]) ?? []);
  function nodeType(id: string): Variant | null {
    const n = nodeMap.get(id);
    if (!n || n.is_backbone) return null;
    if (n.length === 1 && n.ref_end !== null && n.ref_start !== null && n.ref_end - n.ref_start === 1) return "SNP";
    return n.ref_start === n.ref_end ? "InDel" : null;
  }
  const visibleNodes = graph?.nodes.filter(n => n.tracks.some(t => selected.has(t.sample_id)) && (!nodeType(n.id) || filters.has(nodeType(n.id)!))).length ?? 0;
  const visibleEdges = graph?.edges.filter(e => {
    const type = e.sv_type === "inversion" ? "Inversion" : e.sv_type === "insertion" || e.sv_type === "deletion" ? "InDel" : nodeType(e.from_node) ?? nodeType(e.to_node);
    return e.sample_ids.some(id => selected.has(id)) && (!type || filters.has(type));
  }).length ?? 0;

  return <main className="workbench">
    <header className="global-header">
      <Link className="brand" href="/" aria-label="Pan-Genome Tube Map Explorer home"><Dna size={27} strokeWidth={1.5} /><div><h1>Pan-Genome</h1><span>Tube Map Explorer</span></div></Link>
      <div className="workspace-breadcrumb"><span>Research workspace</span><ChevronDown size={13} /><span className="demo-label">Demo graph</span></div>
      <div className="header-status"><span className={`status-dot ${error ? "warning" : ""}`} /><span>{error ? "Backend offline" : metadata.loading ? "Connecting" : "Backend connected"}</span></div>
      <button className="icon-button mobile-menu" aria-label="Open sample controls" aria-expanded={mobileSidebar} aria-controls="sample-controls" onClick={() => setMobileSidebar(v => !v)}><PanelLeftOpen size={18} /></button>
    </header>
    <div className="command-bar">
      <div className="reference-control"><Dna size={16} /><label className="sr-only" htmlFor="reference">Reference system</label>
        <select id="reference" disabled={!meta} defaultValue="backbone"><option value="backbone">{meta?.samples.some(s => s.sample_id === "GRCh38") ? "GRCh38" : "Backbone"} · reference</option></select>
      </div>
      <form className="region-search" onSubmit={e => {
        e.preventDefault(); if (!total) return;
        const parsed = parseRegion(input ?? `${region.start}-${region.end}`, total);
        if (!parsed) setInputError(`Enter start-end within 0–${format(total)}, with start < end.`);
        else navigate(parsed);
      }}>
        <Search size={16} /><label htmlFor="region" className="sr-only">Genomic region</label>
        <input ref={inputRef} id="region" value={input ?? `${format(region.start)}-${format(region.end)}`} placeholder="1000-5000" autoComplete="off" spellCheck={false}
          disabled={!total} aria-invalid={Boolean(inputError)} aria-describedby={inputError ? "region-error" : "region-format"} onChange={e => setInput(e.target.value)} />
        <kbd aria-hidden="true">Ctrl K</kbd><button aria-label="Go to region" type="submit" disabled={!total}><ArrowRight size={16} /></button>
        {inputError && <span id="region-error" role="alert" className="input-error">{inputError}</span>}
        <span className="sr-only" id="region-format">0-based half-open coordinates, start-end in base pairs.</span>
      </form>
      <div className="zoom-controls" role="group" aria-label="Zoom controls">
        <button className="icon-button" disabled={!total || region.end - region.start <= 1} title="Zoom in" aria-label="Zoom in" onClick={() => navigate(zoomRegion(region, 0.5, total))}><Plus size={17} /></button>
        <button className="icon-button" disabled={!total || region.end - region.start >= total} title="Zoom out" aria-label="Zoom out" onClick={() => navigate(zoomRegion(region, 2, total))}><Minus size={17} /></button>
        <button className="icon-button" disabled={!total} title="Reset to full reference" aria-label="Reset viewport" onClick={() => navigate({ start: 0, end: total })}><Focus size={17} /></button>
      </div>
      <div className="lod-control" role="group" aria-label="Level of detail"><span className="lod-label">Detail</span>
        {(["auto", "macro", "micro"] as LODMode[]).map(value => <button key={value} aria-pressed={mode === value} onClick={() => setMode(value)}>{value === "auto" ? "Auto" : value === "macro" ? "Macro" : "Base level"}</button>)}
      </div>
    </div>
    <div className={`workspace-body ${sidebar ? "" : "sidebar-collapsed"} ${mobileSidebar ? "mobile-sidebar-open" : ""}`}>
      {mobileSidebar && <button className="sidebar-scrim" aria-label="Close sample controls" onClick={() => setMobileSidebar(false)} />}
      <SampleSidebar meta={meta} graph={graph} selected={selected} filters={filters} onSample={id => toggleSamples([id])} onGroup={toggleSamples} onFilter={toggleFilter} onClose={() => { setSidebar(false); setMobileSidebar(false); }} />
      <div className="workspace-main">
        <div className="workspace-title"><div className="workspace-title-left"><button className="icon-button desktop-sidebar-toggle" aria-label={sidebar ? "Collapse sample controls" : "Expand sample controls"} aria-expanded={sidebar} onClick={() => setSidebar(v => !v)}><PanelLeftOpen size={17} /></button>
          <h2>Graph workspace</h2><span className="reference-scope">Reference anchored</span></div>
          <button className="text-button refresh-button" onClick={() => setRevision(v => v + 1)}><RefreshCw size={14} className={loading ? "refreshing" : ""} />Refresh</button>
        </div>
        <Viewport region={region} total={total} lod={lod} graph={graph} loading={loading} error={error} duration={remote.duration}
          selected={selected} filters={filters} visibleNodes={visibleNodes} visibleEdges={visibleEdges} sampleCount={selected.size} onRegion={navigate} onRetry={() => setRevision(v => v + 1)} />
        <Minimap region={region} total={total} onChange={navigate} />
      </div>
    </div>
    <footer className="global-footer"><span><span className="status-dot neutral" />Local workspace</span><span>SQLite + R-Tree</span><span>Pan-Genome Explorer <span className="muted">/ v0.3</span></span></footer>
  </main>;
}
