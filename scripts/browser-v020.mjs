import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';

const root=process.env.LATEX_QA_ROOT,base=process.env.LATEX_QA_URL||'http://127.0.0.1:18148/';
if(!root||!process.env.LATEX_PLAYWRIGHT)throw Error('Set explicit synthetic QA root and Playwright module');
const api=async(action,args={})=>{
 const response=await fetch(base+'dsh-latex/api',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-LaTeX':'1'},body:JSON.stringify({action,...args})});
 const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
};
const paper=join(root,'compact-paper');
await mkdir(join(paper,'chapters','assets'),{recursive:true});await mkdir(join(paper,'figures'),{recursive:true});
await writeFile(join(paper,'main.tex'),'\\documentclass{article}\n\\begin{document}\n\\input{chapters/body}\n\\end{document}\n');
await writeFile(join(paper,'review.tex'),'\\documentclass{article}\n\\begin{document}Review entry.\\end{document}\n');
await writeFile(join(paper,'chapters','body.tex'),'Selected words.');
await writeFile(join(paper,'chapters','assets','notes.tex'),'Nested source.');
await writeFile(join(paper,'figures','placeholder.txt'),'Synthetic figure placeholder.');
const project=await api('open',{path:paper});await api('configure',{projectId:project.id,changes:{autoCompile:false}});
const {webkit}=await import(process.env.LATEX_PLAYWRIGHT);
const browser=await webkit.launch({executablePath:process.env.LATEX_WEBKIT});
const context=await browser.newContext({viewport:{width:1440,height:900}});
await context.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'MacIntel'}));
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
page.setDefaultTimeout(15000);
let fixture=null;
await page.route('**/dsh-latex/api',async route=>{
 const args=route.request().postDataJSON();
 if(fixture&&args.projectId===project.id&&['job','compile'].includes(args.action)){
  return route.fulfill({contentType:'application/json',body:JSON.stringify(fixture)});
 }
 return route.continue();
});
try{
 await page.goto(base);await page.getByRole('button',{name:/compact-paper/}).click();await page.locator('.cm-content').waitFor();
 const main=page.getByRole('combobox',{name:'主文件',exact:true});
 assert.equal(await main.inputValue(),'main.tex');await main.selectOption('review.tex');
 await page.waitForFunction(()=>document.querySelector('.ls-current-file')?.textContent==='review.tex');
 assert.equal((await api('tree',{projectId:project.id})).project.main,'review.tex');
 await main.selectOption('main.tex');await page.waitForFunction(()=>document.querySelector('.ls-current-file')?.textContent==='main.tex');
 const rows=page.locator('[role=tree] > li > [role=treeitem]');
 assert.deepEqual(await rows.evaluateAll(nodes=>nodes.slice(0,2).map(n=>n.dataset.filePath)),['chapters','figures']);
 await page.locator('[data-file-path="chapters"]').click();
 const nested=page.locator('[data-file-path="chapters"]').locator('..').locator('[role=group] > li > [role=treeitem]');
 assert.equal(await nested.first().getAttribute('data-file-path'),'chapters/assets');
 await page.locator('[data-file-path="chapters/body.tex"]').click();
 const cm=page.locator('.cm-content');await cm.click();await cm.press('Meta+a');await cm.press('Meta+b');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('\\textbf{Selected words.}'));
 await cm.press('Meta+i');
 await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent.includes('\\textit{Selected words.}'));
 await page.getByRole('button',{name:/加粗/}).click();
 await page.waitForTimeout(900);
 assert.match(await readFile(join(paper,'chapters/body.tex'),'utf8'),/\\textbf\{/);
 const started=new Date().toISOString();
 fixture={id:'synthetic-progress',projectId:project.id,phase:'running',started,log:'Synthetic progress fixture',progress:{phase:'downloading',receivedBytes:16*1024*1024,totalBytes:32*1024*1024,percent:50,message:'Synthetic download progress'}};
 await page.getByRole('button',{name:'编译',exact:true}).click();
 await page.locator('[data-build-phase=downloading]').waitFor();
 assert.equal(await page.getByRole('progressbar').getAttribute('value'),'50');
 assert.match(await page.locator('.ls-build-meta').innerText(),/16.*32.*50%/);
 await page.screenshot({path:join(root,'progress-light.png')});
 fixture={...fixture,phase:'error',finished:new Date().toISOString(),message:'Synthetic missing-package error',progress:{phase:'error',message:'Synthetic missing-package error'}};
 await page.getByRole('button',{name:'重试',exact:true}).waitFor();
 assert.match(await page.locator('.ls-build-failure').innerText(),/Synthetic missing-package error/);
 fixture=null;
 for(const colorScheme of ['light','dark']){
  await page.emulateMedia({colorScheme});
  for(const width of [320,393,768,1440]){
   await page.setViewportSize({width,height:900});await page.waitForTimeout(120);
   const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   assert.ok(size.scroll<=size.width+1,'No page overflow at '+colorScheme+' '+width);
   if(width<700&&await page.locator('.ls-panel').isVisible())await page.getByRole('button',{name:'关闭',exact:true}).click();
   assert.ok(await cm.isVisible());
   await page.screenshot({path:join(root,`after-${colorScheme}-${width}.png`)});
  }
 }
 await page.setViewportSize({width:393,height:900});await page.addStyleTag({content:'.ls-root{font-size:20px}'});
 assert.ok(await cm.isVisible());
 await page.setViewportSize({width:1440,height:900});
 await page.getByRole('button',{name:'Git',exact:true}).click();await page.getByRole('button',{name:'初始化 Git',exact:true}).click();
 await page.getByRole('textbox',{name:'远端地址',exact:true}).fill('https://github.com/example/synthetic-paper');
 await page.getByRole('button',{name:'连接远端',exact:true}).click();await page.locator('.ls-remote').waitFor();
 assert.equal((await api('git-status',{projectId:project.id})).remote,'https://github.com/example/synthetic-paper.git');
 await page.getByRole('button',{name:'切换项目',exact:true}).click();
 const input=page.locator('.ls-github-import input');await input.fill('https://github.com/example/synthetic-paper/tree/draft');
 await page.locator('.ls-github-import button').click();
 const dialog=page.getByRole('dialog',{name:'克隆仓库',exact:true});await dialog.waitFor();
 assert.equal(await dialog.getByRole('textbox',{name:'项目名称',exact:true}).inputValue(),'synthetic-paper');
 assert.match(await dialog.getByRole('textbox',{name:'Git 地址',exact:true}).inputValue(),/tree\/draft/);
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({passed:true,checks:['main-file-selection-persists','nested-folders-first','Cmd-B/I-and-toolbar','autosave','download-progress-fixture','clear-failure-and-retry','320/393/768/1440-light-dark','large-font','connect-existing-Git','GitHub-URL-import-dialog'],pageErrors:errors}));
}finally{await browser.close();}
