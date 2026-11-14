import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const root=process.env.LATEX_QA_ROOT,base=process.env.LATEX_QA_URL||'http://127.0.0.1:18148/';
if(!root||!process.env.LATEX_PLAYWRIGHT)throw Error('Set explicit synthetic QA root and Playwright module');
const paper=process.env.LATEX_QA_PAPER||resolve(root,'../browser-paper'),skipPDF=process.env.LATEX_QA_SKIP_PDF==='1';
await mkdir(root,{recursive:true});
const api=async(action,args={})=>{const response=await fetch(base+'dsh-latex/api',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-LaTeX':'1'},body:JSON.stringify({action,...args})});const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const project=await api('open',{path:paper});await api('configure',{projectId:project.id,changes:{main:'main.tex',autoCompile:false}});
let job=await api('compile',{projectId:project.id});for(let count=0;count<120&&['queued','running'].includes(job.phase);count++){await delay(500);job=await api('job',{projectId:project.id});}
assert.equal(job.phase,'success',job.message||'Synthetic 50-page build failed');
const original=await api('read',{projectId:project.id,path:'main.tex'});
const {webkit}=await import(process.env.LATEX_PLAYWRIGHT),browser=await webkit.launch({executablePath:process.env.LATEX_WEBKIT});
const context=await browser.newContext({viewport:{width:1440,height:900},colorScheme:'light'});await context.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'}));
const page=await context.newPage(),errors=[],checks=[],metrics={};page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
let cloneFixture=null,cloneSequence=0,cloneStartArgs=null;
const syncResponse=predicate=>page.waitForResponse(response=>{try{const args=response.request().postDataJSON();return response.url().endsWith('/dsh-latex/api')&&args.action==='sync'&&predicate(args);}catch{return false;}});
await page.route('**/dsh-latex/api',async route=>{
 const args=route.request().postDataJSON();
 if(args.action==='clone-start'){
  cloneStartArgs=args;cloneFixture={id:'synthetic-clone-'+(++cloneSequence),phase:'running',started:new Date().toISOString(),log:'Synthetic clone fixture; no repository is created.',progress:{phase:'receiving',percent:35,message:'Receiving objects: 35% (35/100), 4.00 MiB | 1.00 MiB/s'}};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(cloneFixture)});
 }
 if(cloneFixture&&['clone-job','clone-cancel'].includes(args.action)&&args.id===cloneFixture.id){
  if(args.action==='clone-cancel')cloneFixture={...cloneFixture,phase:'cancelled',message:'Synthetic clone cancelled.',progress:{phase:'cancelled',message:'Synthetic clone cancelled.'}};
  return route.fulfill({contentType:'application/json',body:JSON.stringify(cloneFixture)});
 }
 return route.continue();
});
const screenshot=name=>page.screenshot({path:join(root,name+'.png')});
const noOverflow=async label=>{
 const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,app:document.querySelector('.ls-root')?.getBoundingClientRect().width}));
 assert.ok(size.scroll<=size.client+1,label+' page overflow '+JSON.stringify(size));assert.ok(size.app<=size.client+1,label+' app overflow');
};
const waitSaved=async text=>{for(let count=0;count<40;count++){const file=await api('read',{projectId:project.id,path:'main.tex'});if(file.text===text)return;await delay(100);}throw Error('Autosave did not persist expected synthetic source');};
try{
 await page.goto(base);await page.getByRole('button',{name:new RegExp(project.title)}).click();await page.locator('.cm-content').waitFor();
 const switcher=page.locator('.ls-navigator-switch');await switcher.getByRole('button',{name:'大纲',exact:true}).click();
 for(const title of ['Introduction','Methods','Design','Experiment 48'])await page.locator('.ls-outline-row').getByText(title,{exact:true}).waitFor();
 assert.equal(await page.locator('.ls-outline-row').count(),51);checks.push('main-and-included-outline');
 await switcher.getByRole('button',{name:'文件',exact:true}).click();await page.locator('[role=tree]').waitFor();
 await switcher.getByRole('button',{name:'大纲',exact:true}).click();checks.push('files-outline-switch');
 const last=page.locator('.ls-outline-row').getByText('Experiment 48',{exact:true}),forward=syncResponse(args=>args.path==='chapters/body.tex'&&args.line===147);
 await last.click();await page.waitForFunction(()=>document.querySelector('.ls-current-file')?.textContent==='chapters/body.tex');
 await page.waitForFunction(()=>document.querySelector('.cm-activeLine')?.textContent.includes('Experiment 48'));
 const lastPoint=await (await forward).json();assert.ok(lastPoint.page>=49,JSON.stringify(lastPoint));
 if(!skipPDF)await page.waitForFunction(()=>document.querySelector('.ls-pdf-scroll')?.scrollTop>10000);
 checks.push('outline-jumps-to-source-line-and-PDF');
 await page.locator('.ls-outline-row').getByText('Introduction',{exact:true}).click();await page.waitForFunction(()=>document.querySelector('.cm-activeLine')?.textContent.includes('Introduction'));
 const cm=page.locator('.cm-content'),live=original.text.replace('Introduction','Introduction live QA');
 await cm.click();await cm.press('Meta+a');await page.keyboard.insertText(live);
 await page.locator('.ls-outline-row').getByText('Introduction live QA',{exact:true}).waitFor();await waitSaved(live);
 await cm.press('Meta+a');await page.keyboard.insertText(original.text);await page.locator('.ls-outline-row').getByText('Introduction',{exact:true}).waitFor();await waitSaved(original.text);checks.push('live-outline-and-autosave');
 if(!skipPDF){
  await page.waitForFunction(()=>document.querySelectorAll('.ls-pdf-page').length===50);const counts=[],budgets=[];
  const inspectBudget=async()=>{const budget=await page.locator('.ls-pdf-scroll').evaluate(element=>({canvases:element.querySelectorAll('canvas').length,textLayers:element.querySelectorAll('.textLayer').length,active:Number(element.dataset.pdfActive),resident:Number(element.dataset.pdfResident),queued:Number(element.dataset.pdfQueued),canvasBytes:Number(element.dataset.pdfCanvasBytes)}));budgets.push(budget);counts.push(budget.canvases);assert.ok(budget.active<=1&&budget.resident<=7&&budget.queued<=7&&budget.canvasBytes<=112000000,'PDF worker/resident budget: '+JSON.stringify(budget));assert.ok(budget.canvases<=7&&budget.textLayers<=7,'PDF DOM budget: '+JSON.stringify(budget));};
  for(const ratio of [0,0.2,0.7,1,0.4,0,0.9,0.3,1,0]){await page.locator('.ls-pdf-scroll').evaluate((element,ratio)=>element.scrollTop=element.scrollHeight*ratio,ratio);await page.waitForTimeout(100);await inspectBudget();}
  for(let count=0;count<4;count++){await page.getByRole('button',{name:count%2?'缩小':'放大',exact:true}).click();await page.waitForTimeout(120);}
  await last.click();await page.waitForFunction(()=>document.querySelector('.ls-pdf-page[data-page="50"] .textLayer span'));
  await inspectBudget();metrics.maxPDFCanvases=Math.max(...counts);metrics.finalPDFCanvases=counts.at(-1);metrics.maxPDFCanvasBytes=Math.max(...budgets.map(b=>b.canvasBytes));metrics.maxPDFRenderTasks=Math.max(...budgets.map(b=>b.active));
  assert.ok(await page.locator('.ls-pdf-page[data-page="50"] .textLayer span').count()>0,'Text layer remains selectable');
  const inverse=syncResponse(args=>args.page===50),span=page.locator('.ls-pdf-page[data-page="50"] .textLayer span').first();await span.dblclick();
  const inversePoint=await (await inverse).json();assert.equal(inversePoint.path,'chapters/body.tex');assert.ok(inversePoint.line>100);checks.push('virtual-PDF-50-pages-scroll-zoom-textlayer-inverse');
  await screenshot('outline-pdf-light-1440');
 }
 for(const colorScheme of ['light','dark']){
  await page.emulateMedia({colorScheme});
  for(const width of [320,393,768,1440]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(150);
   if(width<700&&await page.locator('.ls-panel').isVisible())await page.locator('.ls-panel>header').getByRole('button',{name:'关闭',exact:true}).click();
   await noOverflow(colorScheme+' '+width);assert.ok(await cm.isVisible());await screenshot('layout-'+colorScheme+'-'+width);
  }
 }
 checks.push('320-393-768-1440-light-dark');
 const large=await page.addStyleTag({content:'.ls-root{font-size:20px;--ls-editor-size:20px}'});await page.setViewportSize({width:393,height:900});await noOverflow('large-font');await screenshot('large-font-393');await large.evaluate(node=>node.remove());checks.push('large-font');
 await page.setViewportSize({width:1440,height:900});await page.emulateMedia({colorScheme:'light'});
 async function importDialog(){const back=page.getByRole('button',{name:'切换项目',exact:true});if(await back.count())await back.click();await page.locator('.ls-github-import input').fill('https://github.com/example/synthetic-paper/tree/draft');await page.locator('.ls-github-import button').click();const dialog=page.getByRole('dialog',{name:'克隆仓库',exact:true});await dialog.waitFor();await dialog.getByRole('button',{name:'克隆仓库',exact:true}).click();return dialog;}
 await importDialog();await page.locator('.ls-clone-progress[data-clone-phase="running"]').waitFor();assert.equal(await page.locator('.ls-clone-progress progress').getAttribute('value'),'35');assert.match(cloneStartArgs.url,/tree\/draft/);await screenshot('clone-progress-fixture');
 await page.reload();await page.locator('.ls-clone-banner progress[value="35"]').waitFor();
 await page.getByRole('button',{name:'取消克隆',exact:true}).click();await page.waitForFunction(()=>!sessionStorage.getItem('latex-studio:clone'));await page.locator('.ls-clone-banner').waitFor({state:'hidden'});checks.push('clone-progress-cancel-and-reload-resume-fixture');
 const dialog=await importDialog();await page.locator('.ls-clone-progress[data-clone-phase="running"]').waitFor();cloneFixture={...cloneFixture,phase:'error',message:'Synthetic credential helper did not authorize.',retryHint:'Synthetic fixture: authorize local Git and retry.',progress:{phase:'error',message:'Synthetic credential helper did not authorize.'}};
 await page.locator('.ls-clone-progress[data-clone-phase="error"]').waitFor();assert.ok(await dialog.getByRole('button',{name:'重试',exact:true}).isEnabled());assert.ok(await dialog.getByRole('textbox',{name:'Git 地址',exact:true}).isEnabled());
 await dialog.getByRole('button',{name:'重试',exact:true}).click();await page.locator('.ls-clone-progress[data-clone-phase="running"]').waitFor();await dialog.getByRole('button',{name:'取消克隆',exact:true}).click();await page.locator('.ls-clone-progress[data-clone-phase="cancelled"]').waitFor();checks.push('clone-error-recovery-and-retry-fixture');
 assert.deepEqual(errors,[]);const result={passed:true,checks,metrics,pageErrors:errors,skippedPDF:skipPDF};await writeFile(join(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}catch(error){await screenshot('failure').catch(()=>{});await writeFile(join(root,'result.json'),JSON.stringify({passed:false,checks,metrics,pageErrors:errors,error:error.stack},null,2)+'\n');throw error;}
finally{await browser.close();const current=await api('read',{projectId:project.id,path:'main.tex'}).catch(()=>null);if(current&&current.text!==original.text)await api('write',{projectId:project.id,path:'main.tex',text:original.text,baseRevision:current.revision});}
