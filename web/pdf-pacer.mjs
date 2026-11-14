// PDF.js parses in its worker, but paints on the UI thread. Leave whole frames
// for typing/scrolling between paint chunks, and stop painting during input.
export function createRenderPacer({onPause,quietMs=200,yieldMs=24,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const pending=new Set();let timer,until=0,suspended=false,closed=false,paused=false;
 const isPaused=()=>suspended||now()<until;
 const sync=()=>{const next=isPaused();if(next!==paused){paused=next;onPause?.(next);}};
 const arm=()=>{
  if(timer!==undefined)clearTimer(timer);timer=undefined;
  sync();if(closed||suspended)return;
  const wait=Math.max(0,until-now());if(!wait&&!pending.size)return;
  timer=setTimer(()=>{timer=undefined;sync();if(isPaused()){arm();return;}const callbacks=[...pending];pending.clear();for(const callback of callbacks)callback();arm();},Math.max(wait,yieldMs));
 };
 return {
  defer(callback){if(closed)return()=>{};pending.add(callback);arm();return()=>{pending.delete(callback);arm();};},
  interrupt(){if(closed)return;until=now()+quietMs;arm();},
  setSuspended(value){if(closed)return;suspended=Boolean(value);arm();},
  close(){closed=true;if(timer!==undefined)clearTimer(timer);timer=undefined;pending.clear();},
  get paused(){return isPaused();}
 };
}
