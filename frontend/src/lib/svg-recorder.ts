/** Vector snapshot of the same Canvas commands; Path2D geometry is registered explicitly. */
const esc=(s:unknown)=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
export function recordSVG(context:CanvasRenderingContext2D, paths:WeakMap<Path2D,string>, width:number,height:number){
  let elements:string[]=[], path='',groups=0,serial=0;
  const stack:number[]=[];
  const paint=(stroke=false)=>`fill="${stroke?'none':esc(context.fillStyle)}" stroke="${stroke?esc(context.strokeStyle):'none'}" stroke-width="${context.lineWidth}" opacity="${context.globalAlpha}" stroke-linecap="${context.lineCap}" stroke-linejoin="${context.lineJoin}" ${stroke?`stroke-dasharray="${context.getLineDash().join(' ')}" stroke-dashoffset="${context.lineDashOffset}"`:''}`;
  const proxy=new Proxy(context,{get(target,key){
    const value=Reflect.get(target,key,target);
    if(typeof value!=='function')return value;
    return (...args:unknown[])=>{
      const a=args as number[];
      if(key==='clearRect'){elements=[];groups=0;stack.length=0;}
      if(key==='beginPath')path='';
      if(key==='moveTo')path+=`M ${a[0]} ${a[1]} `;
      if(key==='lineTo')path+=`L ${a[0]} ${a[1]} `;
      if(key==='bezierCurveTo')path+=`C ${a.join(' ')} `;
      if(key==='closePath')path+='Z ';
      if(key==='rect')path+=`M ${a[0]} ${a[1]} h ${a[2]} v ${a[3]} h ${-a[2]} Z `;
      if(key==='roundRect'){
        const [x,y,w,h,r0]=a,r=Math.min(r0,w/2,h/2);
        path+=`M ${x+r} ${y} H ${x+w-r} Q ${x+w} ${y} ${x+w} ${y+r} V ${y+h-r} Q ${x+w} ${y+h} ${x+w-r} ${y+h} H ${x+r} Q ${x} ${y+h} ${x} ${y+h-r} V ${y+r} Q ${x} ${y} ${x+r} ${y} Z `;
      }
      if(key==='save')stack.push(groups);
      if(key==='restore'){const depth=stack.pop()??0;while(groups>depth){elements.push('</g>');groups--;}}
      if(key==='clip'){const id=`clip${serial++}`;elements.push(`<defs><clipPath id="${id}"><path d="${path}"/></clipPath></defs><g clip-path="url(#${id})">`);groups++;}
      if(key==='stroke'||key==='fill'){
        let glow='';if(key==='stroke'&&context.shadowBlur>0){const id=`glow${serial++}`;elements.push(`<defs><filter id="${id}" x="-100%" y="-100%" width="300%" height="300%"><feDropShadow dx="0" dy="0" stdDeviation="${context.shadowBlur/3}" flood-color="${esc(context.shadowColor)}"/></filter></defs>`);glow=`filter="url(#${id})"`;}
        elements.push(`<path d="${args[0] instanceof Path2D?paths.get(args[0])??'':path}" ${paint(key==='stroke')} ${glow}/>`);
      }
      if(key==='fillRect')elements.push(`<rect x="${a[0]}" y="${a[1]}" width="${a[2]}" height="${a[3]}" ${paint()}/>`);
      if(key==='fillText'){
        const font=context.font, size=font.match(/([\d.]+)px/)?.[1]??'12';
        elements.push(`<text x="${args[1]}" y="${args[2]}" font-size="${size}" font-weight="${font.includes('600')?'600':'400'}" font-family="Public Sans,Arial,sans-serif" text-anchor="${context.textAlign==='center'?'middle':context.textAlign==='right'?'end':'start'}" ${paint()}>${esc(args[0])}</text>`);
      }
      return value.apply(target,args);
    };
  },set(target,key,value){Reflect.set(target,key,value,target);return true;}});
  return {context:proxy,serialize:()=>`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>Pan-Genome Tube Map</title>${elements.join('')}${'</g>'.repeat(groups)}</svg>`};
}

export function downloadBlob(blob:Blob,name:string){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  window.setTimeout(()=>URL.revokeObjectURL(url),10000);
}
