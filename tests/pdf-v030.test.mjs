import test from 'node:test';
import assert from 'node:assert/strict';
import {createRenderQueue,pageWindow,capturePosition,restorePosition} from '../web/pdf-queue.mjs';
import {mountPDFWithLibrary} from '../web/pdf.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};

class Events{
 constructor(){this.listeners=new Map();}
 addEventListener(name,fn){const list=this.listeners.get(name)||new Set();list.add(fn);this.listeners.set(name,list);}
 removeEventListener(name,fn){this.listeners.get(name)?.delete(fn);}
 emit(name,event={}){for(const fn of this.listeners.get(name)||[])fn(event);}
}
class Element extends Events{
 constructor(doc,tag='div'){super();this.ownerDocument=doc;this.tag=tag;this.children=[];this.style={setProperty(name,value){this[name]=value;}};this.dataset={};this.className='';this.scrollTop=0;this.scrollLeft=0;this.clientWidth=800;this.clientHeight=800;this.width=0;this.height=0;}
 append(...items){for(const item of items){if(item.tag==='fragment'){this.append(...[...item.children]);continue;}item.remove();item.parentElement=this;this.children.push(item);}}
 replaceChildren(...items){for(const item of this.children)item.parentElement=null;this.children=[];this.append(...items);}
 remove(){if(!this.parentElement)return;const siblings=this.parentElement.children;const index=siblings.indexOf(this);if(index>=0)siblings.splice(index,1);this.parentElement=null;}
 get offsetTop(){if(!this.parentElement)return 0;let top=24;for(const item of this.parentElement.children){if(item===this)break;top+=(parseFloat(item.style.height)||0)+16;}return top;}
 get scrollHeight(){return 48+this.children.reduce((total,item)=>total+(parseFloat(item.style.height)||0)+16,0);}
 getBoundingClientRect(){return {top:this.offsetTop-(this.parentElement?.scrollTop||0),left:24,width:parseFloat(this.style.width)||0,height:parseFloat(this.style.height)||0};}
 getContext(){return {};}
 closest(name){return name==='.ls-pdf-page'&&this.className==='ls-pdf-page'?this:this.parentElement?.closest(name);}
}
class Document extends Events{
 constructor(){super();this.baseURI='https://synthetic.test/';this.selection=null;this.frames=new Set();this.defaultView={devicePixelRatio:2,requestAnimationFrame:callback=>{const id={};this.frames.add(id);queueMicrotask(()=>{if(this.frames.delete(id))callback();});return id;},cancelAnimationFrame:id=>this.frames.delete(id)};}
 createElement(name){return new Element(this,name);}
 createDocumentFragment(){return new Element(this,'fragment');}
 getSelection(){return this.selection;}
 select(...pages){this.selection=pages.length?{isCollapsed:false,rangeCount:1,getRangeAt:()=>({intersectsNode:element=>pages.includes(Number(element.dataset.page))})}:null;this.emit('selectionchange');}
}
function syntheticPDF({count=100,delay=0,pageGate}={}){
 const state={active:0,peak:0,cancelled:0,destroyed:0,cleaned:[],canvases:[],pages:[],textLayers:[]};
 const job=(name,done)=>{
  const wait=deferred();let settled=false;
  if(name==='canvas'){state.active++;state.peak=Math.max(state.peak,state.active);}
  const settle=(error)=>{if(settled)return;settled=true;clearTimeout(timer);if(name==='canvas')state.active--;if(error)wait.reject(error);else{done?.();wait.resolve();}};
  const timer=setTimeout(()=>settle(),delay);
  return {promise:wait.promise,cancel(){state.cancelled++;const error=new Error('cancelled');error.name='RenderingCancelledException';settle(error);}};
 };
 const pages=Array.from({length:count},(_,index)=>({
  getViewport:({scale})=>({width:600*scale,height:800*scale}),
  render({canvasContext}){state.pages.push(index+1);return job('canvas');},
  getTextContent:async()=>({page:index+1}),
  cleanup(){state.cleaned.push(index+1);return true;}
 }));
 const pdf={numPages:count,async getPage(number){if(pageGate&&number!==1)await pageGate.promise;return pages[number-1];}};
 const library={GlobalWorkerOptions:{},getDocument:()=>({promise:Promise.resolve(pdf),destroy(){state.destroyed++;return Promise.resolve();}}),TextLayer:class{
  constructor({container,textContentSource}){this.container=container;this.source=textContentSource;state.textLayers.push(this);}
  render(){const text=this.container.ownerDocument.createElement('span');text.textContent='Synthetic page '+this.source.page;this.task=job('text',()=>this.container.append(text));return this.task.promise;}
  cancel(){this.task?.cancel();}
 }};
 return {library,state};
}
async function mounted(options={}){
 const doc=new Document(),parent=doc.createElement('section'),errors=[],fixture=syntheticPDF(options);
 const viewer=await mountPDFWithLibrary(fixture.library,parent,'/pdf?projectId=synthetic&jobId=1',{base:'/assets/',onError:error=>errors.push(error.message)});
 await viewer.whenIdle();return {...fixture,doc,parent,viewer,errors};
}
const rendered=parent=>parent.children.filter(element=>element.children.some(child=>child.tag==='canvas'));
async function scrollTo(fixture,page){fixture.parent.scrollTop=fixture.parent.children[page-1].offsetTop;fixture.parent.emit('scroll');await tick();await fixture.viewer.whenIdle();}

test('render queue remains bounded and cancels obsolete work before starting its replacement',async()=>{
 const started=[],gates=new Map(),errors=[];let active=0,peak=0;
 const queue=createRenderQueue({render:async(id,{signal})=>{
  started.push(id);active++;peak=Math.max(peak,active);const gate=deferred();gates.set(id,gate);
  const cancel=()=>gate.resolve();signal.addEventListener('abort',cancel,{once:true});
  try{await gate.promise;}finally{active--;signal.removeEventListener('abort',cancel);}
 },onError:error=>errors.push(error)});
 queue.update([{id:1,priority:1},{id:2,priority:0},{id:3,priority:2}]);await tick();assert.deepEqual(started,[2]);
 queue.update([{id:50,priority:0}]);await tick();assert.deepEqual(started,[2,50]);assert.equal(peak,1);assert.equal(queue.stats().cancelled,1);
 gates.get(50).resolve();await queue.whenIdle();assert.equal(queue.stats().completed,1);assert.deepEqual(errors,[]);
 // Re-entering the same page before cancellation settles must not lose its job.
 queue.update([{id:60}]);await tick();queue.update([]);queue.update([{id:60}]);await tick();assert.deepEqual(started.slice(-2),[60,60]);
 queue.close();await queue.whenIdle();assert.equal(queue.stats().active,0);assert.equal(queue.stats().queued,0);
});

test('page window prioritizes visible pages and reads logarithmically rather than scanning the document',()=>{
 let reads=0;const bounds=index=>{reads++;return {top:24+index*816,height:800};};
 const result=pageWindow(1000,bounds,24+500*816,800);
 assert.deepEqual(result.visible,[500]);assert.deepEqual(result.render,[500,499,501]);assert.ok(result.retain.length<=7);assert.ok(reads<80);
 assert.deepEqual(pageWindow(1000,bounds,24+999*816,800).visible,[999]);
 const saved=capturePosition(1000,bounds,24+500*816+300,800,1.25,50);
 const target=restorePosition(saved,index=>({top:24+index*(800*1.5+16),height:800*1.5}),1.875);
 assert.equal(saved.page,501);assert.equal(target.top,24+500*1216+(saved.y*1.875)-saved.viewY);assert.equal(target.left,75);
});

test('a long PDF recycles far canvases and text layers, keeps selection, and never grows with pages visited',async()=>{
 const fixture=await mounted(),{parent,viewer,state,doc}=fixture;
 try{
  assert.ok(rendered(parent).length<=7);assert.equal(parent.children.length,100);assert.equal(viewer.stats().peakActive,1);
  const oldCanvas=parent.children[0].children.find(child=>child.tag==='canvas');assert.ok(oldCanvas.width>0);
  for(const page of [20,40,60,80,99]){await scrollTo(fixture,page);assert.ok(rendered(parent).length<=7);assert.ok(viewer.stats().resident<=7);}
  assert.equal(oldCanvas.width,0);assert.equal(oldCanvas.height,0);assert.equal(parent.children[0].children.length,0);assert.ok(state.cleaned.includes(1));
  await scrollTo(fixture,70);const selectedPage=parent.children[69],layer=selectedPage.children.find(child=>child.className==='textLayer');assert.ok(layer.children.length);
  doc.select(70);await scrollTo(fixture,90);assert.ok(selectedPage.children.includes(layer),'a live selection is retained');assert.ok(rendered(parent).length<=7);
  doc.select();await tick();await viewer.whenIdle();assert.equal(selectedPage.children.length,0);
  assert.equal(Number(parent.dataset.pdfActive),0);assert.equal(Number(parent.dataset.pdfResident),rendered(parent).length);assert.ok(viewer.stats().canvasBytes<=7*4_000_000*4);assert.deepEqual(fixture.errors,[]);
 }finally{viewer.destroy();await viewer.whenIdle();}
 assert.equal(state.destroyed,1);assert.equal(rendered(parent).length,0);assert.equal(viewer.stats().resident,0);
});

test('zoom and new successful build preserve the page and natural position; inverse SyncTeX coordinates remain correct',async()=>{
 const fixture=await mounted({count:50}),{viewer,parent,library}=fixture;let point;
 viewer.jump({page:30,y:320});await viewer.whenIdle();const before=viewer.position();
 await viewer.zoom(1.2);const after=viewer.position();assert.equal(after.page,before.page);assert.ok(Math.abs(after.y-before.y)<0.0001);
 const currentScale=viewer.stats().scale;viewer.destroy();await viewer.whenIdle();
 const replacement=await mountPDFWithLibrary(library,parent,'/pdf?projectId=synthetic&jobId=2',{base:'/assets/',onJump:value=>point=value});
 try{
  await replacement.whenIdle();assert.equal(replacement.stats().scale,currentScale);assert.equal(replacement.position().page,after.page);assert.ok(Math.abs(replacement.position().y-after.y)<0.0001);
  const page=parent.children[29],rect=page.getBoundingClientRect();parent.emit('dblclick',{target:page.children[0],clientX:rect.left+80*currentScale,clientY:rect.top+200*currentScale});
  assert.equal(point.page,30);assert.ok(Math.abs(point.x-80)<0.0001);assert.ok(Math.abs(point.y-200)<0.0001);
 }finally{replacement.destroy();await replacement.whenIdle();}
});

test('rapid zoom, scroll, abort and a delayed page fetch cannot append stale layers or leak render slots',async()=>{
 const fixture=await mounted({count:50,delay:3}),{viewer,parent,state}=fixture;
 viewer.jump({page:25,y:0});const a=viewer.zoom(1.2),b=viewer.zoom(1.2),c=viewer.zoom(0.8);viewer.jump({page:40,y:100});
 await Promise.all([a,b,c]);await viewer.whenIdle();assert.equal(viewer.stats().generation,3);assert.equal(state.peak,1);assert.equal(viewer.stats().peakActive,1);assert.ok(rendered(parent).length<=7);assert.deepEqual(fixture.errors,[]);
 const gate=deferred(),doc=new Document(),host=doc.createElement('section'),delayed=syntheticPDF({count:20,pageGate:gate}),controller=new AbortController();
 const late=await mountPDFWithLibrary(delayed.library,host,'/pdf?projectId=late',{base:'/assets/',signal:controller.signal});
 await tick();late.jump({page:10,y:50});await tick();controller.abort();gate.resolve();await late.whenIdle();assert.equal(late.stats().active,0);assert.equal(rendered(host).length,0);assert.equal(delayed.state.destroyed,1);assert.equal(late.stats().resident,0);
 viewer.destroy();await viewer.whenIdle();assert.equal(rendered(parent).length,0);
});

test('a hidden host window does not start painting new pages, and resumes at its latest position',async()=>{
 const fixture=await mounted({count:50}),{viewer,parent,state}=fixture;
 try{
  viewer.setActive(false);const before=state.pages.length;
  viewer.jump({page:30});await tick();assert.equal(state.pages.length,before);assert.equal(parent.dataset.pdfPaused,'true');
  viewer.setActive(true);await viewer.whenIdle();assert.ok(state.pages.includes(30));assert.equal(parent.dataset.pdfPaused,'false');
 }finally{viewer.destroy();await viewer.whenIdle();}
});

test('drawing stays detached until completion and finished bitmap ownership is released on teardown',async()=>{
 const doc=new Document(),parent=doc.createElement('section'),fixture=syntheticPDF({count:4}),surfaces=[],bitmaps=[];
 const create=doc.createElement.bind(doc);doc.createElement=name=>{
  const element=create(name);if(name==='canvas'){
   surfaces.push(element);element.getContext=kind=>kind==='bitmaprenderer'?{transferFromImageBitmap(bitmap){bitmap.transferred=true;}}:{};
  }return element;
 };
 doc.defaultView.createImageBitmap=async canvas=>{
  assert.equal(canvas.parentElement,undefined,'unfinished drawing must not invalidate the scrolling tree');
  const bitmap={transferred:false,closed:false,close(){this.closed=true;}};bitmaps.push(bitmap);return bitmap;
 };
 const viewer=await mountPDFWithLibrary(fixture.library,parent,'/pdf',{base:'/assets/'});
 try{
  await viewer.whenIdle();assert.ok(bitmaps.length);assert.ok(bitmaps.every(bitmap=>bitmap.transferred&&!bitmap.closed));
  assert.ok(surfaces.some(canvas=>canvas.width===0),'the original drawing surface is released');
  assert.ok(rendered(parent).length);assert.ok(rendered(parent).every(page=>page.children.find(child=>child.tag==='canvas').width>0));
 }finally{viewer.destroy();await viewer.whenIdle();}
 assert.ok(surfaces.every(canvas=>canvas.width===0&&canvas.height===0));
});

test('an aborted asynchronous bitmap conversion cannot attach a stale page or leak its bitmap',async()=>{
 const doc=new Document(),parent=doc.createElement('section'),fixture=syntheticPDF({count:4}),gate=deferred();let requested=false,closed=0;
 doc.defaultView.createImageBitmap=()=>{requested=true;return gate.promise;};
 const viewer=await mountPDFWithLibrary(fixture.library,parent,'/pdf',{base:'/assets/'});
 while(!requested)await tick();viewer.destroy();gate.resolve({close(){closed++;}});await viewer.whenIdle();
 assert.equal(closed,1);assert.equal(rendered(parent).length,0);assert.equal(viewer.stats().canvasBytes,0);
});
