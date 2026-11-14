import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {Studio} from '../src/service.mjs';
const root=resolve(process.env.LATEX_TEST_ROOT||await mkdtemp(join(tmpdir(),'latex-integration-')));
await mkdir(root,{recursive:true});const studio=new Studio(join(root,'state'));
const wait=async id=>{const deadline=Date.now()+20*60*1000;for(;;){const job=await studio.compiler.latest(id);if(!['queued','running'].includes(job.phase)){assert.equal(job.phase,'success',job.log);return job;}assert.ok(Date.now()<deadline,'Compilation timed out');await new Promise(r=>setTimeout(r,250));}};
const documents={
 pdflatex:'\\documentclass{article}\n\\begin{document}\n\\section{Hello}\nA synthetic paper.\\label{one}\n\\end{document}\n',
 xelatex:'\\documentclass[fontset=fandol]{ctexart}\n\\begin{document}\n中文论文测试。\\section{方法}字体与公式 $a^2+b^2=c^2$。\n\\end{document}\n',
 lualatex:'\\documentclass{article}\n\\usepackage{fontspec}\n\\begin{document}\nLuaLaTeX test.\n\\end{document}\n',
 bibtex:'\\documentclass{article}\n\\begin{document}\nCitation \\cite{example}.\n\\bibliographystyle{plain}\n\\bibliography{refs}\n\\end{document}\n',
 biber:'\\documentclass{article}\n\\usepackage[backend=biber]{biblatex}\n\\addbibresource{refs.bib}\n\\begin{document}\nCitation \\cite{example}.\n\\printbibliography\n\\end{document}\n',
 acm:'\\documentclass[sigconf,review]{acmart}\n\\setcopyright{none}\n\\title{Synthetic complex project}\n\\author{Synthetic Author}\n\\affiliation{\\institution{Test Institute}\\city{Test City}\\country{Test Country}}\n\\begin{document}\n\\begin{abstract}A synthetic compiler acceptance document.\\end{abstract}\n\\maketitle\n\\input{sections/body}\n\\bibliographystyle{ACM-Reference-Format}\n\\bibliography{refs}\n\\end{document}\n'
};
const results=[];
for(const [example,source] of Object.entries(documents)){
 const engine=['bibtex','biber','acm'].includes(example)?'pdflatex':example;
 const dir=join(root,example==='acm'?'complex ACM project':example),main=example==='acm'?'paper/review main.tex':'main.tex';
 await mkdir(join(dir,example==='acm'?'paper':'.'),{recursive:true});await writeFile(join(dir,main),source);
 await writeFile(join(dir,'refs.bib'),'@article{example,author={Synthetic Author},title={A test reference},journal={Test Journal},year={2026}}\n');
 if(example==='acm'){await mkdir(join(dir,'sections'),{recursive:true});await writeFile(join(dir,'sections/body.tex'),'\\section{Methods}\\label{one}\nA multi-file project with a nested root file and spaces in its name.\nCitation \\cite{example}.\n\\subsection{Equation}\n\\begin{equation}a^2+b^2=c^2\\end{equation}\n');}
 const p=await studio.projects.open(dir);await studio.projects.configure(p.id,{main,engine,online:true,autoCompile:false});
 await studio.compiler.start(p.id);const job=await wait(p.id);
 assert.equal((await readFile(await studio.compiler.pdf(p.id,job.id))).subarray(0,4).toString(),'%PDF');
 if(['bibtex','biber','acm'].includes(example)){const bbl=await readFile(join(studio.compiler.directory,p.id,job.id,'output',basename(main,'.tex')+'.bbl'),'utf8');assert.match(bbl,/Synthetic/,'Bibliography produced');}
 const syncPath=example==='acm'?'sections/body.tex':main;
 // Query a typeset citation line inside the included paragraph. ACM's first
 // paragraph/label boundary can map back to a main-file box in native SyncTeX.
 const syncLine=example==='biber'?5:3;
 const point=await studio.compiler.sync(p.id,{jobId:job.id,path:syncPath,line:syncLine});
 assert.ok(point.page>=1,'Forward SyncTeX');const inverse=await studio.compiler.sync(p.id,{jobId:job.id,...point});assert.equal(inverse.path,syncPath,'Inverse SyncTeX');if(example==='acm')assert.equal(inverse.line,syncLine,'Included-file SyncTeX line');
 await studio.projects.configure(p.id,{online:false});await studio.compiler.start(p.id);const offline=await wait(p.id);assert.equal(offline.pdfSha256.length,64);
 await writeFile(join(dir,main),'\\documentclass{article}\\begin{document}\\undefinedcommand\\end{document}');await studio.compiler.start(p.id);
 let failure;do{await new Promise(r=>setTimeout(r,250));failure=await studio.compiler.latest(p.id);}while(['queued','running'].includes(failure.phase));
 assert.equal(failure.phase,'error');assert.equal(failure.pdfJobId,offline.id);
 results.push({example,engine,online:true,offline:true,synctex:true,preservesLastPDF:true});console.log(JSON.stringify(results.at(-1)));
}
console.log(JSON.stringify({passed:results.length,root}));
