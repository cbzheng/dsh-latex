import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {deflateRawSync} from 'node:zlib';
import {Templates,TEMPLATES,unzip} from '../src/templates.mjs';
import {SKELETONS} from '../src/template-files.mjs';
import {templateStatus} from '../web/project-ui.mjs';
import {Studio} from '../src/service.mjs';
import {run} from '../src/util.mjs';

// Synthetic publisher archives: no real class file is used or stored by the tests.
function zip(entries){
 const locals=[],central=[];let offset=0;
 for(const [name,text,stored] of entries){
  const data=Buffer.from(text),packed=stored?data:deflateRawSync(data),file=Buffer.from(name),local=Buffer.alloc(30),head=Buffer.alloc(46);
  local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(stored?0:8,8);local.writeUInt32LE(packed.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(file.length,26);
  head.writeUInt32LE(0x02014b50,0);head.writeUInt16LE(stored?0:8,10);head.writeUInt32LE(packed.length,20);head.writeUInt32LE(data.length,24);head.writeUInt16LE(file.length,28);head.writeUInt32LE(offset,42);
  locals.push(local,file,packed);central.push(head,file);offset+=30+file.length+packed.length;
 }
 const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,directory,end]);
}
const snClass=tag=>'%% synthetic '+tag+'\r\\NeedsTeXFormat{LaTeX2e}\r\\ProvidesClass{sn-jnl}[2026/01/01 synthetic]\r';
const snZip=tag=>zip([['sn-article-template/sn-jnl.cls',snClass(tag)],['sn-article-template/bst/sn-nature.bst','% nature style '+tag],['sn-article-template/bst/sn-basic.bst','% basic style',true],['sn-article-template/sn-article.tex','\\documentclass{sn-jnl}'],['__MACOSX/bst/evil.txt','x'],['sn-article-template/user-manual.pdf','%PDF']]);
async function acmArchive(root,version='9.9'){
 const tree=join(root,'acm-tree-'+version);await mkdir(join(tree,'tex/latex/acmart'),{recursive:true});await mkdir(join(tree,'bibtex/bst/acmart'),{recursive:true});await mkdir(join(tree,'tlpkg/tlpobj'),{recursive:true});
 await writeFile(join(tree,'tex/latex/acmart/acmart.cls'),'\\ProvidesClass{acmart}\n[2026/02/03 v'+version+' Synthetic class]\n');await writeFile(join(tree,'tex/latex/acmart/acmnumeric.bbx'),'% bbx');
 await writeFile(join(tree,'bibtex/bst/acmart/ACM-Reference-Format.bst'),'% synthetic bst');await writeFile(join(tree,'tlpkg/tlpobj/acmart.tlpobj'),'name acmart');
 const archive=join(root,'acmart-'+version+'.tar.xz'),made=await run('tar',['-cJf',archive,'-C',tree,'tex','bibtex','tlpkg']);assert.equal(made.code,0,made.output);return readFile(archive);
}
async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'latex-templates-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const calls=[],clock={now:Date.parse('2026-03-01T00:00:00Z')},routes={};
 const fetch=async(url,options={})=>{calls.push([url,options.headers?.['If-None-Match']||'']);const route=routes[new URL(url).hostname];if(!route)throw new TypeError('fetch failed');return route(url,options);};
 return {root,calls,clock,routes,fetch,templates:new Templates(join(root,'state','templates'),{fetch,now:()=>clock.now})};
}
const nature=(tag,etag,month='December 2024')=>(url,options)=>options.headers?.['If-None-Match']===etag?new Response(null,{status:304}):new Response(snZip(tag),{headers:{etag,'content-disposition':'attachment; filename="Download+the+journal+article+template+package+%28'+month.replace(' ','+')+'+version%29.zip"'}});
const DAY=24*60*60*1000;

test('the zip reader extracts only chosen members and refuses anything else',()=>{
 const files=unzip(snZip('a'),TEMPLATES.nature.upstream.pick);
 assert.deepEqual([...files.keys()].sort(),['bst/sn-basic.bst','sn-jnl.cls','sn-nature.bst']);
 assert.equal(files.get('sn-jnl.cls').toString(),snClass('a'),'bytes are kept, including CR line endings');assert.equal(files.get('bst/sn-basic.bst').toString(),'% basic style');
 assert.throws(()=>unzip(Buffer.from('not an archive at all, just text'),()=>'x'),/not a zip file/);
 const broken=snZip('a');broken.writeUInt32LE(5,broken.length-6);assert.throws(()=>unzip(broken,()=>'x'),/Damaged/);
 assert.throws(()=>unzip(zip([['big.cls','x'.repeat(3*1024*1024)]]),()=>'big.cls'),/too large/);
});

test('templates sync from the publisher, keep a private cache and follow new versions',async t=>{
 const {templates,calls,clock,routes,root}=await setup(t),cache=join(root,'state','templates');
 assert.deepEqual((await templates.list()).templates.map(item=>[item.id,item.upstream?.ready]),[['article',undefined],['acm',false],['nature',false]]);
 routes['resource-cms.springernature.com']=nature('one','"v1"');
 const first=await templates.sync('nature');
 assert.deepEqual([first.upstream.ready,first.upstream.version,first.upstream.stale,first.upstream.label],[true,'December 2024',false,'sn-jnl']);
 const folder=(await readdir(cache)).filter(name=>name.startsWith('nature-'));assert.equal(folder.length,1);
 assert.equal(await readFile(join(cache,folder[0],'sn-jnl.cls'),'utf8'),snClass('one'));
 await templates.sync('nature');assert.equal(calls.length,1,'a fresh cache is not fetched again');
 clock.now+=2*DAY;assert.equal((await templates.list()).templates[2].upstream.stale,true);
 const unchanged=await templates.sync('nature');assert.deepEqual(calls.at(-1),[TEMPLATES.nature.upstream.urls[0],'"v1"'],'the check is conditional');
 assert.equal(unchanged.upstream.fetched,first.upstream.fetched);assert.notEqual(unchanged.upstream.checked,first.upstream.checked);assert.equal(unchanged.upstream.stale,false);
 routes['resource-cms.springernature.com']=nature('two','"v2"','March 2026');
 assert.equal((await templates.sync('nature')).upstream.version,'December 2024','no request inside a day');
 const updated=await templates.sync('nature',{force:true});assert.equal(updated.upstream.version,'March 2026');
 const after=(await readdir(cache)).filter(name=>name.startsWith('nature-'));assert.equal(after.length,1,'the superseded copy is removed');assert.notEqual(after[0],folder[0]);
 assert.equal(await readFile(join(cache,after[0],'sn-nature.bst'),'utf8'),'% nature style two');
 assert.deepEqual((await readdir(cache)).filter(name=>name.startsWith('.fetch-')),[],'no scratch folders remain');
 // Same bytes under a new ETag only refresh the check.
 routes['resource-cms.springernature.com']=nature('two','"v3"','March 2026');clock.now+=2*DAY;
 assert.equal((await templates.sync('nature')).upstream.fetched,updated.upstream.fetched);
 await assert.rejects(()=>templates.sync('unknown'),/Unknown template/);assert.equal((await templates.sync('article')).id,'article');
});

test('an unreachable or wrong source keeps the cached copy and says so; nothing cached fails clearly',async t=>{
 const {templates,clock,routes}=await setup(t);
 await assert.rejects(templates.sync('nature'),error=>error.status===502&&/unreachable.*Connect to the network to fetch the Nature template/.test(error.message));
 routes['resource-cms.springernature.com']=()=>new Response('nope',{status:503});
 await assert.rejects(templates.sync('nature'),/answered 503/);
 routes['resource-cms.springernature.com']=()=>new Response(zip([['readme.txt','moved']]));
 await assert.rejects(templates.sync('nature'),/lacks sn-jnl\.cls/);
 routes['resource-cms.springernature.com']=()=>new Response(zip([['x/sn-jnl.cls','not a class'],['x/bst/sn-nature.bst','b']]));
 await assert.rejects(templates.sync('nature'),/Unexpected sn-jnl class file/);
 assert.equal((await templates.list()).templates[2].upstream.ready,false);
 routes['resource-cms.springernature.com']=nature('one','"v1"');await templates.sync('nature');
 delete routes['resource-cms.springernature.com'];clock.now+=2*DAY;
 const offline=await templates.sync('nature');
 assert.deepEqual([offline.upstream.ready,offline.upstream.version,offline.upstream.error],[true,'December 2024','Template source is unreachable']);
 assert.equal((await templates.blueprint('nature')).template.version,'December 2024','the cached copy still creates projects');
 const t_={templateSyncing:'S',templateMissing:'M',templateOffline:'O'};
 assert.equal(templateStatus(offline.upstream,false,t_),'sn-jnl · December 2024 · O');assert.equal(templateStatus(offline.upstream,true,t_),'S');
 assert.equal(templateStatus({ready:false},false,t_),'M');assert.equal(templateStatus({ready:true,label:'acmart',version:'2.21'},false,t_),'acmart · v2.21');
});

test('the ACM class comes from a TeX Live mirror, falling back to the next mirror',async t=>{
 const {templates,calls,routes,root}=await setup(t),archive=await acmArchive(root);
 routes['ctan.math.illinois.edu']=()=>new Response(archive);
 const synced=await templates.sync('acm');assert.equal(synced.upstream.version,'9.9');assert.equal(synced.upstream.origin,'CTAN');
 assert.deepEqual(calls.map(call=>new URL(call[0]).hostname),['mirror.ctan.org','ctan.math.illinois.edu']);
 const blueprint=await templates.blueprint('acm');
 assert.deepEqual(blueprint.files.filter(file=>file.data).map(file=>file.path),['ACM-Reference-Format.bst','acmart.cls','acmnumeric.bbx']);
 assert.deepEqual(blueprint.template,{id:'acm',version:'9.9'});
});

test('a new project is created from the chosen template in the familiar layout',async t=>{
 const {root,fetch,routes}=await setup(t),studio=new Studio(join(root,'service'),{fetch});
 routes['mirror.ctan.org']=async()=>new Response(await acmArchive(root,'3.1'));routes['resource-cms.springernature.com']=nature('one','"v1"');
 const parent=join(root,'papers');await mkdir(parent);
 const listing=async p=>(await readdir(p.root,{recursive:true})).filter(name=>!name.startsWith('.git/')&&name!=='.git').sort();
 const plain=await studio.dispatch({action:'create',parent,name:'plain'});
 assert.deepEqual(await listing(plain),['.gitignore','main.tex']);assert.equal(plain.template,undefined);
 assert.equal(await readFile(join(plain.root,'main.tex'),'utf8'),SKELETONS.article().files[0].text);
 const acm=await studio.dispatch({action:'create',parent,name:'cscw paper',template:'acm'}); // fetched on first use
 assert.deepEqual(acm.template,{id:'acm',version:'3.1'});assert.equal(acm.main,'main.tex');assert.equal(acm.engine,'pdflatex');
 assert.deepEqual(await listing(acm),['.gitignore','ACM-Reference-Format.bst','Figures','Figures/.gitkeep','Meta','Meta/authors.tex','Meta/ccsxml.tex','Meta/commands.tex','Sections','Sections/01-introduction.tex','Sections/02-related-work.tex','Sections/03-method.tex','Sections/04-findings.tex','Sections/05-discussion.tex','Sections/06-conclusion.tex','Sections/abstract.tex','Sections/ack.tex','Sections/appendix.tex','Tables','Tables/.gitkeep','acmart.cls','acmnumeric.bbx','main.tex','references.bib']);
 const main=await readFile(join(acm.root,'main.tex'),'utf8');
 assert.match(main,/\\documentclass\[manuscript,review,anonymous\]\{acmart\}/);
 for(const name of ['Meta/commands','Meta/authors','Sections/abstract','Meta/ccsxml','Sections/01-introduction','Sections/ack','Sections/appendix'])assert.ok(main.includes('\\input{'+name+'}'),name);
 assert.ok(main.indexOf('\\input{Meta/ccsxml}')<main.indexOf('\\maketitle')&&main.indexOf('\\bibliography{references}')<main.indexOf('\\input{Sections/appendix}'));
 const commands=await readFile(join(acm.root,'Meta/commands.tex'),'utf8');
 assert.match(commands,/\\definechangesauthor\[name=\{AI\}, color=blue\]\{AI\}/);assert.match(commands,/\\graphicspath\{\{Figures\/\}\}/);assert.match(commands,/\\newcommand\{\\todo\}/);
 const nat=await studio.dispatch({action:'create',parent,name:'nature-paper',template:'nature'});
 assert.deepEqual(nat.template,{id:'nature',version:'December 2024'});
 const natFiles=await listing(nat);for(const name of ['sn-jnl.cls','sn-nature.bst','bst/sn-basic.bst','Meta/commands.tex','Sections/04-methods.tex','Sections/declarations.tex','references.bib'])assert.ok(natFiles.includes(name),name);
 assert.equal(await readFile(join(nat.root,'sn-jnl.cls'),'utf8'),snClass('one'));
 assert.match(await readFile(join(nat.root,'main.tex'),'utf8'),/\\documentclass\[pdflatex,sn-nature\]\{sn-jnl\}/);
 assert.deepEqual((await studio.projects.list()).projects.find(p=>p.id===acm.id).template,{id:'acm',version:'3.1'},'the registry remembers the template version');
 // Every \input target of every skeleton exists, and the files reach the editor and the index.
 for(const p of [acm,nat]){const text=await readFile(join(p.root,'main.tex'),'utf8');for(const match of text.matchAll(/\\input\{([^}]+)\}/g))await access(join(p.root,match[1]+'.tex'));}
 const index=await studio.dispatch({action:'index',projectId:acm.id});
 assert.deepEqual(index.citations.map(entry=>entry.key),['lamport1994latex']);assert.ok(index.labels.some(label=>label.key==='sec:method'));assert.ok(index.commands.some(command=>command.name==='sysname'));
 assert.ok((await studio.dispatch({action:'tree',projectId:acm.id})).files.every(file=>!file.path.endsWith('.gitkeep')),'placeholders stay out of the file tree');
 await assert.rejects(studio.dispatch({action:'create',parent,name:'x',template:'ieee'}),/Unknown template/);await assert.rejects(access(join(parent,'x')));
 await assert.rejects(studio.dispatch({action:'create',parent,name:'plain',template:'acm'}),/EEXIST/);
 await assert.rejects(studio.dispatch({action:'create',parent,name:'y',template:'acm'},{user:false}),/Only the user/);
 await assert.rejects(studio.dispatch({action:'template-sync',template:'acm'},{user:false}),/Only the user/);
 assert.equal((await studio.dispatch({action:'templates'},{user:false})).templates.length,3);
});

test('creating from a template that was never fetched fails offline without leaving a folder',async t=>{
 const {root,fetch}=await setup(t),studio=new Studio(join(root,'service'),{fetch}),parent=join(root,'papers');await mkdir(parent);
 await assert.rejects(studio.dispatch({action:'create',parent,name:'offline',template:'acm'}),/Connect to the network to fetch the ACM template/);
 await assert.rejects(access(join(parent,'offline')));
 assert.equal((await studio.dispatch({action:'create',parent,name:'offline'})).main,'main.tex','the blank template needs no network');
});
