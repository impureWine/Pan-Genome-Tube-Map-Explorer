"use client";
import { useEffect, useRef, useState } from "react";
import type { Bezier, LOD, Region, Subgraph, Variant, LayoutNode } from "../src/lib/types";
import { clampRegion, format, zoomRegion } from "../src/lib/region";

const COLORS = ["#67e8f9", "#22d3ee", "#a5f3fc", "#fbbf24", "#fcd34d", "#f59e0b"];
const BASES: Record<string, string> = { A: "#6ee7b7", T: "#fda4af", C: "#67e8f9", G: "#fcd34d" };
type Props = { graph: Subgraph | null; region: Region; total: number; lod: LOD;
  selected: Set<string>; filters: Set<Variant>; onRegion: (r: Region) => void; onCursor: (n: number | null) => void };
type Hit = { samples: string[]; node: LayoutNode; type: string; x: number; y: number };

export default function TubeMapCanvas(props: Props) {
  const { graph: incomingGraph, region, lod, selected, filters, total, onRegion, onCursor } = props;
  const canvas = useRef<HTMLCanvasElement>(null);
  const retained = useRef<Subgraph | null>(null);
  const camera = useRef(region);
  const drag = useRef<{ x: number; region: Region } | null>(null);
  const hitTest = useRef<(x: number, y: number) => Hit | null>(() => null);
  const [hit, setHit] = useState<Hit | null>(null);
  const [glow, setGlow] = useState(true);
  const hover = useRef<Hit | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(el); return () => observer.disconnect();
  }, []);
  useEffect(() => { camera.current = region; }, [region]);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    if (incomingGraph) retained.current = incomingGraph;
    const graph = incomingGraph ?? retained.current;
    const { width: w, height: h } = size;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = Math.round(w * dpr); el.height = Math.round(h * dpr);
    const backbone = graph?.nodes.filter(n => n.is_backbone).sort((a,b) => a.x-b.x) ?? [];
    const anchors = backbone.flatMap(n => [[n.x, n.ref_start ?? 0], [n.x+n.width, n.ref_end ?? 0]]);
    const project = (x: number) => {
      if (!anchors.length) return x;
      let i = 1;
      while (i < anchors.length - 1 && anchors[i][0] < x) i++;
      const a = anchors[i-1], b = anchors[i];
      return a[1] + (x-a[0]) / Math.max(.001,b[0]-a[0]) * (b[1]-a[1]);
    };
    const span = region.end-region.start;
    const sx = (x: number) => (project(x)-region.start)/span*w;
    const lower = graph ? Math.max(120,graph.bounds.max_y) : 120;
    const upper = graph ? Math.min(-120,graph.bounds.min_y) : -120;
    const scaleY = Math.min(1.8, Math.max(.25,(h-190)/(lower-upper)));
    const sy = (y: number) => 58 + (y-upper)*scaleY;
    const nodeMap = new Map(graph?.nodes.map(n => [n.id,n]) ?? []);
    const kind = (n: LayoutNode): Variant | null => !n.is_backbone ?
      n.length === 1 && (n.ref_end ?? 0)-(n.ref_start ?? 0) === 1 ? "SNP" : n.ref_start===n.ref_end ? "InDel" : null : null;
    const nodeVisible = (n: LayoutNode) => n.tracks.some(t => selected.has(t.sample_id)) && (!kind(n) || filters.has(kind(n)!));
    const nodes = graph?.nodes.filter(nodeVisible).map(n => ({ n, x:sx(n.x), y:sy(n.y), width:Math.max(3,sx(n.x+n.width)-sx(n.x)), height:Math.max(20,n.height*scaleY) })) ?? [];
    const curvePath = (c: Bezier) => { const p=new Path2D(); p.moveTo(sx(c.x1),sy(c.y1)); p.bezierCurveTo(sx(c.x1)+Math.sign(c.cp1x-c.x1)*Math.max(8,Math.abs(sx(c.cp1x)-sx(c.x1))),sy(c.cp1y),sx(c.x2)+Math.sign(c.cp2x-c.x2)*Math.max(8,Math.abs(sx(c.cp2x)-sx(c.x2))),sy(c.cp2y),sx(c.x2),sy(c.y2)); return p; };
    const tubes: { path: Path2D; sample: string; color: string; node: LayoutNode; type: string }[] = [];
    const edges = new Map(graph?.edges.map(e => [e.id,e]) ?? []);
    graph?.tracks.forEach((t,index) => {
      if (!selected.has(t.sample_id)) return;
      t.fragments.forEach(f => {
        let cursor=0;
        f.steps.forEach((step,i) => {
          const n=nodeMap.get(step.node_id);
          if (i) {
            const edge=edges.get(f.edge_ids[i-1]);
            const count=edge?.segments.length ?? 1;
            const type=edge?.sv_type === "inversion" ? "Inversion" : edge?.sv_type === "insertion" || edge?.sv_type === "deletion" ? "InDel" : kind(n!) ?? kind(nodeMap.get(f.steps[i-1].node_id)!);
            const curves=f.segments.slice(cursor,cursor+count); cursor+=count;
            if (n && (!type || filters.has(type))) curves.forEach(c => tubes.push({ path:curvePath(c),sample:t.sample_id,color:COLORS[index%COLORS.length],node:n,type:type??"Reference" }));
          }
          const c=f.segments[cursor++];
          if (n && c && nodeVisible(n)) tubes.push({path:curvePath(c),sample:t.sample_id,color:COLORS[index%COLORS.length],node:n,type:kind(n)??"Reference"});
        });
      });
    });
    hitTest.current = (x,y) => {
      ctx.setTransform(1,0,0,1,0,0); ctx.lineWidth=9;
      for (let i=tubes.length-1;i>=0;i--) if(ctx.isPointInStroke(tubes[i].path,x,y)) {
        const t=tubes[i]; return {samples:[t.sample],node:t.node,type:t.type,x,y};
      }
      const box=nodes.find(b => x>=b.x && x<=b.x+b.width && Math.abs(y-b.y)<b.height/2);
      return box ? {samples:box.n.tracks.filter(t=>selected.has(t.sample_id)).map(t=>t.sample_id),node:box.n,type:kind(box.n)??"Reference",x,y} : null;
    };
    let frame=0, lastHover: Hit|null=null, remaining=1;
    const opacity=new Map<string,number>();
    let lastTime=performance.now();
    function draw(now:number) {
      frame=requestAnimationFrame(draw);
      if(document.hidden) return;
      if(lastHover!==hover.current) {remaining=1;lastHover=hover.current;}
      if(remaining<.002) return;
      const dt=Math.min(50,now-lastTime); lastTime=now;
      remaining*=Math.exp(-Math.max(16,dt)/45);
      ctx!.setTransform(dpr,0,0,dpr,0,0); ctx!.clearRect(0,0,w,h);
      ctx!.fillStyle="#0b0f17";ctx!.fillRect(0,0,w,h);
      ctx!.strokeStyle="#182130";ctx!.lineWidth=.5;ctx!.beginPath();
      const offset=-(region.start/span*w)%32;
      for(let x=offset;x<w;x+=32){ctx!.moveTo(x,32);ctx!.lineTo(x,h);}
      for(let y=48;y<h;y+=32){ctx!.moveTo(0,y);ctx!.lineTo(w,y);}ctx!.stroke();
      ctx!.strokeStyle="#334155";ctx!.setLineDash([4,6]);ctx!.beginPath();ctx!.moveTo(0,sy(0));ctx!.lineTo(w,sy(0));ctx!.stroke();ctx!.setLineDash([]);
      ctx!.save();ctx!.beginPath();ctx!.rect(0,34,w,h-34);ctx!.clip();
      for(const b of nodes){if(b.x>w || b.x+b.width<0)continue;ctx!.fillStyle="#101a28";ctx!.beginPath();ctx!.roundRect(b.x,b.y-b.height/2,b.width,b.height,Math.min(8,b.width/2));ctx!.fill();}
      for(const sample of new Set(tubes.map(t=>t.sample))){
        const target=hover.current && !hover.current.samples.includes(sample) ? .15 : 1;
        const alpha=(opacity.get(sample)??1)+(target-(opacity.get(sample)??1))*.28;opacity.set(sample,alpha);
      }
      for(const t of tubes){
        const alpha=opacity.get(t.sample)??1;
        ctx!.globalAlpha=alpha;ctx!.lineCap="round";ctx!.lineJoin="round";ctx!.strokeStyle=t.color;
        if(glow){ctx!.shadowColor=t.color;ctx!.shadowBlur=hover.current?.samples.includes(t.sample)?14:7;}
        ctx!.lineWidth=2.2;ctx!.stroke(t.path);ctx!.shadowBlur=0;
      }
      ctx!.globalAlpha=1;
      let baseCount=0;
      for(const b of nodes){
        if(b.x>w || b.x+b.width<0)continue;
        ctx!.strokeStyle=hover.current?.node.id===b.n.id ? "#e2e8f0" : "#46576b";ctx!.lineWidth=.8;
        ctx!.beginPath();ctx!.roundRect(b.x,b.y-b.height/2,b.width,b.height,Math.min(8,b.width/2));ctx!.stroke();
        if(lod==="micro" && b.n.sequence && b.n.sequence!=="*" && b.width/b.n.length>=11){
          ctx!.font="600 12px 'Public Sans',sans-serif";ctx!.textAlign="center";
          const pitch=b.width/b.n.length;
          for(let i=Math.max(0,Math.floor(-b.x/pitch));i<b.n.length && b.x+i*pitch<w;i++){
            const base=b.n.sequence[i];ctx!.fillStyle="#0b0f17";ctx!.fillRect(b.x+i*pitch,b.y-8,pitch,16);
            ctx!.fillStyle=BASES[base.toUpperCase()]??"#cbd5e1";ctx!.fillText(base,b.x+(i+.5)*pitch,b.y+4);baseCount++;
          }
        }else if(!b.n.is_backbone){ctx!.font="12px 'Public Sans',sans-serif";ctx!.textAlign="left";ctx!.fillStyle="#e9edf5";ctx!.fillText(kind(b.n)==="InDel"?`+${b.n.length}bp INS`:kind(b.n)==="SNP"?"SNP":b.n.id,b.x,b.y-b.height/2-9);}
      }
      if(filters.has("Inversion")) graph?.edges.filter(e=>e.sv_type==="inversion" && e.sample_ids.some(s=>selected.has(s))).forEach(e=>{const c=e.segments[1];if(c){ctx!.fillStyle="#fbbf24";ctx!.font="12px 'Public Sans',sans-serif";ctx!.fillText("↶ INV",Math.max(8,Math.min(w-55,sx((c.x1+c.x2)/2))),sy(c.y1)+22);}});
      ctx!.restore();
      ctx!.fillStyle="#101620";ctx!.fillRect(0,0,w,34);ctx!.fillStyle="#b6c5d8";ctx!.font="11px 'Public Sans',sans-serif";
      const raw=span/Math.max(2,Math.floor(w/110)),power=10**Math.floor(Math.log10(raw));
      const step=[1,2,5,10].map(v=>v*power).find(v=>v>=raw)??power*10;
      for(let bp=Math.ceil(region.start/step)*step;bp<region.end;bp+=step){const x=(bp-region.start)/span*w;ctx!.textAlign=x<30?"left":x>w-40?"right":"center";ctx!.fillText(format(bp),Math.max(6,Math.min(w-6,x)),20);ctx!.fillRect(x,28,1,6);}
      el!.dataset.baseCount=String(baseCount);el!.dataset.tubeCount=String(tubes.length);el!.dataset.hoverSamples=hover.current?.samples.join(",")??"";
    }
    frame=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frame);hitTest.current=()=>null;};
  },[incomingGraph,region,lod,selected,filters,size,glow]);
  useEffect(()=>{
    const el=canvas.current;if(!el)return;
    function wheel(e:WheelEvent){e.preventDefault();if(!total)return;const rect=el!.getBoundingClientRect();const r=zoomRegion(camera.current,(camera.current.end-camera.current.start<=3 && e.deltaY>0 ? 2 : Math.exp(Math.max(-120,Math.min(120,e.deltaY))*.0025)),total,(e.clientX-rect.left)/rect.width);camera.current=r;onRegion(r);}
    el.addEventListener("wheel",wheel,{passive:false});return()=>el.removeEventListener("wheel",wheel);
  },[total,onRegion]);
  return <div className="tube-map-stage">
    <canvas ref={canvas} data-testid="tube-map-canvas" aria-label="Pangenome tube map. Drag to pan and scroll to zoom." tabIndex={0}
      onPointerDown={e=>{e.stopPropagation();if(!total || e.button!==0)return;drag.current={x:e.clientX,region:camera.current};e.currentTarget.setPointerCapture(e.pointerId);hover.current=null;setHit(null);}}
      onPointerMove={e=>{e.stopPropagation();const rect=e.currentTarget.getBoundingClientRect(),x=e.clientX-rect.left,y=e.clientY-rect.top;
        onCursor(Math.floor(camera.current.start+x/rect.width*(camera.current.end-camera.current.start)));
        if(drag.current){const r=clampRegion(drag.current.region.start-(e.clientX-drag.current.x)/rect.width*(drag.current.region.end-drag.current.region.start),drag.current.region.end-drag.current.region.start,total);camera.current=r;onRegion(r);}
        else{const next=hitTest.current(x,y);hover.current=next;setHit(next);}}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
      onPointerLeave={()=>{hover.current=null;setHit(null);onCursor(null);}} />
    <button className="canvas-glow" aria-pressed={glow} onClick={()=>setGlow(v=>!v)}>Glow {glow?"on":"off"}</button>
    {hit && <div role="tooltip" className="tube-tooltip" style={{left:Math.min(size.width-210,Math.max(8,hit.x+14)),top:Math.min(size.height-120,Math.max(38,hit.y+16))}}>
      <strong>{hit.samples.join(" · ")}</strong><span>Node {hit.node.id}</span><span>{format(hit.node.length)} bp · {hit.type}</span>
    </div>}
  </div>;
}
