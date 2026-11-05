"use client";
import { useRef, type PointerEvent } from "react";
import { ScanLine } from "lucide-react";
import { clampRegion, format } from "@/lib/region";
import type { Region } from "@/lib/types";

export function Minimap({ region, total, onChange }: { region: Region; total: number; onChange: (region: Region) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ fraction: number; span: number } | null>(null);
  const span = region.end - region.start;
  const fractionAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };
  function down(e: PointerEvent<HTMLDivElement>) {
    if (!total || e.button !== 0) return;
    const position = fractionAt(e) * total;
    const inside = position >= region.start && position <= region.end;
    drag.current = { fraction: inside ? (position - region.start) / span : 0.5, span };
    e.currentTarget.setPointerCapture(e.pointerId);
    onChange(clampRegion(position - drag.current.fraction * span, span, total));
  }
  return <section className="minimap-panel" aria-label="Genome overview">
    <div className="minimap-title"><h2><ScanLine size={16} /> Genome overview</h2>
      <span>{total ? ((span / total) * 100).toFixed(1) : "—"}% in view</span>
      <span className="overview-hint">Drag to navigate</span>
    </div>
    <div className="minimap-track" ref={track} role="slider" tabIndex={total ? 0 : -1} aria-label="Genome viewport start"
      aria-valuemin={0} aria-valuemax={Math.max(0, total - span)} aria-valuenow={region.start}
      aria-valuetext={`${region.start} to ${region.end} base pairs`} aria-disabled={!total}
      onPointerDown={down} onPointerMove={e => {
        if (drag.current) onChange(clampRegion(fractionAt(e) * total - drag.current.fraction * drag.current.span, drag.current.span, total));
      }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onLostPointerCapture={() => { drag.current = null; }} onKeyDown={e => {
        if (!total) return;
        const step = Math.max(1, Math.round(span * (e.shiftKey ? 0.5 : 0.1)));
        const positions: Record<string, number> = { ArrowLeft: region.start - step, ArrowRight: region.start + step, Home: 0, End: total - span };
        if (e.key in positions) { e.preventDefault(); onChange(clampRegion(positions[e.key], span, total)); }
      }}>
      <div className="genome-baseline" />
      {total > 0 && <div className="minimap-window" data-testid="minimap-window" style={{ left: `${region.start / total * 100}%`, width: `${span / total * 100}%` }}>
        <span className="grip" /><span className="window-label">{format(region.start)} — {format(region.end)}</span><span className="grip" />
      </div>}
    </div>
    <div className="minimap-labels"><span>0 bp</span><span>{total ? format(Math.round(total / 2)) : "—"} bp</span><span>{total ? format(total) : "—"} bp</span></div>
  </section>;
}
