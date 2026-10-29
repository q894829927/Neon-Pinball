/** One credit -> one visible ball for payouts that fit; excess stays counted exactly. */
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function basinPacking(width,height,total){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||
    !Number.isSafeInteger(total)||total<0)throw new Error("Invalid basin layout");
  const r=clamp(Math.sqrt(width*height/Math.max(1,total))*.34,.52,3.3);
  const pitch=2*r+.13;
  const columns=Math.max(1,Math.floor((width-2*r-2)/pitch));
  const rows=Math.max(1,Math.floor((height-2*r-2)/pitch));
  return Object.freeze({radius:r,pitch,columns,rows,capacity:columns*rows,
    visible:Math.min(total,columns*rows),stored:total});
}
export function basinPosition(index,packing,width,height){
  if(!Number.isInteger(index)||index<0||index>=packing.capacity)
    throw new Error("Basin index out of range");
  const row=Math.floor(index/packing.columns),column=index%packing.columns;
  return {
    x:clamp(packing.radius+1+(column+.5*(row%2))*packing.pitch,
      packing.radius+1,width-packing.radius-1),
    y:clamp(height-packing.radius-1-row*packing.pitch,
      packing.radius+1,height-packing.radius-1)
  };
}
export function basinVisibleCount(total,packing){
  return Math.min(Math.max(0,total),packing.capacity);
}
