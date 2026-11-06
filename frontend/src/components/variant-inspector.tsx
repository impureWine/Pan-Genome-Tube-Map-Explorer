"use client";
import { useEffect, useRef, useState } from "react";
import { useGenomeAPI } from "@/lib/use-genome-api";
type Detail = { id:string; seq:string; length:number; ref_start:number|null; ref_end:number|null;
  samples:{sample_id:string;group_name:string}[];
  groups:Record<string,{total:number;carriers:number;frequency:number|null}>;
  annotation:{source:string;gene:string;function:string;consequence:string};frequency_definition:string };
export function VariantInspector({nodeId,onClose}:{nodeId:string;onClose:()=>void}) {
  const [revision,setRevision]=useState(0),[copied,setCopied]=useState("");
  const {data,error,loading}=useGenomeAPI<Detail>(`/api/nodes/${encodeURIComponent(nodeId)}`,revision);
  const close=useRef<HTMLButtonElement>(null);
  useEffect(()=>{const prior=document.activeElement as HTMLElement|null;close.current?.focus();return()=>prior?.focus();},[]);
  useEffect(()=>{function key(e:KeyboardEvent){if(e.key==="Escape")onClose();}window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[onClose]);
  return <aside className="variant-inspector" aria-label="Variant details">
    <div className="inspector-heading"><h2>Variant details · {nodeId}</h2><button ref={close} className="icon-button" aria-label="Close variant details" onClick={onClose}>×</button></div>
    {loading && <p>Loading node details…</p>}
    {error && <><p role="alert">{error}</p><button className="secondary-button" onClick={()=>setRevision(v=>v+1)}>Retry details</button></>}
    {data && <><p>{data.length.toLocaleString()} bp · Reference [{data.ref_start ?? "?"}, {data.ref_end ?? "?"})</p>
      <h3>Stored sequence</h3><pre>{data.seq}</pre><button className="secondary-button" disabled={data.seq==="*"} onClick={async()=>{
        try{const lines=data.seq.match(/.{1,80}/g)?.join("\n")??"";await navigator.clipboard.writeText(`>${data.id} length=${data.length}\n${lines}\n`);setCopied("FASTA copied");}catch{setCopied("Clipboard unavailable. Select the sequence to copy.");}
      }}>Copy FASTA</button><p role="status">{copied}</p>
      <h3>Case / Control carriers</h3>
      {Object.entries(data.groups).map(([name,g])=><div className="cohort-row" key={name}><div><span>{name}</span><strong>{g.carriers}/{g.total} · {g.frequency===null?"N/A":`${(g.frequency*100).toFixed(1)}%`}</strong></div><div className="cohort-bar"><span style={{width:`${(g.frequency??0)*100}%`,background:name==="Case"?"#F97316":name==="Control"?"#38BDF8":"#94a3b8"}} /></div></div>)}
      <p className="filter-note">{data.frequency_definition}. Full database cohort; sidebar selection affects canvas only.</p>
      <h3>Carrier samples</h3><ul>{data.samples.map(s=><li key={s.sample_id}>{s.sample_id} <span className="muted">· {s.group_name}</span></li>)}</ul>
      <h3>Simulated functional annotation</h3><p className="mock-annotation">{data.annotation.source}</p><p>{data.annotation.gene}</p><p>{data.annotation.function}</p><p>{data.annotation.consequence}</p>
    </>}
  </aside>;
}
