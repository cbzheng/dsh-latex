import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';

const base=process.env.LATEX_QA_URL,activity=process.env.LATEX_QA_ACTIVITY;
const project=process.env.LATEX_QA_PROJECT,view=process.env.LATEX_QA_VIEW;
if(!base||!activity||!project||!view)throw Error('Set explicit QA URL, activity, project title and view ID');
const {webkit}=await import(process.env.LATEX_PLAYWRIGHT);
const browser=await webkit.launch({executablePath:process.env.LATEX_WEBKIT});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage(),errors=[];
page.setDefaultTimeout(20000);page.on('pageerror',e=>errors.push(e.message));
async function dismissSignIn(){
 const dialog=page.getByRole('dialog',{name:/^(Get started|开始使用)$/});
 // An empty host may show onboarding after the first render has settled.
 await dialog.waitFor({state:'visible',timeout:5000}).catch(()=>{});
 if(await dialog.isVisible()){await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});}
}
try{
 await page.goto(base+'?latex=1',{waitUntil:'domcontentloaded'});
 await page.locator('[data-latex-studio]').waitFor();
 await page.getByRole('button',{name:new RegExp(project)}).click();
 await page.locator('.ls-preview canvas').waitFor();
 await page.waitForFunction(()=>document.querySelector('.ls-preview .textLayer')?.textContent.length>0);
 assert.ok(await page.locator('.cm-content').isVisible());
 if(process.env.LATEX_QA_OUTPUT){await mkdir(process.env.LATEX_QA_OUTPUT,{recursive:true});await page.locator('[data-latex-studio]').screenshot({path:join(process.env.LATEX_QA_OUTPUT,'standalone.png')});}
 await page.goto(base+'?space=1&activity='+activity+'&view='+view,{waitUntil:'domcontentloaded'});
 await page.locator('[data-latex-studio]:visible .ls-preview canvas').waitFor();
 await dismissSignIn();
 await page.locator('.ns-dock-add:visible,.ns-add:visible').first().click();
 await page.getByRole('searchbox',{name:/^(Search apps|搜索应用)$/}).fill('latex-studio');
 const item=page.locator('[data-plugin-id="latex-studio"]');assert.equal(await item.count(),1);
 assert.ok(await item.isVisible());assert.ok(await item.isEnabled());
 await item.focus();await page.keyboard.press('Enter');
 await page.getByRole('dialog',{name:/^(Add view|添加界面)$/}).waitFor({state:'hidden'});
 await page.locator('[data-latex-studio]:visible .ls-preview canvas').waitFor();
 const response=await context.request.post(base+'next-space/api',{headers:{'Content-Type':'application/json','X-Next-Space':'1'},data:{protocol:'next-space/1',action:'open',activityId:activity}});
 assert.equal(response.status(),200);
 const current=await response.json();assert.equal(current.instances.filter(i=>i.pluginId==='latex-studio').length,1,'Default launcher action reuses the existing window');
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['DSH-entry','source','PDF-canvas-and-text','Next-Space-window','launcher-keyboard-entry','reuse-window'],pageErrors:errors}));
}finally{await browser.close();}
