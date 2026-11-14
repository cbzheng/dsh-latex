import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Studio} from '../src/service.mjs';
import {diagnostics} from '../src/assist.mjs';
import {latexAssistProvider,locateLines} from '../web/assist.mjs';

const MAIN='\\documentclass{article}\n\\usepackage{amsmath,graphicx}\n\\newcommand{\\method}{SynthNet}\n\\newcommand\\score[1]{#1}\n\\begin{document}\n\\section{Intro}\nAlpha line.\n% \\usepackage{ignored}\n\\input{body}\n\\bibliography{refs}\n\\end{document}\n';
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'latex-assist-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paper=join(root,'paper');await mkdir(paper);await writeFile(join(paper,'main.tex'),MAIN);await writeFile(join(paper,'body.tex'),'One\nTwo synthetic\nThree\n');
 const studio=new Studio(join(root,'state'));const p=await studio.projects.open(paper);return {paper,studio,p,ai:args=>studio.dispatch({projectId:p.id,...args},{user:false}),ui:args=>studio.dispatch({projectId:p.id,...args})};
}

test('project context is a stable digest of brief, files, packages and macros',async t=>{
 const {ai,ui,paper}=await fixture(t);
 const first=await ai({action:'context'});
 assert.match(first.text,/Main file: main\.tex/);assert.match(first.text,/Packages: amsmath, graphicx/);assert.doesNotMatch(first.text,/ignored/);
 assert.match(first.text,/\\method \\score#1/);assert.match(first.text,/Bibliography: refs/);
 assert.equal((await ai({action:'context'})).revision,first.revision,'unchanged project keeps its revision');
 await writeFile(join(paper,'body.tex'),'Edited prose only\n');
 assert.equal((await ai({action:'context'})).revision,first.revision,'prose edits do not invalidate the cached prefix');
 await ui({action:'configure',changes:{brief:'Venue: synthetic workshop. Keep British spelling.'}});
 const briefed=await ai({action:'context'});assert.notEqual(briefed.revision,first.revision);assert.match(briefed.text,/^Project brief/);
 await assert.rejects(ai({action:'configure',changes:{brief:'x'}}),/user/);
 await assert.rejects(ui({action:'configure',changes:{brief:'x'.repeat(8001)}}),/8000/);
 await ui({action:'configure',changes:{brief:''}});assert.equal((await ai({action:'projects'})).projects[0].brief,undefined);
});

test('line ranges, search and diagnostics keep Agent reads small',async t=>{
 const {ai}=await fixture(t);
 const range=await ai({action:'read',path:'body.tex',fromLine:2,toLine:2});
 assert.equal(range.text,'2| Two synthetic');assert.equal(range.lineCount,4);assert.match(range.revision,/^[a-f0-9]{64}$/);
 const found=await ai({action:'search',query:'SYNTHETIC',sources:{'body.tex':'draft synthetic\n'}});
 assert.deepEqual(found.matches.map(m=>[m.path,m.line]),[['body.tex',1]],'the live draft replaces disk text');
 const d=diagnostics({phase:'error',log:'./main.tex:7: Undefined control sequence.\n! LaTeX Error: File `x.sty\' not found.\n\nl.2 \\usepackage\nLaTeX Warning: Reference `a\' undefined\n'});
 assert.deepEqual(d.errors,[{path:'main.tex',line:7,message:'Undefined control sequence.'},{message:'LaTeX Error: File `x.sty\' not found.',line:2}]);assert.equal(d.warnings,1);
 assert.equal((await ai({action:'errors'})).phase,'idle');
});

test('local edit proposals are revision-checked, unambiguous and still need the owner',async t=>{
 const {ai,ui,paper}=await fixture(t);const {revision}=await ai({action:'read',path:'body.tex'});
 await assert.rejects(ai({action:'propose-edit',path:'body.tex',baseRevision:revision,summary:'x',edits:[{find:'e',text:'E'}]}),/ambiguous/);
 await assert.rejects(ai({action:'propose-edit',path:'body.tex',baseRevision:revision,summary:'x',edits:[{fromLine:2,toLine:2,expected:'Two',text:'2'}]}),/changed/);
 const proposal=await ai({action:'propose-edit',path:'body.tex',baseRevision:revision,summary:'Tighten',edits:[{find:'Two synthetic',text:'Two'},{fromLine:3,toLine:3,expected:'Three',text:'3a\n3b'}]});
 assert.equal(proposal.text,'One\nTwo\n3a\n3b\n');assert.equal(await readFile(join(paper,'body.tex'),'utf8'),'One\nTwo synthetic\nThree\n');
 await assert.rejects(ai({action:'decide',id:proposal.id,accept:true}),/user/);
 await ui({action:'decide',id:proposal.id,accept:true});assert.equal(await readFile(join(paper,'body.tex'),'utf8'),'One\nTwo\n3a\n3b\n');
});

test('a created file is removed by undo only while unchanged and only from the UI',async t=>{
 const {ai,ui,paper}=await fixture(t);
 const created=await ui({action:'write',path:'sections/new.tex',text:'Draft\n',baseRevision:null}).catch(async e=>{await mkdir(join(paper,'sections'));return ui({action:'write',path:'sections/new.tex',text:'Draft\n',baseRevision:null});});
 await assert.rejects(ai({action:'remove-created',path:'sections/new.tex',revision:created.revision}),/user interface/);
 await ui({action:'write',path:'sections/new.tex',text:'Human edit\n',baseRevision:created.revision});
 await assert.rejects(ui({action:'remove-created',path:'sections/new.tex',revision:created.revision}),/kept/);
 const again=await ai({action:'read',path:'sections/new.tex'});
 assert.deepEqual(await ui({action:'remove-created',path:'sections/new.tex',revision:again.revision}),{path:'sections/new.tex',removed:true});
 await assert.rejects(access(join(paper,'sections/new.tex')));
});

test('the In-place AI provider declares bounded reads, navigation and file actions',async()=>{
 let config;const kit={objectSchema:(properties,required)=>({type:'object',properties,required,additionalProperties:false}),textSchema:n=>({type:'string',maxLength:n}),textRangeProvider:c=>(config=c,{version:1})};
 const calls=[],file={path:'main.tex',revision:'r1',text:'a\nb\nc'};
 const handle={getText:()=>'a\nb draft\nc',view:{hasFocus:true,state:{selection:{main:{from:0,to:1}}}},jump:line=>calls.push(['jump',line]),replace(){},onUpdate:()=>()=>{},range(){}};
 const live={project:{id:'p',title:'Paper',main:'main.tex',engine:'pdflatex'},file,standing:{projectId:'p',value:{key:'latex-studio:p',revision:'s1',text:'Brief'}},job:{phase:'error',message:'Undefined control sequence'}};
 const request=async(action,args)=>{calls.push([action,args]);if(action==='read')return {path:args.path,text:'x\ny',revision:'other-r'};if(action==='write')return {path:args.path,revision:'w1'};if(action==='tree')return {files:[{path:'main.tex',text:true},{path:'fig.png',text:false}]};return {};};
 const env={live,editor:{current:handle},request,flush:async()=>true,loadFile:async(path,o)=>(calls.push(['load',path,o]),true),refreshFiles:async()=>calls.push(['refresh'])};
 latexAssistProvider(kit,env);
 assert.equal(config.focused(),true);
 const s=config.session();assert.equal(config.session(),s,'one session per editor instance');
 const info=config.describe(s);
 assert.deepEqual(info.subject,{key:'latex-studio:p:main.tex',locator:{projectId:'p',path:'main.tex'},revision:'r1'});
 assert.equal(info.standing.revision,'s1');assert.equal(info.context.build.phase,'error');
 assert.deepEqual(info.reads.map(r=>r.name),['read_file','search','outline','list_files','build_errors']);
 assert.deepEqual(info.navigation.map(r=>r.name),['open_file','show_line']);
 assert.deepEqual(config.extraActions.map(a=>a.name),['create_file','edit_file']);
 assert.equal((await config.read('read_file',{path:'main.tex',from_line:2,to_line:2})).text,'2| b draft','open file reads include unsaved text');
 assert.deepEqual(await config.read('list_files',{}),{files:['main.tex']});
 await config.navigate('open_file',{path:'body.tex',line:4});assert.deepEqual(calls.at(-1),['load','body.tex',{line:4}]);
 await assert.rejects(config.extraActions[1].apply({path:'main.tex',from_line:1,to_line:1,expected:'a',text:'A'},s),/replace_lines/);
 const receipt=await config.extraActions[1].apply({path:'body.tex',from_line:2,to_line:2,expected:'y',text:'Y'},s);
 assert.deepEqual(calls.find(c=>c[0]==='write')[1],{projectId:'p',path:'body.tex',text:'x\nY',baseRevision:'other-r'});
 await assert.rejects(config.extraActions[1].undo(receipt,s),/changed/,'undo refuses a file changed afterwards');
 const made=await config.extraActions[0].apply({path:'new.tex',text:'New'},s);assert.deepEqual(made,{projectId:'p',path:'new.tex',revision:'w1'});
 // Review display: other-file edits and new files are shown as before/after text under their path.
 assert.deepEqual(config.extraActions[1].describe({path:'body.tex',from_line:2,to_line:2,expected:'y',text:'Y'}),{kind:'text',label:'body.tex',anchor:'file:body.tex:2',arg:['text'],before:'y',after:'Y'});
 assert.deepEqual(config.extraActions[0].describe({path:'new.tex',text:'New'}),{kind:'text',label:'new.tex',anchor:'file:new.tex',arg:['text'],before:'',after:'New'});
 live.conflict=true;assert.equal(config.describe(s).readOnly,true,'a save conflict disables AI writes');
 // The Next Space assist protocol rejects unbounded or >32000 strings ("Bounded strings required").
 const strings=[];const walk=v=>{if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object'){if(v.type==='string')strings.push(v.maxLength);Object.values(v).forEach(walk);}};
 walk([config.extraActions,info.reads,info.navigation].map(list=>list.map(a=>a.parameters)));
 assert.ok(strings.length>3&&strings.every(n=>Number.isInteger(n)&&n<=32000),'every declared string is bounded by 32000: '+strings);
});

test('other-file edits are found by content after earlier changes moved their lines',()=>{
 const lines=['a','b','target','d','target','f'];
 assert.equal(locateLines(lines,{from_line:3,to_line:3,expected:'target'}),2,'exact numbers win');
 assert.equal(locateLines(lines,{from_line:4,to_line:4,expected:'target'}),2,'a miss falls back to the nearest match');
 assert.equal(locateLines(lines,{from_line:6,to_line:6,expected:'target'}),4);
 assert.equal(locateLines(lines,{from_line:1,to_line:2,expected:'b\ntarget'}),1,'multi-line passages match as whole lines');
 assert.equal(locateLines(lines,{from_line:3,to_line:3,expected:'targ'}),-1,'partial lines never match');
 assert.equal(locateLines(lines,{from_line:9,to_line:9,expected:''}),-1);
});
