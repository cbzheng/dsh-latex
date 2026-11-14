import {createRenderQueue,pageWindow,capturePosition,restorePosition} from './pdf-queue.mjs';
import {createRenderPacer} from './pdf-pacer.mjs';

const MAX_RESIDENT_PAGES=7,MIN_RESIDENT_PAGES=2,MAX_CANVAS_PIXELS=4_000_000;
const owners=new WeakMap(),positions=new WeakMap();
const clampScale=value=>Math.max(0.35,Math.min(3,value));
const resourceKey=(url,doc)=>{try{const key=new URL(url,doc.baseURI||globalThis.location?.href);key.searchParams.delete('jobId');return key.href;}catch{return url;}};

export async function mountPDF(parent,url,options={}){
 if(options.signal?.aborted)return;
 return mountPDFWithLibrary(await import('pdfjs-dist/legacy/build/pdf.mjs'),parent,url,options);
}

// The library boundary permits synthetic cancellation tests without a browser.
// The installed application always uses the real PDF.js module above.
export async function mountPDFWithLibrary(pdfjs,parent,url,{base,onJump,onError,signal,onStats}={}){
 if(signal?.aborted)return;
 const doc=parent.ownerDocument,view=doc.defaultView||globalThis,key=resourceKey(url,doc),owner={};
 owners.set(parent,owner);
 pdfjs.GlobalWorkerOptions.workerSrc=base+'pdf.worker.mjs';
 const loading=pdfjs.getDocument({url,cMapUrl:base+'cmaps/',cMapPacked:true,standardFontDataUrl:base+'standard_fonts/',wasmUrl:base+'wasm/'});
 const pages=[],resident=new Set();let pdf,disposed=false,scale=1,generation=0,queue,frame,resizeObserver,active=true,readingPosition=null,residentLimit=MAX_RESIDENT_PAGES;
 const pacer=createRenderPacer({onPause:paused=>queue?.setPaused(paused)});
 const requestFrame=view.requestAnimationFrame?.bind(view)||(callback=>setTimeout(callback,16));
 const cancelFrame=view.cancelAnimationFrame?.bind(view)||clearTimeout;
 const owns=()=>owners.get(parent)===owner;
 const bounds=index=>({top:pages[index].top,height:pages[index].height});
 // Measure once after geometry changes. Inferring a repeated gap from rounded
 // offsetTop values accumulates an error across long, fractionally sized pages.
 const measure=()=>{for(const record of pages)record.top=record.el.offsetTop;};
 const position=()=>pages.length?capturePosition(pages.length,bounds,parent.scrollTop,parent.clientHeight,scale,parent.scrollLeft):null;
 const stats=(readPosition=true)=>({...(queue?.stats()||{active:0,queued:0}),pages:pages.length,resident:resident.size,
  canvasBytes:[...resident].reduce((total,record)=>total+(record.operation?.canvas?.width||0)*(record.operation?.canvas?.height||0)*4,0),
  scale,position:readPosition?position():readingPosition,generation,disposed,maxResident:residentLimit,maxCanvasPixels:MAX_CANVAS_PIXELS});
 const notify=()=>{
  if(!owns())return;const value=stats(false);
  const attributes={pdfActive:String(value.active),pdfQueued:String(value.queued),pdfResident:String(value.resident),pdfCanvasBytes:String(value.canvasBytes),pdfPage:String(value.position?.page||1),pdfPaused:String(pacer.paused)};
  for(const [name,next] of Object.entries(attributes))if(parent.dataset[name]!==next)parent.dataset[name]=next;
  onStats?.(value);
 };
 const cleanup=operation=>{if(operation?.page&&operation.settled&&!operation.cleaned){operation.cleaned=true;try{operation.page.cleanup();}catch{}}};
 const release=record=>{
  const operation=record.operation;if(!operation)return;
  operation.cancelled=true;operation.cancelResume?.();try{operation.task?.cancel();}catch{}try{operation.text?.cancel();}catch{}
  if(operation.canvas){operation.canvas.width=0;operation.canvas.height=0;operation.canvas.remove();}
  operation.layer?.remove();record.operation=null;resident.delete(record);
  record.status='idle';record.el.dataset.rendered='false';record.el.dataset.status='idle';cleanup(operation);
 };
 const restore=anchor=>{if(!anchor||!pages.length)return;const value=restorePosition({...anchor,page:Math.min(pages.length,anchor.page)},bounds,scale);parent.scrollTop=value.top;parent.scrollLeft=value.left;};
 const schedule=()=>{if(disposed||!owns()||frame!==undefined)return;frame=requestFrame(()=>{frame=undefined;reconcile();});};
 const selected=()=>{
  const protectedPages=new Set(),selection=doc.getSelection?.();if(!selection||selection.isCollapsed)return protectedPages;
  for(const record of resident)for(let i=0;i<selection.rangeCount;i++){
   try{if(selection.getRangeAt(i).intersectsNode(record.el)){protectedPages.add(record);break;}}catch{}
  }
  return protectedPages;
 };
 const reconcile=()=>{
  if(disposed||!owns()||!pages.length)return;
  readingPosition=position();
  const window=pageWindow(pages.length,bounds,parent.scrollTop,parent.clientHeight,{preload:0}),protectedPages=selected();
  // Selected text layers consume the same bounded cache budget as other pages.
  const slots=Math.max(0,residentLimit-protectedPages.size);
  const targets=window.render.map(index=>pages[index]).filter(record=>!protectedPages.has(record)).slice(0,slots);
  const keep=new Set(protectedPages);
  for(const record of [...targets,...window.retain.map(index=>pages[index])])if(keep.size<residentLimit)keep.add(record);
  for(const record of resident)if(!keep.has(record))release(record);
  const wanted=[...protectedPages,...targets].filter(record=>record.status!=='ready'&&record.status!=='error');
  queue.update(wanted.map((record,priority)=>({id:record.queueKey,priority})));notify();
 };
 const renderPage=async({record,epoch},{signal:cancelled})=>{
  if(disposed||!owns()||epoch!==generation||cancelled.aborted)return;
  const operation={epoch,settled:false};record.operation=operation;record.status='rendering';record.el.dataset.status='rendering';
  const valid=()=>!disposed&&owns()&&!cancelled.aborted&&epoch===generation&&record.operation===operation;
  const cancel=()=>{if(record.operation===operation)release(record);};cancelled.addEventListener('abort',cancel,{once:true});
  try{
   operation.page=await pdf.getPage(record.number);if(!valid())return;
   const natural=operation.page.getViewport({scale:1}),viewport=operation.page.getViewport({scale});
   if(record.width!==viewport.width||record.height!==viewport.height){
    const anchor=position();record.natural=natural;record.width=viewport.width;record.height=viewport.height;
    record.el.style.width=viewport.width+'px';record.el.style.height=viewport.height+'px';measure();restore(anchor);schedule();
   }
   const ratio=Math.min(view.devicePixelRatio||1,2,Math.sqrt(MAX_CANVAS_PIXELS/(viewport.width*viewport.height)));
   const canvas=operation.canvas=doc.createElement('canvas');
   canvas.width=Math.max(1,Math.floor(viewport.width*ratio));canvas.height=Math.max(1,Math.floor(viewport.height*ratio));
   canvas.style.width=viewport.width+'px';canvas.style.height=viewport.height+'px';resident.add(record);notify();
   // Match PDF.js's default opaque, software-backed canvas options.
   const task=operation.task=operation.page.render({canvasContext:canvas.getContext('2d',{alpha:false,willReadFrequently:true}),viewport,transform:[ratio,0,0,ratio,0,0]});
   task.onContinue=resume=>{operation.cancelResume?.();operation.cancelResume=pacer.defer(()=>{operation.cancelResume=null;if(valid())resume();});};
   await task.promise;operation.task=null;if(!valid())return;
   // Present a finished bitmap when available; the drawing surface can then be
   // released while the independent text layer stays selectable.
   if(view.createImageBitmap){
    let bitmap;try{
     bitmap=await view.createImageBitmap(canvas);if(!valid())return;
     const presentation=doc.createElement('canvas'),context=presentation.getContext('bitmaprenderer');
     if(context){
      presentation.width=canvas.width;presentation.height=canvas.height;presentation.style.width=canvas.style.width;presentation.style.height=canvas.style.height;
      context.transferFromImageBitmap(bitmap);bitmap=null;canvas.width=0;canvas.height=0;operation.canvas=presentation;
     }
    }catch{/* Keep the completed 2D canvas on older browser implementations. */}finally{bitmap?.close();}
   }
   if(!valid())return;
   // Keep the drawing surface detached until complete. Painting every partial
   // PDF.js slice into the scrolling tree competes with editor/input updates.
   record.el.append(operation.canvas);
   const source=operation.page.streamTextContent?operation.page.streamTextContent():await operation.page.getTextContent();if(!valid())return;
   const layer=operation.layer=doc.createElement('div');layer.className='textLayer';layer.style.setProperty('--scale-factor',scale);layer.style.setProperty('--total-scale-factor',scale);record.el.append(layer);
   const text=operation.text=new pdfjs.TextLayer({textContentSource:source,container:layer,viewport});await text.render();if(!valid())return;
   record.status='ready';record.el.dataset.rendered='true';record.el.dataset.status='ready';notify();
  }catch(error){
   if(!valid()||error.name==='RenderingCancelledException'||error.name==='AbortException')return;
   release(record);record.status='error';record.el.dataset.status='error';throw error;
  }finally{
   operation.settled=true;cancelled.removeEventListener('abort',cancel);
   if(!valid()){
    if(record.operation===operation)release(record);
    else{if(operation.canvas){operation.canvas.width=0;operation.canvas.height=0;operation.canvas.remove();}operation.layer?.remove();}
    cleanup(operation);
   }
   notify();
  }
 };
 const click=event=>{
  if(disposed||!owns())return;
  const element=event.target?.closest?.('.ls-pdf-page'),record=pages[Number(element?.dataset.page)-1];if(record?.el!==element)return;
  const rect=element.getBoundingClientRect();onJump?.({page:record.number,x:Math.max(0,(event.clientX-rect.left)/scale),y:Math.max(0,(event.clientY-rect.top)/scale)});
 };
 const interrupt=()=>pacer.interrupt();
 const scroll=()=>{interrupt();schedule();};
 const visibility=()=>pacer.setSuspended(!active||doc.hidden||parent.clientHeight===0);
 const resize=()=>{measure();visibility();schedule();};
 const abort=()=>{
  if(disposed)return;
  if(owns()&&pages.length)positions.set(parent,{key,scale,position:position()});
  disposed=true;signal?.removeEventListener('abort',abort);if(frame!==undefined)cancelFrame(frame);frame=undefined;
  pacer.close();parent.removeEventListener('scroll',scroll);parent.removeEventListener('dblclick',click);doc.removeEventListener('selectionchange',schedule);doc.removeEventListener('visibilitychange',visibility);for(const event of ['wheel','touchmove','keydown','pointerdown'])doc.removeEventListener(event,interrupt,true);view.removeEventListener?.('resize',resize);resizeObserver?.disconnect();
  queue?.close();for(const record of pages)release(record);
  Promise.resolve(loading.destroy()).catch(()=>{});notify();
 };
 signal?.addEventListener('abort',abort,{once:true});
 try{
  pdf=await loading.promise;if(disposed||!owns()||signal?.aborted){abort();return;}
  const first=await pdf.getPage(1);if(disposed||!owns()||signal?.aborted){abort();return;}
  const natural=first.getViewport({scale:1}),saved=positions.get(parent);
  scale=saved?.key===key?saved.scale:Math.max(0.35,Math.min(1.5,(parent.clientWidth-48)/natural.width));
  const fragment=doc.createDocumentFragment();
  for(let number=1;number<=pdf.numPages;number++){
   const el=doc.createElement('div'),record={el,number,natural,width:natural.width*scale,height:natural.height*scale,status:'idle'};
   record.queueKey={record,epoch:generation};el.className='ls-pdf-page';Object.assign(el.dataset,{page:String(number),rendered:'false',status:'idle'});el.style.width=record.width+'px';el.style.height=record.height+'px';pages.push(record);fragment.append(el);
  }
  parent.replaceChildren(fragment);measure();if(saved?.key===key)restore(saved.position);else{parent.scrollTop=0;parent.scrollLeft=0;}
  queue=createRenderQueue({render:renderPage,onError:error=>{if(!disposed&&owns())onError?.(error);},onChange:notify});
  parent.addEventListener('scroll',scroll,{passive:true});parent.addEventListener('dblclick',click);doc.addEventListener('selectionchange',schedule);doc.addEventListener('visibilitychange',visibility);for(const event of ['wheel','touchmove','keydown','pointerdown'])doc.addEventListener(event,interrupt,{capture:true,passive:true});
  if(view.ResizeObserver){resizeObserver=new view.ResizeObserver(resize);resizeObserver.observe(parent);}else view.addEventListener?.('resize',resize);
  visibility();queue.setPaused(pacer.paused);
  reconcile();
 }catch(error){abort();if(signal?.aborted)return;throw error;}
 return {
  count:pdf.numPages,
  zoom(factor){
   if(disposed||!Number.isFinite(factor)||factor<=0)return;
   const next=clampScale(scale*factor);if(next===scale)return queue.whenIdle();
   const anchor=position();generation++;queue.update([]);for(const record of pages)release(record);scale=next;
   for(const record of pages){record.width=record.natural.width*scale;record.height=record.natural.height*scale;record.status='idle';record.queueKey={record,epoch:generation};record.el.style.width=record.width+'px';record.el.style.height=record.height+'px';record.el.dataset.status='idle';}
   measure();restore(anchor);reconcile();return queue.whenIdle();
  },
  jump({page,y=0}){if(disposed)return;const record=pages[Number(page)-1];if(record){parent.scrollTop=record.top+Math.max(0,Number(y)||0)*scale-Math.min(100,parent.clientHeight/4);reconcile();}},
  setActive(value){active=Boolean(value);visibility();if(active)schedule();},
  // A host under rendering pressure can lower how many page bitmaps stay in memory.
  setResidentLimit(value){const next=Math.max(MIN_RESIDENT_PAGES,Math.min(MAX_RESIDENT_PAGES,Math.round(Number(value))||MAX_RESIDENT_PAGES));if(disposed||next===residentLimit)return;residentLimit=next;schedule();},
  stats,position,whenIdle:()=>queue.whenIdle(),destroy:abort
 };
}
