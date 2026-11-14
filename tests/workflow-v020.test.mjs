import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EditorState,EditorSelection} from '@codemirror/state';
import {history,undo,redo} from '@codemirror/commands';
import {Projects} from '../src/projects.mjs';
import {Git} from '../src/git.mjs';
import {run} from '../src/util.mjs';
import {repositoryInfo,visibleRemote} from '../src/repository.mjs';
import {formatText} from '../web/editor.mjs';

async function fixture(t){const root=await mkdtemp(join(tmpdir(),'latex-workflow-'));t.after(()=>rm(root,{recursive:true,force:true}));const paper=join(root,'paper');await mkdir(paper);const projects=new Projects(join(root,'state'));return {root,paper,projects};}
test('root detection ignores commented classes and fragments; honors subfile root hints',async t=>{
 const {paper,projects}=await fixture(t);await mkdir(join(paper,'chapters'));await mkdir(join(paper,'samples'));await mkdir(join(paper,'z-folder'));await writeFile(join(paper,'aa.txt'),'note');
 await writeFile(join(paper,'main.tex'),'% \\documentclass{article}\nJust a fragment');
 await writeFile(join(paper,'paper.tex'),'\\documentclass{article}\n\\input{chapters/introduction}');
 await writeFile(join(paper,'review.tex'),'\\documentclass[review]{article}');
 await writeFile(join(paper,'chapters/introduction.tex'),'% !TeX root = ../review.tex\n\\section{Introduction}');
 await writeFile(join(paper,'samples/template.tex'),'\\documentclass{article}');
 const p=await projects.open(paper);assert.equal(p.main,'review.tex');assert.deepEqual(p.mainCandidates,['review.tex','paper.tex','samples/template.tex']);
 const tree=await projects.tree(p.id);assert.deepEqual(tree.mainCandidates,p.mainCandidates);
 assert.ok(tree.files.findIndex(f=>f.path==='chapters/introduction.tex')<tree.files.findIndex(f=>f.path==='aa.txt'),'Folder contents are listed before loose files');
 await projects.configure(p.id,{main:'paper.tex'});assert.equal((await projects.get(p.id)).main,'paper.tex');
 await mkdir(join(paper,'invalid.tex'));await assert.rejects(projects.configure(p.id,{main:'invalid.tex'}),/regular/);
 await assert.rejects(projects.configure(p.id,{main:'main.tex',engine:'invalid'}));assert.equal((await projects.get(p.id)).main,'paper.tex','Rejected settings leave the prior main intact');
});
test('GitHub links normalize without accepting credentials or file links',()=>{
 assert.deepEqual(repositoryInfo('https://github.com/owner/-Example/tree/main?tab=readme-ov-file'),{url:'https://github.com/owner/-Example.git',name:'-Example',branch:'main',githubRepo:'owner/-Example'});
 assert.equal(repositoryInfo('owner/paper').url,'https://github.com/owner/paper.git');
 assert.equal(repositoryInfo('git@github.com:owner/paper.git').url,'git@github.com:owner/paper.git');
 assert.equal(repositoryInfo('https://github.com/owner/paper/tree/feature%2Fdraft').branch,'feature/draft');
 for(const url of ['https://username:password@github.com/owner/paper','https://token@github.com/owner/paper','https://github.com/owner/paper?access_token=private','file:///tmp/repo','https://github.com/owner/paper/blob/main/main.tex','https://github.com/owner/paper/tree/main/folder','owner/paper\n--option'])assert.throws(()=>repositoryInfo(url));
 assert.equal(visibleRemote('https://secret@example.invalid/repo?token=value'),'https://[redacted]@example.invalid/repo?[redacted]');
});
test('connect origin is idempotent and never replaces an existing remote',async t=>{
 const {paper,projects}=await fixture(t);await writeFile(join(paper,'main.tex'),'\\documentclass{article}');const p=await projects.open(paper),git=new Git(projects);
 await git.mutate(p.id,'init');assert.equal((await git.status(p.id)).remote,null);
 let status=await git.mutate(p.id,'connect',{url:'https://github.com/synthetic/paper'});assert.equal(status.remote,'https://github.com/synthetic/paper.git');
 await git.mutate(p.id,'connect',{url:'git@github.com:synthetic/paper.git'});
 await assert.rejects(git.mutate(p.id,'connect',{url:'https://github.com/synthetic/other'}),{status:409});
 assert.equal((await git.status(p.id)).remote,'https://github.com/synthetic/paper.git');
});
test('first push sets upstream on an existing local remote without forced updates',async t=>{
 const {root,paper,projects}=await fixture(t);await writeFile(join(paper,'main.tex'),'\\documentclass{article}');
 const p=await projects.open(paper),git=new Git(projects),remote=join(root,'remote.git');
 for(const args of [['init','-b','main'],['config','user.name','Synthetic Test'],['config','user.email','test@example.invalid'],['add','main.tex'],['commit','-m','Initial'],['init','--bare',remote],['remote','add','origin',remote]]){const r=await run('git',args,{cwd:paper});assert.equal(r.code,0,r.output);}
 const status=await git.mutate(p.id,'push');assert.equal(status.upstream,'0\t0');
 assert.match((await run('git',['show','main:main.tex'],{cwd:remote})).output,/documentclass/);
});
test('format commands wrap or toggle selection, work at caret, and preserve undo grouping',()=>{
 let focused=0,state=EditorState.create({doc:'Hello world',selection:EditorSelection.range(6,11),extensions:[history()]});
 const view={get state(){return state;},dispatch:transaction=>{state=state.update(transaction).state;},focus:()=>focused++};
 assert.equal(formatText(view,'bold'),true);assert.equal(state.doc.toString(),'Hello \\textbf{world}');assert.equal(state.sliceDoc(state.selection.main.from,state.selection.main.to),'world');
 formatText(view,'bold');assert.equal(state.doc.toString(),'Hello world');
 formatText(view,'italic');assert.equal(state.doc.toString(),'Hello \\textit{world}');
 assert.equal(undo(view),true);assert.equal(state.doc.toString(),'Hello world');assert.equal(redo(view),true);assert.equal(state.doc.toString(),'Hello \\textit{world}');
 state=EditorState.create({doc:'',selection:EditorSelection.cursor(0)});formatText(view,'bold');assert.equal(state.doc.toString(),'\\textbf{}');assert.equal(state.selection.main.head,8);assert.equal(formatText(view,'unknown'),false);assert.equal(focused,4);
});
test('GitHub auth failure can use existing gh CLI without modifying global Git configuration',async t=>{
 const {root,projects}=await fixture(t),bin=join(root,'bin');await mkdir(bin);
 await writeFile(join(bin,'git'),'#!/bin/sh\nprintf "Authentication failed\\n" >&2\nexit 128\n',{mode:0o755});
 await writeFile(join(bin,'gh'),'#!/bin/sh\n[ "$1" = repo ] && [ "$2" = clone ] || exit 1\nmkdir -p "$4"\nprintf "\\\\documentclass{article}\\n" > "$4/main.tex"\n',{mode:0o755});
 const old=process.env.PATH;process.env.PATH=bin+':'+old;
 try{const p=await projects.clone(root,'','https://github.com/synthetic/-paper/tree/main');assert.equal(p.title,'-paper');assert.equal(p.main,'main.tex');assert.match(await readFile(join(p.root,'main.tex'),'utf8'),/documentclass/);}finally{process.env.PATH=old;}
});
