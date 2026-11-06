"use client";
import { useEffect, useRef, useState } from "react";
import type { Bezier, LOD, Region, Subgraph, Variant, LayoutNode } from "../src/lib/types";
import { recordSVG, downloadBlob } from "../src/lib/svg-recorder";
import { clampRegion, format, zoomRegion } from "../src/lib/region";

const COLORS = ["#67e8f9", "#22d3ee", "#a5f3fc", "#fbbf24", "#fcd34d", "#f59e0b"];
const BASES: Record<string, string> = { A: "#6ee7b7", T: "#fda4af", C: "#67e8f9", G: "#fcd34d" };
type Props = { graph: Subgraph | null; region: Region; total: number; lod: LOD;
  mode: "individual" | "frequency" | "phenotype"; onInspect: (id:string)=>void; selected: Set<string>; filters: Set<Variant>; onRegion: (r: Region) => void; onCursor: (n: number | null) => void };
type Hit = { samples: string[]; node: LayoutNode; type: string; x: number; y: number };

export default function TubeMapCanvas(props: Props) {
  const { graph: incomingGraph, region, lod, selected, filters, total, onRegion, onCursor, mode, onInspect } = props;
  const exportRequest=useRef<"png"|"svg"|null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const retained = useRef<Subgraph | null>(null);
  const camera = useRef(region);
  const drag = useRef<{ x: number; region: Region } | null>(null);
  const hitTest = useRef<(x: number, y: number) => Hit | null>(() => null);
  const [hit, setHit] = useState<Hit | null>(null);
  const [glow, setGlow] = useState(true);
  const hover = useRef<Hit | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  useEffect(()=>{function request(event:Event){const format=(event as CustomEvent).detail;if(incomingGraph&&(format==="png"||format==="svg"))exportRequest.current=format;}window.addEventListener("tube-export",request);return()=>window.removeEventListener("tube-export",request);},[incomingGraph]);
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
    const el = canvas.current, realContext = el?.getContext("2d");
    if (!el || !realContext) return;
    const real=realContext;
    let ctx:CanvasRenderingContext2D=real;
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
    const pathData=new WeakMap<Path2D,string>();
    const curvePath = (c: Bezier) => {const x1=sx(c.x1),y1=sy(c.y1),x2=sx(c.x2),y2=sy(c.y2),cp1x=x1+Math.sign(c.cp1x-c.x1)*Math.max(8,Math.abs(sx(c.cp1x)-x1)),cp2x=x2+Math.sign(c.cp2x-c.x2)*Math.max(8,Math.abs(sx(c.cp2x)-x2));const data=`M ${x1} ${y1} C ${cp1x} ${sy(c.cp1y)} ${cp2x} ${sy(c.cp2y)} ${x2} ${y2}`;const p=new Path2D(data);pathData.set(p,data);return p; };
    const tubes: { path: Path2D; sample: string; color: string; node: LayoutNode; type: string; width?: number; members?: string[]; curve?: Bezier }[] = [];
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
            if (n && (!type || filters.has(type))) curves.forEach(c => tubes.push({ path:curvePath(c),curve:c,sample:t.sample_id,color:COLORS[index%COLORS.length],node:n,type:type??"Reference" }));
          }
          const c=f.segments[cursor++];
          if (n && c && nodeVisible(n) && (step.orientation!=="-"||filters.has("Inversion"))) tubes.push({path:curvePath(c),curve:c,sample:t.sample_id,color:COLORS[index%COLORS.length],node:n,type:step.orientation==="-"?"Inversion":kind(n)??"Reference"});
        });
      });
    });
    if(graph && mode!=="individual") {
      tubes.length=0;
      const cohort=graph.tracks.filter(t=>selected.has(t.sample_id));
      const cohorts=mode==="frequency" ? [{name:"AF",tracks:cohort,color:"#22d3ee",offset:0}] : [
        {name:"Control",tracks:cohort.filter(t=>t.group_name==="Control"),color:"#38BDF8",offset:-8/scaleY},
        {name:"Case",tracks:cohort.filter(t=>t.group_name==="Case"),color:"#F97316",offset:8/scaleY}];
      for(const group of cohorts){
        const ids=new Set(group.tracks.map(t=>t.sample_id));
        if(!ids.size)continue;
        const add=(c:Bezier,node:LayoutNode,members:string[],type:string)=>{
          if(!members.length)return;
          const shifted={...c,y1:c.y1+group.offset,cp1y:c.cp1y+group.offset,cp2y:c.cp2y+group.offset,y2:c.y2+group.offset};
          tubes.push({path:curvePath(shifted),curve:shifted,sample:group.name,color:group.color,node,type,members,width:(mode==="frequency"?24:12)*members.length/ids.size});
        };
        for(const n of graph.nodes){if(!nodeVisible(n))continue;const members=n.tracks.map(t=>t.sample_id).filter(id=>ids.has(id));
          add({x1:n.x,y1:n.y,cp1x:n.x+n.width/3,cp1y:n.y,cp2x:n.x+n.width*2/3,cp2y:n.y,x2:n.x+n.width,y2:n.y},n,members,kind(n)??"Reference");}
        for(const e of graph.edges){const n=nodeMap.get(e.to_node)!;const type=e.sv_type==="inversion"?"Inversion":e.sv_type==="insertion"||e.sv_type==="deletion"?"InDel":kind(n)??kind(nodeMap.get(e.from_node)!);
          if(type&&!filters.has(type))continue;
          const members=[...new Set(e.sample_ids.filter(id=>ids.has(id)))];
          e.segments.forEach(c=>add(c,n,members,type??"Reference"));}
      }
    }
    hitTest.current = (x,y) => {
      ctx.setTransform(1,0,0,1,0,0); ctx.lineWidth=9;
      for (let i=tubes.length-1;i>=0;i--) if((ctx.lineWidth=Math.max(9,tubes[i].width??2.2),ctx.isPointInStroke(tubes[i].path,x,y))) {
        const t=tubes[i]; return {samples:t.members??[t.sample],node:t.node,type:t.type,x,y};
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
      const snapshot=exportRequest.current;
      const moving=filters.has("Inversion")&&tubes.some(t=>t.type==="Inversion")&&!window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if(remaining<.002 && !moving && !snapshot) return;
      const scale=snapshot==="png"?4:dpr;
      if(snapshot==="png"){el!.width=Math.round(w*4);el!.height=Math.round(h*4);}
      const recorder=snapshot==="svg"?recordSVG(real!,pathData,w,h):null;ctx=recorder?.context??real;
      const dt=Math.min(50,now-lastTime); lastTime=now;
      remaining*=Math.exp(-Math.max(16,dt)/45);
      ctx!.setTransform(scale,0,0,scale,0,0); ctx!.clearRect(0,0,w,h);
      ctx!.fillStyle="#0b0f17";ctx!.fillRect(0,0,w,h);
      ctx!.strokeStyle="#182130";ctx!.lineWidth=.5;ctx!.beginPath();
      const offset=-(region.start/span*w)%32;
      for(let x=offset;x<w;x+=32){ctx!.moveTo(x,32);ctx!.lineTo(x,h);}
      for(let y=48;y<h;y+=32){ctx!.moveTo(0,y);ctx!.lineTo(w,y);}ctx!.stroke();
      ctx!.strokeStyle="#334155";ctx!.setLineDash([4,6]);ctx!.beginPath();ctx!.moveTo(0,sy(0));ctx!.lineTo(w,sy(0));ctx!.stroke();ctx!.setLineDash([]);
      ctx!.save();ctx!.beginPath();ctx!.rect(0,34,w,h-34);ctx!.clip();
      for(const b of nodes){if(b.x>w || b.x+b.width<0)continue;ctx!.fillStyle="#101a28";ctx!.beginPath();ctx!.roundRect(b.x,b.y-b.height/2,b.width,b.height,Math.min(8,b.width/2));ctx!.fill();}
      const highlighted=new Set(tubes.filter(t=>(t.members??[t.sample]).some(s=>hover.current?.samples.includes(s))).map(t=>t.sample));
      for(const sample of new Set(tubes.map(t=>t.sample))){
        const target=hover.current && !highlighted.has(sample) ? .15 : 1;
        const alpha=(opacity.get(sample)??1)+(target-(opacity.get(sample)??1))*.28;opacity.set(sample,alpha);
      }
      for(const t of tubes){
        const alpha=opacity.get(t.sample)??1;
        ctx!.globalAlpha=alpha;ctx!.lineCap="round";ctx!.lineJoin="round";ctx!.strokeStyle=t.color;
        if(glow){ctx!.shadowColor=t.color;ctx!.shadowBlur=highlighted.has(t.sample)?14:7;}
        ctx!.lineCap=mode==="individual"?"round":"butt";ctx!.lineWidth=t.width??2.2;ctx!.stroke(t.path);ctx!.shadowBlur=0;
      }
      ctx!.globalAlpha=1;
      for(const t of tubes.filter(t=>t.type==="Inversion")){
        ctx!.globalAlpha=opacity.get(t.sample)??1;ctx!.strokeStyle="#f8fafc";ctx!.lineWidth=1;ctx!.setLineDash([7,8]);ctx!.lineDashOffset=moving?-now/35:0;ctx!.stroke(t.path);ctx!.setLineDash([]);ctx!.lineDashOffset=0;
        if(t.curve){const c=t.curve,f=moving?(now%1800)/1800:.5,u=1-f,x=sx(u*u*u*c.x1+3*u*u*f*c.cp1x+3*u*f*f*c.cp2x+f*f*f*c.x2),y=sy(u*u*u*c.y1+3*u*u*f*c.cp1y+3*u*f*f*c.cp2y+f*f*f*c.y2),dx=3*u*u*(sx(c.cp1x)-sx(c.x1))+6*u*f*(sx(c.cp2x)-sx(c.cp1x))+3*f*f*(sx(c.x2)-sx(c.cp2x)),dy=3*u*u*(sy(c.cp1y)-sy(c.y1))+6*u*f*(sy(c.cp2y)-sy(c.cp1y))+3*f*f*(sy(c.y2)-sy(c.cp2y)),angle=Math.atan2(dy,dx);const p=new Path2D();const data=`M ${x-6*Math.cos(angle-.5)} ${y-6*Math.sin(angle-.5)} L ${x} ${y} L ${x-6*Math.cos(angle+.5)} ${y-6*Math.sin(angle+.5)}`;pathData.set(p,data);p.addPath(new Path2D(data));ctx!.stroke(p);}
      }
      ctx!.globalAlpha=1;
      el!.dataset.antsPhase=moving?String(Math.floor(now/35)):"static";
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
      if(filters.has("Inversion")) graph?.edges.filter(e=>e.sv_type==="inversion" && e.sample_ids.some(s=>selected.has(s))).forEach(e=>{const c=e.segments[1];if(c){ctx!.fillStyle="#fbbf24";ctx!.font="12px 'Public Sans',sans-serif";ctx!.fillText("🔁 INV",Math.max(8,Math.min(w-55,sx((c.x1+c.x2)/2))),sy(c.y1)+22);}});
      if(mode==="frequency" && graph){ctx!.fillStyle="#e9edf5";ctx!.font="12px 'Public Sans',sans-serif";ctx!.textAlign="left";
        const denominator=graph.tracks.filter(t=>selected.has(t.sample_id)).length;
        nodes.filter(b=>!b.n.is_backbone && b.x+b.width>=0 && b.x<w).forEach(b=>{const altIds=new Set(b.n.tracks.filter(t=>selected.has(t.sample_id)).map(t=>t.sample_id));
          const referenceIds=new Set<string>();
          if(b.n.ref_start===b.n.ref_end){graph.edges.filter(e=>{const a=nodeMap.get(e.from_node),n=nodeMap.get(e.to_node);return e.sv_type==="normal" && a?.is_backbone && n?.is_backbone && (a.ref_end===b.n.ref_start && n.ref_start===b.n.ref_start || n.ref_end===b.n.ref_start && a.ref_start===b.n.ref_start);}).forEach(e=>e.sample_ids.forEach(id=>{if(selected.has(id)&&!altIds.has(id))referenceIds.add(id);}));}
          else graph.nodes.filter(n=>n.is_backbone && n.ref_start!==null && n.ref_end!==null && n.ref_start<(b.n.ref_end??0) && n.ref_end>(b.n.ref_start??0)).forEach(n=>n.tracks.forEach(t=>{if(selected.has(t.sample_id)&&!altIds.has(t.sample_id))referenceIds.add(t.sample_id);}));
          const label=`${(referenceIds.size/Math.max(1,denominator)*100).toFixed(1)}% Ref / ${(altIds.size/Math.max(1,denominator)*100).toFixed(1)}% Alt`;
          ctx!.fillText(label,Math.max(6,Math.min(w-190,b.x)),b.y-b.height/2-28);});
        graph.edges.filter(e=>e.sv_type==="deletion"||e.sv_type==="inversion").forEach(e=>{const c=e.segments[1];if(!c)return;const x=sx((c.x1+c.x2)/2);if(x<0||x>w)return;const numerator=new Set(e.sample_ids.filter(id=>selected.has(id))).size;const category=e.sv_type==="deletion"?"InDel":"Inversion";if(!numerator||!filters.has(category))return;ctx!.fillText(`${(100*numerator/Math.max(1,denominator)).toFixed(1)}% ${e.sv_type==="deletion"?"DEL":"INV"}`,Math.min(w-100,x),sy(c.y1)-12);});}
      ctx!.restore();
      ctx!.fillStyle="#101620";ctx!.fillRect(0,0,w,34);ctx!.fillStyle="#b6c5d8";ctx!.font="11px 'Public Sans',sans-serif";
      const raw=span/Math.max(2,Math.floor(w/110)),power=10**Math.floor(Math.log10(raw));
      const step=[1,2,5,10].map(v=>v*power).find(v=>v>=raw)??power*10;
      for(let bp=Math.ceil(region.start/step)*step;bp<region.end;bp+=step){const x=(bp-region.start)/span*w;ctx!.textAlign=x<30?"left":x>w-40?"right":"center";ctx!.fillText(format(bp),Math.max(6,Math.min(w-6,x)),20);ctx!.fillRect(x,28,1,6);}
      el!.dataset.renderMode=mode;el!.dataset.flowWidths=JSON.stringify(tubes.map(t=>t.width??2.2));
      if(snapshot){
        exportRequest.current=null;
        const filename=`pangenome-${region.start}-${region.end}-${mode}`;
        if(recorder)downloadBlob(new Blob([recorder.serialize()],{type:"image/svg+xml"}),filename+".svg");
        else el!.toBlob(blob=>{if(blob)downloadBlob(blob,filename+".png");},"image/png");
        ctx=real;
        if(snapshot==="png"){el!.width=Math.round(w*dpr);el!.height=Math.round(h*dpr);remaining=1;}
      }
      el!.dataset.baseCount=String(baseCount);el!.dataset.tubeCount=String(tubes.length);el!.dataset.hoverSamples=hover.current?.samples.join(",")??"";
    }
    frame=requestAnimationFrame(draw);
    return()=>{cancelAnimationFrame(frame);hitTest.current=()=>null;};
  },[incomingGraph,region,lod,selected,filters,size,glow,mode]);
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
      onPointerUp={e=>{const rect=e.currentTarget.getBoundingClientRect();if(drag.current&&Math.abs(e.clientX-drag.current.x)<4){const found=hitTest.current(e.clientX-rect.left,e.clientY-rect.top);if(found)onInspect(found.node.id);}drag.current=null;}} onPointerCancel={()=>{drag.current=null;}} onLostPointerCapture={()=>{drag.current=null;}}
      onPointerLeave={()=>{hover.current=null;setHit(null);onCursor(null);}} />

    <button className="canvas-glow" aria-pressed={glow} onClick={()=>setGlow(v=>!v)}>Glow {glow?"on":"off"}</button>
    {hit && <div role="tooltip" className="tube-tooltip" style={{left:Math.min(size.width-210,Math.max(8,hit.x+14)),top:Math.min(size.height-120,Math.max(38,hit.y+16))}}>
      <strong>{hit.samples.join(" · ")}</strong><span>Node {hit.node.id}</span><span>{format(hit.node.length)} bp · {hit.type}</span>
    </div>}
  </div>;
}
