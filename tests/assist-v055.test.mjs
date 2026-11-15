import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Studio} from '../src/service.mjs';
import {latexAssistProvider,RESTORE_BYTES} from '../web/assist.mjs';

// The provider driven against the real host service on a synthetic project. The editor is a fake
// handle; loadFile mirrors the interface's guarded switch (flush first, refuse when it fails).
const MAIN='\\documentclass{article}\n\\begin{document}\n\\input{body}\n\\end{document}\n';
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'latex-assist-055-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paper=join(root,'paper');await mkdir(join(paper,'sections'),{recursive:true});
 await writeFile(join(paper,'main.tex'),MAIN);await writeFile(join(paper,'body.tex'),'One\nTwo synthetic\nThree\nFour\n');
 await writeFile(join(paper,'sections/intro.tex'),'Intro line\n');await writeFile(join(paper,'fig.png'),Buffer.from([0x89,0x50,0x4e,0x47,0,1,2,255]));
 const studio=new Studio(join(root,'state')),p=await studio.projects.open(paper);
 const calls=[],hooks={};
 const request=async(action,args={})=>{calls.push([action,args.path??args.changes]);await hooks[action]?.(args);return studio.dispatch({action,...args});};
 let config;const kit={objectSchema:(properties,required)=>({type:'object',properties,required,additionalProperties:false}),textSchema:n=>({type:'string',maxLength:n}),textRangeProvider:c=>(config=c,{version:1})};
 const editor={},state={flushOk:true};
 const fake=(path,text)=>({path,getText:()=>text,view:{hasFocus:false,state:{selection:{main:{from:0,to:0}}}},show:(from,to)=>calls.push(['show',path,from,to]),jump:line=>calls.push(['jump',line]),replace(){},onUpdate:()=>()=>{},range(){}});
 const live={project:p,file:null};
 const env={live,editor,request,
  flush:async()=>state.flushOk,
  loadFile:async(path,o)=>{calls.push(['load',path]);if(!state.flushOk)return false;const read=await request('read',{projectId:p.id,path});live.file=read;editor.current=fake(path,read.text);if(o?.line)editor.current.jump(o.line);return true;},
  refreshFiles:async()=>calls.push(['refresh']),
  applyProject:async next=>{calls.push(['project',next.main,next.engine]);live.project=next;},
  compile:async()=>{calls.push(['compile']);return state.flushOk;}};
 latexAssistProvider(kit,env);
 await env.loadFile('main.tex');const s=config.session();calls.length=0;
 const action=name=>config.extraActions.find(a=>a.name===name);
 return {paper,studio,p,config,s,live,editor,calls,state,hooks,action,env,disk:name=>readFile(join(paper,name))};
}
const missing=async file=>assert.rejects(access(file),/ENOENT/);

test('reopen opens the captured file through the guarded switch and is a no-op when it is open',async t=>{
 const {config,s,live,calls,state,env,p}=await setup(t);
 const locator=config.describe(s).subject.locator;assert.deepEqual(locator,{projectId:p.id,path:'main.tex'});
 assert.equal(await config.reopen(locator),s,'already open: the same session, nothing loaded');assert.deepEqual(calls,[]);
 await env.loadFile('body.tex');calls.length=0;
 const again=await config.reopen(locator);
 assert.deepEqual(calls.filter(c=>c[0]==='load'),[['load','main.tex']]);assert.equal(live.file.path,'main.tex');assert.equal(again.path,'main.tex','the session for the reopened file exists');
 await env.loadFile('body.tex');state.flushOk=false;calls.length=0;
 await assert.rejects(config.reopen(locator),/cannot be saved/);assert.equal(live.file.path,'body.tex','unsaved edits that cannot be saved keep the editor where it is');
 state.flushOk=true;await assert.rejects(config.reopen({projectId:'other',path:'main.tex'}),/another project/);
});

test('edit_file.show opens another file and scrolls there; a missing file is not opened',async t=>{
 const {config,s,live,calls,state,action}=await setup(t);const edit=action('edit_file');
 assert.equal(await edit.show({path:'body.tex',from_line:3,to_line:3,expected:'Three',text:'Three new'},s),true);
 assert.equal(live.file.path,'body.tex');assert.deepEqual(calls.filter(c=>c[0]==='load'||c[0]==='show'),[['load','body.tex'],['show','body.tex',18,23]],'opened, then the pending passage scrolled into view');
 calls.length=0;assert.equal(edit.show({path:'body.tex',from_line:2,to_line:2,expected:'Two synthetic',text:'Two'},s),true,'the open file only scrolls');
 assert.deepEqual(calls,[['show','body.tex',4,17]]);
 calls.length=0;assert.equal(await edit.show({path:'gone.tex',from_line:1,to_line:1,expected:'x',text:'y'},s),false);
 assert.equal(await edit.show({path:'fig.png',from_line:1,to_line:1,expected:'x',text:'y'},s),false,'a binary file is not opened');
 assert.equal(calls.some(c=>c[0]==='load'),false);assert.equal(live.file.path,'body.tex');
 state.flushOk=false;assert.equal(await edit.show({path:'main.tex',from_line:1,to_line:1,expected:'x',text:'y'},s),false,'unsaved edits that cannot be saved are not switched away from');
 assert.equal(live.file.path,'body.tex');
 // Older single-file behaviour is unchanged for the captured file.
 assert.equal(config.extraActions.find(a=>a.name==='create_file').show({path:'new.tex',text:''},s),false);
});

test('rename_file moves the text, carries the open editor and main file, and undoes only an unchanged file',async t=>{
 const {config,s,live,calls,action,paper,disk,env,p,studio}=await setup(t);const rename=action('rename_file');
 assert.deepEqual(rename.describe({path:'body.tex',to:'sections/body.tex'},s),{kind:'fields',label:'重命名 / Rename · body.tex',anchor:'file:body.tex',before:{path:'body.tex'},after:{path:'sections/body.tex'}});
 const before=await disk('body.tex');await env.loadFile('body.tex');calls.length=0;
 const receipt=await rename.apply({path:'body.tex',to:'sections/body.tex'},s);
 assert.deepEqual(await disk('sections/body.tex'),before);await missing(join(paper,'body.tex'));
 assert.equal(live.file.path,'sections/body.tex','the open editor follows the file');assert.equal(receipt.main,false);
 assert.equal(await rename.show({path:'body.tex',to:'sections/body.tex'},s),true);
 await rename.undo(receipt,s);assert.deepEqual(await disk('body.tex'),before);await missing(join(paper,'sections/body.tex'));assert.equal(live.file.path,'body.tex','the name is back');
 assert.equal(await rename.show({path:'body.tex',to:'sections/body.tex'},s),true,'pending: the file where it still is');
 // Changed in between: the undo keeps the renamed file.
 const again=await rename.apply({path:'body.tex',to:'chapter.tex'},s);
 await writeFile(join(paper,'chapter.tex'),'Edited by hand\n');
 await assert.rejects(rename.undo(again,s),/changed afterwards/);assert.equal(String(await disk('chapter.tex')),'Edited by hand\n');await missing(join(paper,'body.tex'));
 // The main file setting follows a renamed main file, and comes back with the undo.
 const other=await setup(t);
 await other.env.loadFile('body.tex');const s2=other.config.session();
 const moved=await other.action('rename_file').apply({path:'main.tex',to:'paper.tex'},s2);
 assert.equal(moved.main,true);assert.equal((await other.studio.dispatch({action:'projects'})).projects[0].main,'paper.tex');assert.equal(other.live.project.main,'paper.tex');
 await other.action('rename_file').undo(moved,s2);assert.equal((await other.studio.dispatch({action:'projects'})).projects[0].main,'main.tex');assert.equal(String(await other.disk('main.tex')),MAIN);
 // Refusals: the captured file, an existing target, a missing folder, a binary file.
 await assert.rejects(rename.apply({path:'main.tex',to:'x.tex'},s),/this session edits/);
 await assert.rejects(rename.apply({path:'chapter.tex',to:'sections/intro.tex'},s),/already exists/);
 await assert.rejects(rename.apply({path:'chapter.tex',to:'nowhere/x.tex'},s),/does not exist/);
 await assert.rejects(rename.apply({path:'fig.png',to:'figure.png'},s),/not a text file/);
 assert.equal(String(await disk('chapter.tex')),'Edited by hand\n');await missing(join(paper,'x.tex'));
});

test('delete_file restores the exact bytes and refuses what its undo could not restore',async t=>{
 const {s,live,calls,action,paper,disk,env,hooks}=await setup(t);const del=action('delete_file');
 const bytes=Buffer.from('\ufeff% synthetic\r\nÄ ü — 数学 𝔼\r\nno final newline','utf8');await writeFile(join(paper,'sections/notes.tex'),bytes);
 assert.deepEqual(del.describe({path:'sections/notes.tex'},s),{kind:'entity',label:'删除文件 / Delete file · sections/notes.tex',anchor:'file:sections/notes.tex',before:{path:'sections/notes.tex'},after:{}});
 await env.loadFile('sections/notes.tex');
 const receipt=await del.apply({path:'sections/notes.tex'},s);
 await missing(join(paper,'sections/notes.tex'));assert.equal(live.file.path,'main.tex','the editor left the deleted file for the main file');
 assert.equal(await del.show({path:'sections/notes.tex'},s),false,'a deleted file has no place to show');
 await del.undo(receipt,s);assert.deepEqual(await disk('sections/notes.tex'),bytes,'byte for byte');
 // Undo never overwrites a file that took the path in the meantime.
 const second=await del.apply({path:'sections/notes.tex'},s);await writeFile(join(paper,'sections/notes.tex'),'new owner\n');
 await assert.rejects(del.undo(second,s),/now exists/);assert.equal(String(await disk('sections/notes.tex')),'new owner\n');
 // Changed between reading and deleting: kept.
 hooks['remove-created']=async()=>{await writeFile(join(paper,'body.tex'),'Changed meanwhile\n');};
 await assert.rejects(del.apply({path:'body.tex'},s),/changed/);assert.equal(String(await disk('body.tex')),'Changed meanwhile\n');delete hooks['remove-created'];
 // Refused: the main file, the captured file, binary, not UTF-8, larger than the bound.
 await env.loadFile('sections/intro.tex');const captured=action('delete_file');
 await assert.rejects(del.apply({path:'main.tex'},s),/main file|this session edits/);
 await assert.rejects(captured.apply({path:'main.tex'},{...s,path:'other.tex'}),/main file cannot be deleted/);
 await assert.rejects(del.apply({path:'fig.png'},s),/not a text file/);
 await writeFile(join(paper,'latin1.tex'),Buffer.from([0x63,0x61,0x66,0xe9,0x0a]));
 await assert.rejects(del.apply({path:'latin1.tex'},s),/not valid UTF-8/);
 await writeFile(join(paper,'big.bib'),'x'.repeat(RESTORE_BYTES+1));
 await assert.rejects(del.apply({path:'big.bib'},s),/larger than 1 MiB/);
 await writeFile(join(paper,'huge.bib'),'x'.repeat(2*1024*1024+1));
 await assert.rejects(del.apply({path:'huge.bib'},s),/larger than 2 MiB/);
 for(const name of ['main.tex','fig.png','latin1.tex','big.bib','huge.bib'])await access(join(paper,name));
 assert.ok(calls.length>0);
});

test('main file and engine settings are revision-checked and undone exactly',async t=>{
 const {s,live,action,paper,studio}=await setup(t);const main=action('set_main_file'),engine=action('set_engine');
 await writeFile(join(paper,'paper.tex'),MAIN);
 const project=async()=>(await studio.dispatch({action:'projects'})).projects[0];
 assert.deepEqual(main.describe({path:'paper.tex',expected:'main.tex'},s),{kind:'fields',label:'主文件 / Main file',anchor:'setting:main',before:{main:'main.tex'},after:{main:'paper.tex'}});
 await assert.rejects(main.apply({path:'paper.tex',expected:'other.tex'},s),/main file is now main\.tex/);
 const r=await main.apply({path:'paper.tex',expected:'main.tex'},s);assert.equal((await project()).main,'paper.tex');assert.equal(live.project.main,'paper.tex');
 await main.undo(r,s);assert.equal((await project()).main,'main.tex');
 const r2=await main.apply({path:'paper.tex',expected:'main.tex'},s);await studio.dispatch({action:'configure',projectId:s.projectId,changes:{main:'body.tex'}}).catch(()=>{});
 await studio.dispatch({action:'configure',projectId:s.projectId,changes:{main:'main.tex'}});
 await assert.rejects(main.undo(r2,s),/setting changed/);assert.equal((await project()).main,'main.tex');
 await assert.rejects(engine.apply({engine:'context',expected:'pdflatex'},s),/Unknown engine/);
 await assert.rejects(engine.apply({engine:'xelatex',expected:'lualatex'},s),/engine is now pdflatex/);
 const e=await engine.apply({engine:'xelatex',expected:'pdflatex'},s);assert.equal((await project()).engine,'xelatex');
 assert.deepEqual(engine.describe({engine:'xelatex',expected:'pdflatex'},s).after,{engine:'xelatex'});
 await engine.undo(e,s);assert.equal((await project()).engine,'pdflatex');
});

test('compile and Git reads go through the interface paths',async t=>{
 const {config,calls,state}=await setup(t);
 assert.deepEqual(await config.navigate('compile',{}),{started:true});assert.deepEqual(calls.at(-1),['compile']);
 state.flushOk=false;await assert.rejects(config.navigate('compile',{}),/cannot be saved/);
 const status=await config.read('git_status',{});assert.equal(status.repository,false);assert.deepEqual(status.files,[]);
 const diff=await config.read('git_diff',{path:'body.tex'});assert.equal(diff.path,'body.tex');assert.equal(diff.truncated,false);
});

test('the coverage ledger names only declared actions, reads and navigation; every gap has a reason',async t=>{
 const {config,s}=await setup(t);
 const ledger=JSON.parse(await readFile(new URL('../web/assist-coverage.json',import.meta.url),'utf8'));
 assert.equal(ledger.version,1);assert.ok(ledger.operations.length>=30);
 const info=config.describe(s),declared=new Set([...config.extraActions,...info.reads,...info.navigation].map(a=>a.name));
 for(const op of ledger.operations){
  assert.equal(typeof op.ui,'string');assert.ok(op.ui.trim());
  if(op.via==='none')assert.ok(typeof op.reason==='string'&&op.reason.trim().length>10,'a gap needs its reason: '+op.ui);
  else if(op.via!=='buffer edit')assert.ok(declared.has(op.via),'undeclared via '+op.via+' for '+op.ui);
 }
 for(const extra of ledger.beyondInterface||[])assert.ok(declared.has(extra.via),extra.via);
 const used=new Set(ledger.operations.map(o=>o.via).concat((ledger.beyondInterface||[]).map(o=>o.via)));
 for(const name of declared)assert.ok(used.has(name),'declared but missing from the ledger: '+name);
 assert.doesNotMatch(JSON.stringify(ledger),/next\s*space/i,'public wording stays neutral');
});
