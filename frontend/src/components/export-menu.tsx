"use client";
import { useState } from "react";
import type { Region } from "@/lib/types";
import { downloadBlob } from "@/lib/svg-recorder";
export function ExportMenu({region,selected,ready}:{region:Region;selected:Set<string>;ready:boolean}){
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  async function save(format:"gfa"|"fasta"){
    if(!selected.size){setError("Select at least one sample path.");return;}
    setBusy(true);setError("");
    try{const query=new URLSearchParams({start:String(region.start),end:String(region.end),format});selected.forEach(id=>query.append("sample",id));
      const response=await fetch(`/api/export?${query}`);if(!response.ok){const body=await response.json();throw new Error(typeof body.detail==="string"?body.detail:"Export failed");}
      downloadBlob(await response.blob(),`pangenome-${region.start}-${region.end}.${format}`);
    }catch(e){setError(e instanceof Error?e.message:"Export failed");}finally{setBusy(false);}
  }
  return <div className="sequence-export"><button disabled={!ready||busy} onClick={()=>window.dispatchEvent(new CustomEvent("tube-export",{detail:"png"}))}>PNG 4×</button><button disabled={!ready||busy} onClick={()=>window.dispatchEvent(new CustomEvent("tube-export",{detail:"svg"}))}>SVG</button><button disabled={!ready||busy} onClick={()=>save("gfa")}>Export GFA</button><button disabled={!ready||busy} onClick={()=>save("fasta")}>Export FASTA</button>{error&&<span role="alert">{error}</span>}</div>;
}
