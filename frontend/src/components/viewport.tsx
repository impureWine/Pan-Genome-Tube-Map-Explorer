"use client";
import { useRef, useState } from "react";
import { ArrowDownToLine, Crosshair, Hand, RefreshCw, Unplug } from "lucide-react";
import { clampRegion, format, zoomRegion } from "@/lib/region";
import TubeMapCanvas from "../../components/TubeMapCanvas";
import type { Variant, LOD, Region, Subgraph } from "@/lib/types";

export function Viewport({ region, total, lod, graph, loading, error, duration, visibleNodes, visibleEdges, sampleCount, selected, filters, onRegion, onRetry }: {
  region: Region; total: number; lod: LOD; graph: Subgraph | null; loading: boolean; error: string | null;
  duration: number | null; visibleNodes: number; visibleEdges: number; sampleCount: number;
  selected: Set<string>; filters: Set<Variant>; onRegion: (region: Region) => void; onRetry: () => void;
}) {
  const [cursor, setCursor] = useState<number | null>(null);
  const [panning, setPanning] = useState(false);
  const drag = useRef<{ x: number; region: Region; width: number } | null>(null);
  const span = region.end - region.start;
  return <section className="viewport-panel" aria-label="Graph viewport">
    <div className="viewport-topline"><span><span className={`status-dot ${error ? "warning" : ""}`} />{error ? "Connection interrupted" : loading ? "Fetching subgraph" : "Subgraph connected"}</span>
      <span>{lod === "micro" ? "Base level" : "Macro"} <span className="muted">· 0-based coordinates</span></span>
    </div>
    <div className={`viewport-grid ${panning ? "panning" : ""}`} tabIndex={0} role="group" aria-label="Interactive genome viewport. Drag to pan; arrow keys navigate; plus and minus zoom."
      onPointerDown={e => {
        if (!total || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        drag.current = { x: e.clientX, region, width: e.currentTarget.clientWidth };
        setPanning(true); e.currentTarget.setPointerCapture(e.pointerId);
      }} onPointerMove={e => {
        const rect = e.currentTarget.getBoundingClientRect();
        setCursor(Math.min(region.end - 1, Math.max(region.start, Math.floor(region.start + (e.clientX - rect.left) / rect.width * span))));
        if (drag.current) {
          const delta = (e.clientX - drag.current.x) / drag.current.width * (drag.current.region.end - drag.current.region.start);
          onRegion(clampRegion(drag.current.region.start - delta, drag.current.region.end - drag.current.region.start, total));
        }
      }} onPointerLeave={() => setCursor(null)} onPointerUp={() => { drag.current = null; setPanning(false); }}
      onPointerCancel={() => { drag.current = null; setPanning(false); }}
      onLostPointerCapture={() => { drag.current = null; setPanning(false); }}
      onKeyDown={e => {
        if (!total || (e.target as HTMLElement).closest("button")) return;
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault(); onRegion(clampRegion(region.start + (e.key === "ArrowLeft" ? -1 : 1) * span * 0.1, span, total));
        } else if (["+", "=", "-"].includes(e.key)) {
          e.preventDefault(); onRegion(zoomRegion(region, e.key === "-" ? 2 : 0.5, total));
        }
      }}>
      <TubeMapCanvas graph={graph} region={region} total={total} lod={lod} selected={selected} filters={filters} onRegion={onRegion} onCursor={setCursor} />
      {(error || (!loading && graph?.nodes.length === 0)) &&       <div className="viewport-center">
        {error ? <><Unplug size={26} className="muted" /><h2>Genome service unavailable</h2><p>{error}</p><button className="secondary-button" onClick={onRetry}><RefreshCw size={15} /> Retry connection</button></> :
          <><div className="viewport-symbol"><Crosshair size={28} strokeWidth={1} /></div>
            <h2>{loading ? "Loading this region" : graph?.nodes.length ? "Your region is ready" : "No nodes in this region"}</h2>
            <p>{loading ? "Retrieving the local graph and sample paths." : "Explore the coordinate space. Tube rendering comes next."}</p>
            <div className="viewport-instructions"><Hand size={14} /> Drag to pan<span>·</span><span>+ / − to zoom</span></div>
          </>}
      </div>
      }
      <div className="viewport-hud" aria-label="Subgraph statistics" aria-live="polite">
        <div><span>Returned nodes</span><strong data-testid="node-count">{graph ? format(graph.nodes.length) : "—"}</strong></div>
        <div><span>Returned edges</span><strong data-testid="edge-count">{graph ? format(graph.edges.length) : "—"}</strong></div>
        <div><span>Sample paths</span><strong>{graph ? graph.tracks.filter(t => t.fragments.length > 0).length : "—"}</strong></div>
      </div>
      <div className="selection-hud"><ArrowDownToLine size={14} /><span>Display selection</span><strong>{visibleNodes} nodes · {visibleEdges} edges · {sampleCount} samples</strong></div>
    </div>
    <div className="viewport-status"><span><Crosshair size={13} /> Cursor <strong data-testid="cursor-coordinate">{cursor === null ? "—" : `${format(cursor)} bp`}</strong></span>
      <span className="range-status" data-testid="viewport-range">{format(region.start)} — {format(region.end)} bp</span>
      <span>{duration === null || !graph ? "Awaiting response" : `API ${duration} ms`}</span>
    </div>
  </section>;
}
