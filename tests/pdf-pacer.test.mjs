import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderPacer} from '../web/pdf-pacer.mjs';
import {createRenderQueue} from '../web/pdf-queue.mjs';

function clock(){
 let time=0,id=0;const timers=new Map();
 return {now:()=>time,setTimer(fn,delay){const key=++id;timers.set(key,{at:time+delay,fn});return key;},clearTimer:key=>timers.delete(key),
  advance(ms){const end=time+ms;while(true){const next=[...timers].filter(([,task])=>task.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;},get count(){return timers.size;}};
}

test('PDF painting yields whole frames, and repeated input postpones rather than duplicates the continuation',()=>{
 const time=clock(),pauses=[],calls=[];
 const pacer=createRenderPacer({...time,quietMs:160,onPause:value=>pauses.push(value)});
 pacer.defer(()=>calls.push(time.now()));time.advance(23);assert.deepEqual(calls,[]);
 time.advance(1);assert.deepEqual(calls,[24]);
 pacer.defer(()=>calls.push(time.now()));pacer.interrupt();time.advance(100);pacer.interrupt();time.advance(159);
 assert.deepEqual(calls,[24]);assert.deepEqual(pauses,[true]);
 time.advance(1);assert.deepEqual(calls,[24,284]);assert.deepEqual(pauses,[true,false]);assert.equal(time.count,0);
 pacer.close();
});

test('hidden viewers hold work until visible; cancelled or closed continuations never resume',()=>{
 const time=clock(),calls=[],pacer=createRenderPacer({...time});
 pacer.setSuspended(true);pacer.defer(()=>calls.push('visible'));const cancel=pacer.defer(()=>calls.push('cancelled'));cancel();
 time.advance(60000);assert.deepEqual(calls,[]);assert.equal(time.count,0);
 pacer.setSuspended(false);time.advance(24);assert.deepEqual(calls,['visible']);
 pacer.defer(()=>calls.push('closed'));pacer.close();time.advance(60000);assert.deepEqual(calls,['visible']);assert.equal(time.count,0);
});

test('a paused render queue preserves the latest viewport without starting background pages',async()=>{
 const started=[],queue=createRenderQueue({render:async id=>started.push(id)});
 queue.setPaused(true);queue.update([{id:1},{id:2}]);queue.update([{id:50}]);await new Promise(resolve=>setTimeout(resolve,0));
 assert.deepEqual(started,[]);assert.equal(queue.stats().queued,1);
 queue.setPaused(false);await queue.whenIdle();assert.deepEqual(started,[50]);assert.equal(queue.stats().active,0);
 queue.close();
});

test('an unchanged viewport does not wake an idle queue or repeat DOM notifications',async()=>{
 let changes=0;const started=[],queue=createRenderQueue({render:async id=>started.push(id),onChange:()=>changes++});
 queue.setPaused(true);queue.update([{id:1}]);await new Promise(resolve=>setTimeout(resolve,0));const pending=changes;
 for(let i=0;i<100;i++)queue.update([{id:1}]);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(changes,pending);
 queue.setPaused(false);await queue.whenIdle();const idle=changes;
 for(let i=0;i<100;i++)queue.update([]);await new Promise(resolve=>setTimeout(resolve,0));assert.equal(changes,idle);assert.deepEqual(started,[1]);queue.close();
});
