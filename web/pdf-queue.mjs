// A cancelled worker keeps its slot until it settles: rapid scroll/zoom cannot
// leave a second PDF.js render running behind an abandoned promise.
export function createRenderQueue({render,onError,onChange,maxConcurrent=1}){
 const active=new Map(),waiters=new Set();let pending=new Map(),closed=false,scheduled=false,paused=false;
 const counts={completed:0,cancelled:0,failed:0,peakActive:0};
 const stats=()=>({active:active.size,queued:pending.size,...counts,closed,paused});
 const notify=()=>{onChange?.(stats());if(!active.size&&!pending.size){for(const resolve of waiters)resolve();waiters.clear();}};
 const cancel=controller=>{if(!controller.signal.aborted){counts.cancelled++;controller.abort();}};
 const pump=()=>{
  scheduled=false;if(closed||paused){notify();return;}
  while(active.size<maxConcurrent&&pending.size){
   const next=[...pending].filter(([id])=>!active.has(id)).sort((a,b)=>a[1]-b[1])[0];if(!next)break;
   const [id]=next;pending.delete(id);
   const controller=new AbortController();active.set(id,controller);counts.peakActive=Math.max(counts.peakActive,active.size);notify();
   Promise.resolve().then(()=>render(id,{signal:controller.signal})).then(()=>{if(!controller.signal.aborted)counts.completed++;},error=>{if(!controller.signal.aborted){counts.failed++;onError?.(error,id);}}).finally(()=>{active.delete(id);schedule();notify();}).catch(()=>{});
  }
  notify();
 };
 const schedule=()=>{if(!scheduled){scheduled=true;queueMicrotask(pump);}};
 return {
  update(entries){
   if(closed)return;
   const wanted=new Map(entries.map(({id,priority=0})=>[id,priority]));
   let changed=false;
   for(const [id,controller] of active)if(!wanted.has(id)&&!controller.signal.aborted){cancel(controller);changed=true;}
   const next=new Map([...wanted].filter(([id])=>!active.has(id)||active.get(id).signal.aborted));
   if(!changed&&next.size===pending.size&&[...next].every(([id,priority])=>pending.get(id)===priority))return;
   pending=next;schedule();notify();
  },
  close(){if(closed)return;closed=true;pending.clear();for(const controller of active.values())cancel(controller);notify();},
  setPaused(value){paused=Boolean(value);if(!paused)schedule();notify();},
  whenIdle(){return active.size||pending.size?new Promise(resolve=>waiters.add(resolve)):Promise.resolve();},
  stats
 };
}

// Read only O(log(page count) + visible pages) layout boxes per scroll frame.
// Indices are zero based; visible pages always outrank the one-page prefetch.
export function pageWindow(count,bounds,top,height,{preload=1,retain=2,limit=7}={}){
 if(!count)return {visible:[],render:[],retain:[],first:0,last:0};
 const bottom=top+Math.max(1,height),center=(top+bottom)/2;
 const lowerBound=test=>{let lo=0,hi=count;while(lo<hi){const mid=(lo+hi)>>1;if(test(bounds(mid)))hi=mid;else lo=mid+1;}return Math.min(count-1,lo);};
 const first=lowerBound(box=>box.top+box.height>top),last=Math.max(first,lowerBound(box=>box.top>=bottom)-1);
 // The last page is also visible when bottom extends beyond the document.
 const end=bounds(count-1);const final=bottom>end.top?count-1:last;
 const visible=Array.from({length:final-first+1},(_,i)=>first+i);
 const distance=index=>{const box=bounds(index);return Math.abs(box.top+box.height/2-center);};
 const ordered=overscan=>{
  const start=Math.max(0,first-overscan),stop=Math.min(count-1,final+overscan),items=[];
  for(let i=start;i<=stop;i++)items.push(i);
  return items.sort((a,b)=>Number(a<first||a>final)-Number(b<first||b>final)||distance(a)-distance(b)).slice(0,Math.max(limit,visible.length));
 };
 return {visible,render:ordered(preload),retain:ordered(retain),first,last:final};
}

export function capturePosition(count,bounds,top,height,scale,scrollLeft=0){
 const viewY=Math.min(120,Math.max(0,height)/3),page=pageWindow(count,bounds,top+viewY,1,{preload:0,retain:0,limit:1}).first;
 return {page:page+1,y:(top+viewY-bounds(page).top)/scale,viewY,x:scrollLeft/scale};
}

export function restorePosition(position,bounds,scale){
 return {top:bounds(position.page-1).top+position.y*scale-position.viewY,left:Math.max(0,position.x*scale)};
}
