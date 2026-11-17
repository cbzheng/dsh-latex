import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EditorState} from '@codemirror/state';
import {CompletionContext} from '@codemirror/autocomplete';
import {scanTex,parseBib} from '../src/texscan.mjs';
import {completionAt,withLiveFile,environmentClosed,openEnvironment} from '../web/complete.mjs';
import {latexCompletionSource} from '../web/editor.mjs';
import {Studio} from '../src/service.mjs';

const BIB=`@string{chi = "Proceedings of the CHI Conference"}
@inproceedings{zheng2026clinical,
  author = {Zheng, Ada and Li, Bo and Park, Chae},
  title = {Explaining {Clinical} Decisions with Synthetic Agents},
  booktitle = chi # " on Human Factors",
  year = 2026
}
@article{smith2020trust, author={Jane Smith}, title="Trust in automation: a review", journal={Synthetic Journal}, year={2020}}
@comment{ignored, title={Not an entry}}
`;
const MAIN=`\\documentclass[sigconf]{acmart}
\\usepackage{booktabs,siunitx}
\\newcommand{\\sysname}{Synth\\xspace}
\\newcommand{\\note}[2][x]{#2}
\\graphicspath{{Figures/}}
\\begin{document}
\\section{Introduction}\\label{sec:intro}
\\input{Sections/method}
\\begin{figure}
  \\includegraphics{teaser}
  \\caption{The synthetic interface overview}
  \\label{fig:teaser}
\\end{figure}
\\bibliography{refs}
\\end{document}
`;
async function project(t){
 const root=await mkdtemp(join(tmpdir(),'latex-complete-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paper=join(root,'paper');await mkdir(join(paper,'Sections'),{recursive:true});await mkdir(join(paper,'Figures'));
 await writeFile(join(paper,'main.tex'),MAIN);await writeFile(join(paper,'refs.bib'),BIB);
 await writeFile(join(paper,'Sections/method.tex'),'\\section{Method}\\label{sec:method}\n\\begin{equation}a=b\\label{eq:one}\\end{equation}\n');
 await writeFile(join(paper,'Figures/teaser.pdf'),'%PDF-1.4');
 const studio=new Studio(join(root,'state')),p=await studio.projects.open(paper);
 return {studio,p,index:await studio.dispatch({action:'index',projectId:p.id}),files:(await studio.dispatch({action:'tree',projectId:p.id})).files};
}
const labels=result=>result.options.map(option=>option.label);

test('the source scanner reads labels with their kind, definitions, packages and bibliography entries',()=>{
 const scan=scanTex(MAIN);
 assert.deepEqual(scan.labels.map(label=>[label.key,label.kind]),[['sec:intro','section'],['fig:teaser','figure']]);
 assert.match(scan.labels[1].hint,/synthetic interface overview/);
 assert.deepEqual(scan.commands.map(command=>[command.name,command.args,Boolean(command.optional)]),[['sysname',0,false],['note',1,true]]);
 assert.deepEqual(scan.packages,['booktabs','siunitx']);assert.deepEqual(scan.classes,['acmart']);assert.deepEqual(scan.graphicsPaths,['Figures/']);
 assert.equal(scanTex('% \\label{hidden}\nText \\% \\label{shown}').labels.map(label=>label.key).join(),'shown');
 const entries=parseBib(BIB);
 assert.deepEqual(entries.map(entry=>entry.key),['zheng2026clinical','smith2020trust']);
 assert.equal(entries[0].title,'Explaining Clinical Decisions with Synthetic Agents');assert.equal(entries[0].author,'Zheng et al.');
 assert.equal(entries[0].venue,'Proceedings of the CHI Conference on Human Factors');assert.equal(entries[1].author,'Smith');assert.equal(entries[1].year,'2020');
});

test('the host index gathers every project file and is readable by the assistant',async t=>{
 const {studio,p,index}=await project(t);
 assert.deepEqual(index.labels.map(label=>label.key).sort(),['eq:one','fig:teaser','sec:intro','sec:method']);
 assert.equal(index.labels.find(label=>label.key==='eq:one').path,'Sections/method.tex');
 assert.deepEqual(index.citations.map(entry=>entry.key),['zheng2026clinical','smith2020trust']);
 assert.ok(index.commands.some(command=>command.name==='sysname'));assert.ok(index.packages.includes('siunitx'));
 const unsaved=await studio.dispatch({action:'index',projectId:p.id,sources:{'refs.bib':'@misc{draft2026, title={Unsaved entry}}'}});
 assert.deepEqual(unsaved.citations.map(entry=>entry.key),['draft2026']);
 assert.equal((await studio.dispatch({action:'index',projectId:p.id},{user:false})).citations.length,2);
 await assert.rejects(studio.dispatch({action:'index',projectId:'missing'}),/Unknown project/);
});

test('a backslash offers commands: frequent ones first, package commands when loaded, project macros included',async t=>{
 const {index}=await project(t),data={index,files:[],path:'main.tex',main:'main.tex'};
 const all=completionAt('Text \\',data);assert.equal(all.kind,'command');assert.equal(all.from,5);assert.ok(all.options.length>300);
 const find=name=>all.options.find(option=>option.name===name);
 assert.ok(find('section').template.includes('${'));assert.ok(find('sysname').boost>find('section').boost,'project macros rank first');
 assert.equal(find('note').label,'\\note[]{}');
 assert.ok(find('sec').boost<-90&&find('section').boost>0,'the secant does not outrank \\section');
 const redefined=completionAt('\\',{index:{...index,commands:scanTex('\\renewcommand{\\sectionautorefname}{Sec.}').commands},files:[]}).options;
 assert.ok(!(redefined.find(option=>option.name==='sectionautorefname').boost>0),'a redefined standard command is not promoted');
assert.ok(find('SI'),'siunitx is loaded');
 assert.equal(completionAt('\\',{index:{...index,packages:[]},files:[]}).options.some(option=>option.name==='SI'),false);
 assert.ok(completionAt('\\',{}).options.some(option=>option.name==='includegraphics'),'common packages need no index');
 assert.equal(completionAt('line break \\\\',data),null);assert.equal(completionAt('\\href{',data),null);
});

test('citations are found by title, author or year words; labels by caption, key or kind',async t=>{
 const {index,files}=await project(t),data={index,files,path:'main.tex',main:'main.tex'};
 const byTitle=completionAt('as shown \\cite{clin expl',data);
 assert.equal(byTitle.kind,'cite');assert.equal(byTitle.filter,false);assert.deepEqual(labels(byTitle),['zheng2026clinical']);
 assert.equal(byTitle.options[0].detail,'Zheng et al. 2026');assert.match(byTitle.options[0].title,/Explaining Clinical Decisions/);
 assert.deepEqual(labels(completionAt('\\citep[see][p.~3]{smith2020trust, zheng 2026',data)),['zheng2026clinical']);
 assert.deepEqual(labels(completionAt('\\textcite{review',data)),['smith2020trust']);
 assert.equal(completionAt('\\cite{',data).options.length,2);
 const second=completionAt('\\cite{smith2020trust,tru',data);assert.equal(second.from,'\\cite{smith2020trust,'.length);
 const byCaption=completionAt('see \\autoref{interface',data);
 assert.equal(byCaption.kind,'ref');assert.deepEqual(labels(byCaption),['fig:teaser']);assert.equal(byCaption.options[0].detail,'Fig.');
 assert.deepEqual(labels(completionAt('\\cref{sec:intro,eq',data)),['eq:one']);
 assert.equal(completionAt('\\ref{',data).options.length,4);assert.equal(completionAt('\\hyperref[meth',data).options[0].label,'sec:method');
});

test('environments, packages, classes and file paths complete in their arguments',async t=>{
 const {index,files}=await project(t),data={index,files,path:'main.tex',main:'main.tex'};
 const begin=completionAt('\\begin{tab',data);assert.equal(begin.kind,'begin');assert.ok(labels(begin).includes('table')&&labels(begin).includes('tabular'));
 assert.match(begin.options.find(option=>option.label==='table').body,/\\toprule/,'booktabs rules when the package is loaded');
 assert.equal(labels(completionAt('\\begin{figure}\n\\begin{center}\n\\end{center}\n\\end{',data))[0],'figure');
 assert.equal(openEnvironment('\\begin{a}\\begin{b}\\end{b}'),'a');
 assert.equal(environmentClosed('text\n\\end{figure}\n','figure'),true,'an unmatched end is waiting');assert.equal(environmentClosed('\\begin{figure}\n\\end{figure}\n','figure'),false);
 assert.ok(labels(completionAt('\\usepackage{clev',data)).includes('cleveref'));assert.ok(labels(completionAt('\\usepackage[capitalise]{amsmath,clev',data)).includes('cleveref'));
 assert.ok(labels(completionAt('\\documentclass[sigconf]{acm',data)).includes('acmart'));
 assert.ok(labels(completionAt('\\bibliographystyle{ACM',data)).includes('ACM-Reference-Format'));
 assert.deepEqual(labels(completionAt('\\includegraphics[width=\\linewidth]{tea',data)),['teaser.pdf']);
 assert.deepEqual(labels(completionAt('\\input{meth',data)),['Sections/method']);
 assert.deepEqual(labels(completionAt('\\bibliography{',data)),['refs']);
});

test('the open file is completed from the editor text before it is saved',async t=>{
 const {index}=await project(t);
 const merged=withLiveFile(index,'Sections/method.tex',scanTex('\\section{Method}\\label{sec:approach}\n\\newcommand{\\fresh}{x}'));
 assert.deepEqual(merged.labels.map(label=>label.key).sort(),['fig:teaser','sec:approach','sec:intro']);
 assert.ok(merged.commands.some(command=>command.name==='fresh'));assert.equal(index.labels.length,4,'the host index is not mutated');
});

// The editor source applied to a real editor state through the completion's own apply.
function editor(doc,pos=doc.length){let state=EditorState.create({doc,selection:{anchor:pos}});return {get state(){return state;},dispatch(...specs){state=state.update(...specs).state;},focus(){}};}
function pick(view,data,label,explicit=false){
 const result=latexCompletionSource(()=>data)(new CompletionContext(view.state,view.state.selection.main.head,explicit));
 if(!label)return result;
 const option=result.options.find(item=>item.label===label);assert.ok(option,label+' offered');option.apply(view,option,result.from,result.to);
 return view.state.doc.toString();
}
const caret=view=>view.state.selection.main.head;

test('picking a completion inserts the command, key or environment and places the caret',async t=>{
 const {index,files}=await project(t),data={index,files,path:'Sections/draft.tex',main:'main.tex'}; // the editor holds a new, unsaved file
 let view=editor('\\sec');assert.equal(pick(view,data,'\\section{}'),'\\section{}');assert.equal(caret(view),9);
 view=editor('\\sec{Title}',4);assert.equal(pick(view,data,'\\section{}'),'\\section{Title}','existing arguments are kept');
 view=editor('\\cite{clin');assert.equal(pick(view,data,'zheng2026clinical'),'\\cite{zheng2026clinical}');assert.equal(caret(view),view.state.doc.length);
 view=editor('\\cite{a,clin}',12);assert.equal(pick(view,data,'zheng2026clinical'),'\\cite{a,zheng2026clinical}');assert.equal(caret(view),view.state.doc.length);
 view=editor('\\ref{teas');assert.equal(pick(view,data,'fig:teaser'),'\\ref{fig:teaser}');
 view=editor('\\begin{enum');assert.equal(pick(view,data,'enumerate'),'\\begin{enumerate}\n  \\item \n\\end{enumerate}');assert.equal(view.state.doc.lineAt(caret(view)).number,2);
 view=editor('\\begin{enum}\n\\item a\n\\end{enumerate}',11);assert.equal(pick(view,data,'enumerate'),'\\begin{enumerate}\n\\item a\n\\end{enumerate}','an environment that is already closed is only renamed');
 view=editor('\\begin{figure}\nx\n\\end{');assert.equal(pick(view,data,'figure'),'\\begin{figure}\nx\n\\end{figure}');
 assert.equal(pick(editor('plain text'),data),null);assert.equal(pick(editor('a \\\\'),data),null);
 view=editor('\\label{sec:new}\n\\ref{sec:n');assert.equal(pick(view,{...data,path:'Sections/method.tex'},'sec:new'),'\\label{sec:new}\n\\ref{sec:new}','labels typed in this session');
});
