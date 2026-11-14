import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {deflateSync} from 'node:zlib';

const root=process.env.LATEX_QA_ROOT,base=process.env.LATEX_QA_URL||'http://127.0.0.1:18148/';
assert.ok(root&&process.env.LATEX_PLAYWRIGHT,'Set a private QA directory and Playwright module');
await mkdir(root,{recursive:true});
const api=async(action,args={})=>{const response=await fetch(base+'dsh-latex/api',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-LaTeX':'1'},body:JSON.stringify({action,...args})});assert.equal(response.status,200);return response.json();};
const project=await api('open',{path:process.env.LATEX_QA_PAPER||join(root,'../browser-paper')});
await api('configure',{projectId:project.id,changes:{main:'main.tex',autoCompile:false}});
let job=await api('compile',{projectId:project.id});
for(let i=0;i<120&&['queued','running'].includes(job.phase);i++){await new Promise(resolve=>setTimeout(resolve,500));job=await api('job',{projectId:project.id});}
assert.equal(job.phase,'success');

// A synthetic graphics-heavy paper; no private document or external download.
function graphicsPDF(){
 const objects=[null,'<< /Type /Catalog /Pages 2 0 R >>',null,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
 const kids=[];let state=42;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/2**32;};
 for(let page=1;page<=50;page++){
  const id=objects.length;kids.push(id+' 0 R');objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`);
  const rows=[`BT /F1 18 Tf 48 750 Td (Synthetic graphics page ${page}) Tj ET`,'0.15 0.30 0.55 RG 0.25 w'];
  for(let i=0;i<12000;i++){const x=(48+random()*510).toFixed(2),y=(100+random()*580).toFixed(2);rows.push(`${x} ${y} m ${(Number(x)+4).toFixed(2)} ${(Number(y)+3).toFixed(2)} l S`);}
  for(let i=0;i<55;i++)rows.push(`BT /F1 8 Tf 48 ${720-i*11} Td (Synthetic text layer row ${i}: alpha beta gamma delta epsilon.) Tj ET`);
  const compressed=deflateSync(Buffer.from(rows.join('\n')));objects.push(Buffer.concat([Buffer.from(`<< /Length ${compressed.length} /Filter /FlateDecode >>\nstream\n`),compressed,Buffer.from('\nendstream')]));
 }
 objects[2]=`<< /Type /Pages /Kids [${kids.join(' ')}] /Count 50 >>`;
 const parts=[Buffer.from('%PDF-1.7\n')],offsets=[0];let length=parts[0].length;
 for(let i=1;i<objects.length;i++){offsets.push(length);const part=Buffer.concat([Buffer.from(`${i} 0 obj\n`),Buffer.isBuffer(objects[i])?objects[i]:Buffer.from(objects[i]),Buffer.from('\nendobj\n')]);parts.push(part);length+=part.length;}
 parts.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return Buffer.concat(parts);
}
const heavy=process.env.LATEX_QA_HEAVY!=='0',bytes=heavy?graphicsPDF():null;
const {webkit}=await import(process.env.LATEX_PLAYWRIGHT),browser=await webkit.launch({executablePath:process.env.LATEX_WEBKIT});
 const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:Number(process.env.LATEX_QA_DPR||2)});
 const page=await context.newPage(),errors=[],warnings=[],requests={pdf:0},interactions=[],openingInputs=[];
page.on('pageerror',error=>errors.push(error.message));
page.on('console',message=>{if(['warning','error'].includes(message.type()))warnings.push(message.text());});
page.on('request',request=>{if(request.url().includes('/dsh-latex/pdf?'))requests.pdf++;});
if(bytes)await page.route('**/dsh-latex/pdf?**',route=>route.fulfill({contentType:'application/pdf',body:bytes}));
await page.addInitScript(()=>{
 window.__pdfPerf={frames:[],timers:[],mutations:0,phase:'opening',pauses:{},canvasPhases:{},layoutReads:{}};
 const offset=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'offsetTop');
 if(offset?.get)Object.defineProperty(HTMLElement.prototype,'offsetTop',{...offset,get(){if(this.classList.contains('ls-pdf-page')){const perf=window.__pdfPerf;perf.layoutReads[perf.phase]=(perf.layoutReads[perf.phase]||0)+1;}return offset.get.call(this);}});
 let last=performance.now();const frame=now=>{window.__pdfPerf.frames.push({ms:now-last,phase:window.__pdfPerf.phase});last=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 let time=performance.now();setInterval(()=>{const now=performance.now(),perf=window.__pdfPerf;perf.timers.push({ms:now-time,phase:perf.phase});time=now;const paused=document.querySelector('.ls-pdf-scroll')?.dataset.pdfPaused;perf.pauses[perf.phase+':'+paused]=(perf.pauses[perf.phase+':'+paused]||0)+1;},25);
 new MutationObserver(records=>{for(const record of records)for(const node of record.addedNodes)if(node.tagName==='CANVAS'){window.__pdfPerf.mutations++;const phase=window.__pdfPerf.phase;window.__pdfPerf.canvasPhases[phase]=(window.__pdfPerf.canvasPhases[phase]||0)+1;}}).observe(document,{childList:true,subtree:true});
});
try{
 await page.goto(base);await page.getByRole('button',{name:new RegExp(project.title)}).click();
  await page.locator('.cm-content').waitFor();await page.locator('.ls-pdf-page[data-status="rendering"]').first().waitFor();await page.locator('.cm-content').evaluate(el=>el.focus());
  for(let i=0;i<12;i++){const start=Date.now();await page.keyboard.press(i%2?'ArrowDown':'ArrowRight');openingInputs.push(Date.now()-start);await page.waitForTimeout(60);}
 await page.locator('.ls-pdf-page[data-status="ready"]').first().waitFor({timeout:30000});
 const phase=async value=>page.evaluate(value=>window.__pdfPerf.phase=value,value);
 const switcher=page.locator('.ls-navigator-switch');
  // Force skips Playwright's two presentation-frame stability wait. The button
  // stays fixed while the software WebKit compositor repaints another pane.
  const click=async name=>{const start=Date.now();await switcher.getByRole('button',{name,exact:true}).click({force:true});assert.equal(await switcher.getByRole('button',{name,exact:true}).getAttribute('aria-pressed'),'true');interactions.push({name,ms:Date.now()-start});};
 await phase('rest');
 for(let i=0;i<6;i++){await page.waitForTimeout(800);await click(i%2?'文件':'大纲');}
 await phase('scroll');
 await page.locator('.ls-pdf-scroll').hover();
 // Drive continuous scroll in the browser: an external wheel RPC waits for its
 // acknowledgement and otherwise inserts artificial idle gaps between events.
 await page.evaluate(()=>{window.__pdfScroll=setInterval(()=>{document.querySelector('.ls-pdf-scroll').scrollTop+=30;},16);});
 for(let i=0;i<8;i++){await page.waitForTimeout(1000);await click(i%2?'文件':'大纲');}
 await page.evaluate(()=>clearInterval(window.__pdfScroll));
 await phase('settle');
 for(let i=0;i<8;i++){await page.waitForTimeout(700);await click(i%2?'文件':'大纲');}
  if(process.env.LATEX_QA_IDLE_MS){await phase('idle');await page.waitForTimeout(Number(process.env.LATEX_QA_IDLE_MS));}
 const raw=await page.evaluate(()=>window.__pdfPerf),summary={};
  for(const name of ['opening','rest','scroll','settle',...(process.env.LATEX_QA_IDLE_MS?['idle']:[])]){
  const values=raw.frames.filter(row=>row.phase===name).map(row=>row.ms).sort((a,b)=>a-b);
   const timers=raw.timers.filter(row=>row.phase===name).map(row=>row.ms).sort((a,b)=>a-b);
   summary[name]={frames:values.length,p95:values[Math.floor(values.length*.95)],p99:values[Math.floor(values.length*.99)],max:values.at(-1),over100:values.filter(ms=>ms>100).length,timers:{p95:timers[Math.floor(timers.length*.95)],p99:timers[Math.floor(timers.length*.99)],max:timers.at(-1)}};
 }
  const result={heavyPDF:heavy,PDFBytes:bytes?.length,summary,openingInputs,interactions,canvasCreations:raw.mutations,pauses:raw.pauses,canvasPhases:raw.canvasPhases,layoutReads:raw.layoutReads,requests,errors,warnings,budget:await page.locator('.ls-pdf-scroll').evaluate(el=>({...el.dataset,canvases:el.querySelectorAll('canvas').length,height:el.clientHeight,width:el.clientWidth,scrollHeight:el.scrollHeight}))};
 await page.screenshot({path:join(root,'performance.png')});
 await writeFile(join(root,'performance.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 assert.deepEqual(errors,[]);
 if(process.env.LATEX_QA_PERF_ASSERT==='1'){
  assert.equal(requests.pdf,1,'Polling must not reload the same PDF');
   assert.ok(interactions.every(row=>row.ms<250),'Navigation must remain responsive');
   assert.ok(Math.max(...openingInputs)<250,'Opening a PDF must leave the source keyboard responsive');
   assert.ok(summary.settle.p95<75,'Rendering must settle without continued frame stalls');
   assert.ok(summary.scroll.timers.p95<50,'Scrolling must leave the UI event loop responsive');
   if(process.env.LATEX_QA_BASELINE){const before=JSON.parse(await readFile(process.env.LATEX_QA_BASELINE,'utf8'));assert.ok(summary.scroll.p95<before.summary.scroll.p95*.75,'Scroll frame stalls must improve against the same baseline PDF');}
 }
}finally{await browser.close();}
