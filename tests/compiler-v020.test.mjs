import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Projects} from '../src/projects.mjs';
import {Compiler,buildFailure} from '../src/compiler.mjs';
import {Runtime,missingFiles,optionalPackages} from '../src/runtime.mjs';
import {serial} from '../src/util.mjs';

test('font dependencies include Type1, encoding and metric failures',()=>{
 assert.deepEqual(missingFiles('!pdfTeX error: pdflatex (file zplmr7m.pfb): cannot open Type 1 font file for reading'),['zplmr7m.pfb']);
 assert.deepEqual(missingFiles("! Font \\T1/foo/m/n/10=foo-tlf-t1 at 10pt not loadable: Metric (TFM) file not found."),['foo-tlf-t1.tfm']);
 assert.deepEqual(missingFiles("! LaTeX Error: File `font.enc' not found.\n! LaTeX Error: File `../../private.sty' not found."),['font.enc']);
 assert.deepEqual(optionalPackages('Class acmart Warning: You do not have the libertine package installed.\nClass acmart Warning: You do not have the newtxmath package installed.'),['libertine','newtx']);
});

test('bitmap font expansion prepares scalable fonts once without an install loop',async()=>{
 const runtime=new Runtime('/unused'),installed=[];runtime.install=async packages=>installed.push(...packages);
 const attempted=new Set(),log='pdfTeX error (font expansion): auto expansion is only possible with scalable fonts.';
 assert.equal(await runtime.resolve(log,()=>{},()=>{},attempted),true);
 assert.deepEqual(installed,['cm-super']);
 assert.equal(await runtime.resolve(log,()=>{},()=>{},attempted),false);
 assert.deepEqual(installed,['cm-super']);
});

test('download exposes measured progress before verification and rejects a bad archive',async t=>{
 const root=await mkdtemp(join(tmpdir(),'latex-progress-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const original=globalThis.fetch;t.after(()=>{globalThis.fetch=original;});
 globalThis.fetch=async()=>new Response(new Uint8Array(4096),{headers:{'content-length':'4096'}});
 const runtime=new Runtime(root),events=[];
 await assert.rejects(runtime.prepare(true,()=>{},value=>events.push(value)),/checksum mismatch/);
 assert.ok(events.some(e=>e.phase==='downloading'&&e.receivedBytes===4096&&e.totalBytes===4096));
 assert.ok(events.some(e=>e.phase==='verifying'&&e.percent===100));
 assert.equal(runtime.bin,null);assert.equal(runtime.state.phase,'error');
});

test('complex dependency chains exceed seven retries, clear incomplete BibTeX state and preserve the nested main file',async t=>{
 const root=await mkdtemp(join(tmpdir(),'latex-complex-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const paper=join(root,'paper with spaces'),bin=join(root,'bin');await mkdir(join(paper,'chapters'),{recursive:true});await mkdir(bin);
 await writeFile(join(paper,'chapters/main paper.tex'),'synthetic');
 const counter=join(root,'attempts');
 const program=`#!${process.execPath}\nconst fs=require('node:fs'),p=require('node:path');let n=0;try{n=+fs.readFileSync(${JSON.stringify(counter)},'utf8')}catch{}fs.writeFileSync(${JSON.stringify(counter)},String(++n));fs.writeFileSync(${JSON.stringify(join(root,'argv.json'))},JSON.stringify(process.argv.slice(2)));const out=process.argv.find(x=>x.startsWith('-outdir=')).slice(8);if(fs.existsSync(p.join(out,'main paper.aux'))){console.log('I found no citation commands---while reading incomplete aux file');process.exit(1)}if(n<10){fs.writeFileSync(p.join(out,'main paper.aux'),'incomplete');fs.writeFileSync(p.join(out,'main paper.fdb_latexmk'),'failed rule cache');console.log("! LaTeX Error: File 'stage"+n+".sty' not found.");process.exit(1)}fs.writeFileSync(p.join(out,'main paper.pdf'),'%PDF-1.4 synthetic');\n`;
 await writeFile(join(bin,'latexmk'),program);await chmod(join(bin,'latexmk'),0o755);await writeFile(join(bin,'synctex'),'unused');
 let resolved=0;const runtime={bin,serial:serial(),prepare:async()=>{},env:()=>({}),resolve:async(log,onLog,onProgress)=>{resolved++;assert.match(log,/stage\d+\.sty/);onProgress({phase:'installing',message:'Preparing synthetic dependency'});return true;}};
 const projects=new Projects(join(root,'state')),project=await projects.open(paper);await projects.configure(project.id,{main:'chapters/main paper.tex',online:true});
 const compiler=new Compiler(projects,{runtime});await compiler.start(project.id);const deadline=Date.now()+10000;let job;
 do{await new Promise(r=>setTimeout(r,20));job=await compiler.latest(project.id);assert.ok(Date.now()<deadline);}while(['queued','running'].includes(job.phase));
 assert.equal(job.phase,'success',job.message);assert.equal(resolved,9);assert.equal(job.progress.phase,'success');
 const args=JSON.parse(await readFile(join(root,'argv.json'),'utf8'));assert.equal(args.at(-1),'./chapters/main paper.tex');assert.ok(args.includes('-no-shell-escape'));assert.ok(!args.includes('-g'));
});

test('compile errors name the selected main, explain timeout and wrong engine',()=>{
 assert.match(buildFailure({timedOut:true},{main:'paper.tex',engine:'pdflatex'}),/timed out/);
 assert.match(buildFailure({output:'! Package fontspec Error: The fontspec package requires either XeTeX or LuaTeX.'},{main:'paper.tex',engine:'pdflatex'}),/Choose XeLaTeX or LuaLaTeX/);
 assert.match(buildFailure({output:"! LaTeX Error: File `private.sty' not found."},{main:'paper.tex',engine:'pdflatex',online:false}),/offline mode/);
});
