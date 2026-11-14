import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EditorState,EditorSelection} from '@codemirror/state';
import {history,undo} from '@codemirror/commands';
import {formatText} from '../web/editor.mjs';
import {gitKind,splitPath,syncCounts,relativeTime,COMPILE_INTERVALS} from '../web/git-ui.mjs';
import {Projects} from '../src/projects.mjs';

function editor(doc,from,to=from){
 let state=EditorState.create({doc,selection:EditorSelection.range(from,to),extensions:[history()]});
 return {get state(){return state;},dispatch:t=>{state=state.update(t).state;},focus(){},undo(){undo({state,dispatch:t=>{state=t.state?t.state:state.update(t).state;}});}};
}
test('list buttons insert an environment at an empty line and itemize selected lines',()=>{
 const empty=editor('a\n\nb',2);formatText(empty,'itemize');
 assert.equal(empty.state.doc.toString(),'a\n\\begin{itemize}\n  \\item \n\\end{itemize}\nb');
 assert.equal(empty.state.doc.lineAt(empty.state.selection.main.head).text,'  \\item ');
 const lines=editor('  first\n  \\item second\nrest',0,22);formatText(lines,'enumerate');
 assert.equal(lines.state.doc.toString(),'  \\begin{enumerate}\n    \\item first\n    \\item second\n  \\end{enumerate}\nrest');
 lines.undo();assert.equal(lines.state.doc.toString(),'  first\n  \\item second\nrest');
});
test('figure button places the caret in includegraphics and uses a selection as caption',()=>{
 const plain=editor('Text here.',10);formatText(plain,'figure');
 const doc=plain.state.doc.toString(),head=plain.state.selection.main.head;
 assert.match(doc,/^Text here\.\n\\begin\{figure\}\[htbp\]\n  \\centering\n  \\includegraphics\[width=\\linewidth\]\{\}\n  \\caption\{\}\n  \\label\{fig:\}\n\\end\{figure\}\n$/);
 assert.equal(doc.slice(head-1,head+1),'{}');
 const captioned=editor('A pipeline overview',0,19);formatText(captioned,'figure');
 assert.match(captioned.state.doc.toString(),/\\caption\{A pipeline overview\}/);
});
test('Git view helpers classify status, paths, sync counts and time',()=>{
 assert.deepEqual(gitKind({status:'??'}),{letter:'U',kind:'untracked'});
 assert.equal(gitKind({status:' M'}).kind,'modified');assert.equal(gitKind({status:'D '}).kind,'deleted');assert.equal(gitKind({status:'UU',conflict:true}).kind,'conflict');
 assert.deepEqual(splitPath('chapters/intro.tex'),{name:'intro.tex',dir:'chapters'});
 assert.deepEqual(syncCounts('2\t1'),{ahead:2,behind:1,tracked:true});assert.equal(syncCounts(null).tracked,false);
 assert.equal(relativeTime(new Date(Date.now()-3*3600e3).toISOString(),'en'),'3 hours ago');
 assert.ok(COMPILE_INTERVALS.includes(0)&&COMPILE_INTERVALS.includes(5));
});
test('projects default to a five-minute build interval and validate changes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'latex-ui-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paper=join(root,'paper');await mkdir(paper);await writeFile(join(paper,'main.tex'),'\\documentclass{article}\\begin{document}x\\end{document}\n');
 const projects=new Projects(join(root,'data'));const p=await projects.open(paper);
 assert.equal(p.compileInterval,5);
 assert.equal((await projects.configure(p.id,{compileInterval:0})).compileInterval,0);
 await assert.rejects(projects.configure(p.id,{compileInterval:500}),/0–120/);
 await assert.rejects(projects.configure(p.id,{compileInterval:2.5}),/0–120/);
});

test('inside a host window the stylesheet drops nested backdrop blur',async()=>{
 const {readFile}=await import('node:fs/promises');
 const css=await readFile(new URL('../web/style.css',import.meta.url),'utf8');
 assert.match(css,/:is\(\.ls-root\[data-host=window\],\.ls-headerbar\)\[class\] \{ --ls-blur:none; --ls-glass:var\(--ls-glass-strong\) \}/);
 for(const rule of css.match(/backdrop-filter:[^;}]+/g))assert.match(rule,/backdrop-filter:\s*(var\(--ls-blur\)|none)/,rule);
});

test('optional host render hints pause covered PDF painting and trim background page bitmaps',async()=>{
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(new URL('../web/client.mjs',import.meta.url),'utf8');
 const body=source.match(/const syncPainting=\(\)=>\{([^]*?)\n \};/)?.[1];assert.ok(body,'shipped hint handler');
 const run=(hint,active=true)=>{
  const calls={},live={active,renderHints:hint===undefined?undefined:{get:()=>hint}},pdf={current:{setActive:value=>{calls.active=value;},setResidentLimit:value=>{calls.limit=value;}}};
  new Function('live','pdf',body)(live,pdf);return calls;
 };
 assert.deepEqual(run(undefined),{active:true,limit:7},'a host without hints behaves as before');
 assert.deepEqual(run({visibility:'focused',quality:'full'}),{active:true,limit:7});
 assert.deepEqual(run({visibility:'occluded',quality:'full'}),{active:false,limit:7});
 assert.deepEqual(run({visibility:'hidden',quality:'reduced'}),{active:false,limit:3});
 assert.deepEqual(run({visibility:'visible',quality:'reduced'}),{active:true,limit:3});
 assert.deepEqual(run({visibility:'focused',quality:'reduced'}),{active:true,limit:7},'the focused window keeps its pages');
 assert.deepEqual(run({visibility:'visible',quality:'full'},false),{active:false,limit:7},'the existing active state still wins');
 // An older viewer build without the budget method must not break.
 const live={active:true,renderHints:{get:()=>({visibility:'visible',quality:'reduced'})}},seen=[];
 new Function('live','pdf',body)(live,{current:{setActive:value=>seen.push(value)}});assert.deepEqual(seen,[true]);
 assert.match(source,/return renderHints\?\.subscribe\?\.\(syncPainting\);/);
});
