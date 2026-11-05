import { ChevronDown, Eye, EyeOff, Layers3, PanelLeftClose, SlidersHorizontal } from "lucide-react";
import { format } from "@/lib/region";
import type { GenomeMeta, Subgraph, Variant } from "@/lib/types";

export const sampleColors = ["#67e8f9", "#22d3ee", "#a5f3fc", "#fbbf24", "#fcd34d", "#f59e0b"];
export function SampleSidebar({ meta, graph, selected, filters, onSample, onGroup, onFilter, onClose }: {
  meta: GenomeMeta | null; graph: Subgraph | null; selected: Set<string>; filters: Set<Variant>;
  onSample: (id: string) => void; onGroup: (ids: string[]) => void;
  onFilter: (type: Variant) => void; onClose: () => void;
}) {
  const counts: Record<Variant, number | null> = {
    SNP: graph?.summary.snp_bubbles ?? null,
    InDel: graph ? graph.summary.insertion_components + graph.summary.deletion_edges : null,
    Inversion: graph?.summary.inversion_edges ?? null,
  };
  return <aside className="sidebar" id="sample-controls" aria-label="Sample and variant controls">
    <div className="panel-heading"><h2><Layers3 size={16} /> Sample tracks</h2>
      <button className="icon-button" onClick={onClose} aria-label="Collapse sample controls" title="Collapse sample controls"><PanelLeftClose size={17} /></button>
    </div>
    <div className="selection-caption"><span>{selected.size} of {meta?.samples.length ?? "—"} visible</span>
      <button className="text-button" disabled={!meta} onClick={() => onGroup(meta?.samples.map(s => s.sample_id) ?? [])}>{selected.size ? "Hide all" : "Show all"}</button>
    </div>
    <div className="sample-groups">
      {!meta && <p className="muted">Waiting for sample metadata.</p>}
      {meta && Object.entries(meta.groups).map(([group, ids]) => <section className="sample-group" key={group}>
        <div className="group-heading"><h3><ChevronDown size={14} />{group}<span>{ids.length}</span></h3>
          <button className="text-button" aria-label={`Toggle ${group} samples`} onClick={() => onGroup(ids)}>{ids.every(id => selected.has(id)) ? "Hide" : "Show"}</button>
        </div>
        {ids.map(id => {
          const color = sampleColors[(meta.samples.findIndex(s => s.sample_id === id)) % sampleColors.length];
          return <label className={`sample-row ${selected.has(id) ? "" : "sample-hidden"}`} key={id}>
            <input type="checkbox" checked={selected.has(id)} onChange={() => onSample(id)} aria-label={`Show ${id}`} />
            <span className="sample-swatch" style={{ backgroundColor: color }} />
            <span className="sample-name">{id}</span>
            {id === "GRCh38" ? <span className="reference-tag">Ref</span> : selected.has(id) ? <Eye size={14} /> : <EyeOff size={14} />}
          </label>;
        })}
      </section>)}
    </div>
    <section className="variant-section">
      <h2><SlidersHorizontal size={16} /> Structural variation</h2>
      <p className="muted">Display filters</p>
      {(["SNP", "InDel", "Inversion"] as Variant[]).map(type => <button className="variant-row" key={type}
        role="switch" aria-checked={filters.has(type)} aria-label={`Show ${type}`} onClick={() => onFilter(type)}>
        <span className={`variant-mark variant-${type.toLowerCase()}`} />
        <span>{type}</span><span className="variant-count">{counts[type] === null ? "—" : format(counts[type])}</span>
        <span className={`switch-track ${filters.has(type) ? "on" : ""}`}><span /></span>
      </button>)}
      <p className="filter-note">Counts describe the requested region. Inversion is counted by connecting edges.</p>
    </section>
    <div className="dataset-note"><span className="status-dot" /><div><strong>Sample pangenome</strong><p>GFA 1.1 · {meta ? format(meta.total_length) : "—"} bp</p></div></div>
  </aside>;
}
