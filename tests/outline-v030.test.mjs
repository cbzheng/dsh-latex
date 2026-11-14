import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {Projects} from '../src/projects.mjs';
import {outlineProject} from '../src/outline.mjs';

async function fixture(t,files){
 const root=await mkdtemp(join(tmpdir(),'latex-outline-')),paper=join(root,'paper');t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(paper);
 for(const [path,text]of Object.entries(files)){await mkdir(dirname(join(paper,path)),{recursive:true});await writeFile(join(paper,path),text);}
 const projects=new Projects(join(root,'state')),project=await projects.open(paper);await projects.configure(project.id,{main:'main.tex'});return {root,paper,projects,id:project.id};
}

test('headings preserve positions, hierarchy, starred forms and readable nested or short titles',async t=>{
 const source=String.raw`\documentclass{book}
\part{A \textbf{nested {part}}}
\chapter*[A {short \emph{chapter}}]{The much longer chapter}
\section{Research \& Development: 50\%}
\subsection[Short {nested [brackets]}]{Long}
\subsubsection{A \texorpdfstring{$x^2$}{plain title}}
\paragraph{Details \label{details} \footnote{omitted}}
`;
 const {projects,id}=await fixture(t,{'main.tex':source}),result=await outlineProject(projects,id);
 assert.deepEqual(result.entries.map(({title,line,level,command,starred,path})=>({title,line,level,command,starred,path})),[
  {title:'A nested part',line:2,level:0,command:'part',starred:false,path:'main.tex'},
  {title:'A short chapter',line:3,level:1,command:'chapter',starred:true,path:'main.tex'},
  {title:'Research & Development: 50%',line:4,level:2,command:'section',starred:false,path:'main.tex'},
  {title:'Short nested [brackets]',line:5,level:3,command:'subsection',starred:false,path:'main.tex'},
  {title:'A plain title',line:6,level:4,command:'subsubsection',starred:false,path:'main.tex'},
  {title:'Details',line:7,level:5,command:'paragraph',starred:false,path:'main.tex'}
 ]);assert.equal(result.truncated,false);assert.deepEqual(result.warnings,[]);
});

test('comments, literal environments, inline verbatim and definitions cannot create headings or includes',async t=>{
 const source=String.raw`\documentclass{article}
% \section{Comment} \input{missing}
\verb|\section{Inline}| \verb*+\input{missing}+
\begin{verbatim}
\section{Example} \input{missing}
\end{verbatim}
\begin{minted}{tex}
\section{More example}
\end{minted}
\begin{comment}\section{Comment environment}\end{comment}
\newcommand{\example}[1]{\section{Macro body}}
\renewcommand\example[1][default]{\section{Macro body two}}
\newenvironment{example}{\section{Environment begin}}{\section{Environment end}}
\def\classic#1{\section{Classic macro body}}
\section{Actual % ignore \section{No}
heading}
\end{document}
\section{After document}
`;
 const {projects,id}=await fixture(t,{'main.tex':source}),result=await outlineProject(projects,id);
 assert.deepEqual(result.entries.map(e=>[e.title,e.line]),[['Actual heading',15]]);assert.deepEqual(result.warnings,[]);
});

test('main include order composes nested files and leaves unused headings grouped by file',async t=>{
 const {projects,id}=await fixture(t,{
  'main.tex':String.raw`\documentclass{article}
\section{Before}
\input{chapters/introduction}
\include{chapters/results}
\section{After}`,
  'chapters/introduction.tex':String.raw`\subsection{Introduction}
\input{detail}`,
  'chapters/detail.tex':String.raw`\subsubsection{Nested detail}`,
  'chapters/results.tex':String.raw`\section{Results}`,
  'unused.tex':String.raw`\section{Separate draft}`,
  'notes.txt':String.raw`\section{Not TeX}`
 }),result=await outlineProject(projects,id);
 assert.deepEqual(result.entries.map(e=>[e.path,e.title]),[['main.tex','Before'],['chapters/introduction.tex','Introduction'],['chapters/detail.tex','Nested detail'],['chapters/results.tex','Results'],['main.tex','After']]);
 assert.deepEqual(result.detached.map(group=>[group.path,group.entries.map(e=>e.title)]),[['unused.tex',['Separate draft']]]);
 assert.deepEqual(result.warnings,[]);
});

test('TeX cwd resolution wins over a fragment relative fallback and bare input is accepted',async t=>{
 const {projects,id}=await fixture(t,{
  'main.tex':String.raw`\documentclass{article}\input{chapter/start}`,
  'chapter/start.tex':String.raw`\section{Start}\input common`,
  'common.tex':String.raw`\section{Root common}`,
  'chapter/common.tex':String.raw`\section{Fragment common}`
 }),result=await outlineProject(projects,id);
 assert.deepEqual(result.entries.map(e=>e.title),['Start','Root common']);assert.equal(result.detached[0].path,'chapter/common.tex');
});

test('cycles terminate, repeated includes remain distinct, and pathological expansion is bounded',async t=>{
 const {projects,id}=await fixture(t,{
  'main.tex':String.raw`\documentclass{article}\input{fragment}\input{fragment}`,
  'fragment.tex':String.raw`\section{Repeated}\input{main}`
 }),result=await outlineProject(projects,id);
 assert.deepEqual(result.entries.map(e=>e.title),['Repeated','Repeated']);assert.notEqual(result.entries[0].id,result.entries[1].id);assert.ok(result.warnings.some(w=>w.code==='include_cycle'));
 const mock={get:async()=>({main:'main.tex',root:'synthetic'}),treeAt:async()=>[{path:'main.tex',text:true},{path:'empty.tex',text:true}],read:async(_id,path)=>({text:path==='main.tex'?'\\input{empty}'.repeat(2100):''})};
 const limited=await outlineProject(mock,'synthetic');assert.equal(limited.truncated,true);assert.ok(limited.warnings.some(w=>w.code==='include_limit'));
});

test('escaping, hidden, internal, symbolic and binary files never contribute headings',async t=>{
 const {root,paper,projects,id}=await fixture(t,{
  'main.tex':String.raw`\documentclass{article}
\section{Safe}
\input{../outside}\input{/tmp/private}\input{.private}\input{node_modules/internal}\input{linked}\input{binary}\input{image.png}`,
  '.private.tex':String.raw`\section{Hidden}`,
  'node_modules/internal.tex':String.raw`\section{Internal}`,
  'binary.tex':'\0\\section{Binary}',
  'image.png':String.raw`\section{Image}`
 });
 await writeFile(join(root,'outside.tex'),String.raw`\section{Outside}`);await symlink(join(root,'outside.tex'),join(paper,'linked.tex'));
 const result=await outlineProject(projects,id);assert.deepEqual(result.entries.map(e=>e.title),['Safe']);assert.deepEqual(result.detached,[]);
 assert.ok(result.warnings.some(w=>w.code==='binary_source'));assert.ok(result.warnings.some(w=>w.code==='include_unresolved'));
});

test('live source overrides alter outline and include links without saving disk content',async t=>{
 const disk=String.raw`\documentclass{article}\section{Disk}`;
 const {projects,id,paper}=await fixture(t,{'main.tex':disk,'fragment.tex':String.raw`\subsection{On disk}`});
 const result=await outlineProject(projects,id,{sources:{'main.tex':String.raw`\section{Unsaved}\input{fragment}`,'fragment.tex':String.raw`\subsection{Live fragment}`}});
 assert.deepEqual(result.entries.map(e=>e.title),['Unsaved','Live fragment']);assert.equal(await readFile(join(paper,'main.tex'),'utf8'),disk);
 assert.deepEqual((await outlineProject(projects,id)).entries.map(e=>e.title),['Disk']);
 const largeTitle=await outlineProject(projects,id,{sources:{'main.tex':'\\section{'+('Synthetic '.repeat(1000))+'}'}});assert.equal(largeTitle.entries[0].title.length,500);
 for(const sources of [[],{'../escape.tex':'bad'},{'.hidden.tex':'bad'},{'new-file.tex':'bad'},{'main.tex':4},{'main.tex':'x'.repeat(2*1024*1024+1)}])await assert.rejects(outlineProject(projects,id,{sources}),{status:400});
});

test('include depth is bounded and missing or unreadable files degrade to warnings',async t=>{
 const files={'main.tex':String.raw`\documentclass{article}\input{depth/0}`};for(let n=0;n<36;n++)files['depth/'+n+'.tex']='\\section{Depth '+n+'}\\input{depth/'+(n+1)+'}';
 const {projects,id}=await fixture(t,files),result=await outlineProject(projects,id);assert.equal(result.truncated,true);assert.ok(result.warnings.some(w=>w.code==='depth_limit'));assert.ok(result.entries.length<36);
 const missing=await outlineProject({get:async()=>({main:'missing.tex',root:'synthetic'}),treeAt:async()=>[]},'synthetic');assert.deepEqual(missing.entries,[]);assert.equal(missing.warnings[0].code,'main_unavailable');
 const unreadable=await outlineProject({get:async()=>({main:'main.tex',root:'synthetic'}),treeAt:async()=>[{path:'main.tex',text:true}],read:async()=>{throw Error('unavailable');}},'synthetic');assert.equal(unreadable.warnings[0].code,'read_failed');
});
