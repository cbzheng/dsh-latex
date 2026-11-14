import {mkdir,readFile,stat,rm,readdir,realpath} from 'node:fs/promises';
import {join,basename,relative,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {atomic,jsonFile,check,run,digest,redact} from './util.mjs';
import {Runtime,optionalPackages} from './runtime.mjs';

export function buildFailure(result,project){
 if(result.timedOut)return 'Compilation timed out after 3 minutes. Check the latest log output, the main .tex file and the selected engine, then retry.';
 if(result.truncated)return 'Compiler output exceeded the log limit. Check for a TeX loop or repeated errors in the document.';
 const log=result.output||'';
 let detail=(log.match(/^!\s+(?:LaTeX|Package|pdfTeX|LuaTeX|XeTeX|Font)[^\n]*/m)||log.match(/^[^\n]*\.(?:tex|sty|cls|bib|bbl):\d+:\s*(?!==>)[^\n]+/m)||log.match(/^!\s+[^\n]+/m))?.[0];
 if(detail?.startsWith('/'))detail=detail.slice(detail.lastIndexOf('/')+1);
 if(!detail)detail=log.split('\n').find(line=>/(?:not found|cannot open|not loadable|Fatal error|I couldn't open|I found no \\(?:citation|bibdata|bibstyle))/i.test(line));
 const prefix='Could not compile '+project.main+' with '+project.engine+'.';
 if(/fontspec.*(?:XeTeX|LuaTeX)|requires either XeTeX or LuaTeX|must use.*(?:xelatex|lualatex)/i.test(log))return prefix+' Choose XeLaTeX or LuaLaTeX for this document.';
 if(/font.*(?:cannot be found|not found|not loadable)/i.test(log)&&!/File .+not found/.test(log))return prefix+' '+(detail?.slice(0,400)||'A required font is unavailable.')+' Check the document fonts and engine.';
 return prefix+' '+(detail?.slice(0,400)||'Review the compilation log and confirm the main .tex file.')+(!project.online?' Missing packages cannot be installed in offline mode. Enable online dependencies and retry.':'');
}

export class Compiler{
 constructor(projects,{runtime=new Runtime(projects.directory)}={}){this.projects=projects;this.directory=join(projects.directory,'builds');this.runtime=runtime;this.jobs=new Map();this.pending=new Set();}
 async latest(id){await this.projects.get(id);return this.jobs.get(id)||await jsonFile(join(this.directory,id,'latest.json'),{phase:'idle'});}
 public(job){const {sources,output,pdf,...rest}=job;return rest;}
 async start(id){await this.projects.get(id);const current=this.jobs.get(id);if(current&&['queued','running'].includes(current.phase)){this.pending.add(id);return this.public(current);}
  const job={id:randomUUID(),projectId:id,phase:'queued',started:new Date().toISOString(),log:'',progress:{phase:'queued',message:'Waiting for the compiler…',updatedAt:new Date().toISOString()},pdfJobId:(await this.latest(id)).pdfJobId||null};this.jobs.set(id,job);
  this.runtime.serial(()=>this.execute(job)).catch(()=>{});return this.public(job);
 }
 async execute(job){
  const id=job.projectId,root=join(this.directory,id,job.id),sources=join(root,'source'),output=join(root,'output');job.sources=sources;job.output=output;job.phase='running';
  const progress=value=>{job.progress={...value,updatedAt:new Date().toISOString()};};
  const append=text=>{job.log=(job.log+redact(text)).slice(-240000);job.lastOutputAt=new Date().toISOString();};
  try{
   progress({phase:'snapshot',message:'Preparing project files…'});
   const p=await this.projects.snapshot(id,sources);Object.assign(job,{sourceDigest:p.sourceDigest,main:p.main,engine:p.engine});await mkdir(output,{recursive:true});
   await this.runtime.prepare(p.online,append,progress);const bin=this.runtime.bin;
   const required=[];for(const tool of ['latexmk','synctex'])try{await stat(join(bin,tool));}catch{required.push(tool);}if(required.length){check(p.online,'Build tools are not cached; connect to prepare them');await this.runtime.install(required,append,progress);}const latexmk=join(bin,'latexmk');
   const pdf=join(output,basename(p.main,'.tex')+'.pdf'),engine={pdflatex:'-pdf',xelatex:'-xelatex',lualatex:'-lualatex'}[p.engine];
   let result;const seen=new Set(),installed=new Set(),deadline=Date.now()+20*60*1000;for(let attempt=0;attempt<40;attempt++){
    check(Date.now()<deadline,'Dependency preparation exceeded 20 minutes. Retry to continue with the packages already installed.');
    // A failed TeX run can leave an incomplete .aux and latexmk failure cache.
    // Rebuild only the isolated output after installing dependencies; forcing
    // cached rules can otherwise run BibTeX on that incomplete .aux first.
    if(attempt){await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});}
    progress({phase:'compiling',message:'Compiling '+p.main+' ('+p.engine+')…',attempt:attempt+1});
    append('\nBuilding '+p.main+' ('+p.engine+')…\n');
    result=await run(latexmk,['-norc',engine,'-interaction=nonstopmode','-halt-on-error','-file-line-error','-synctex=1','-no-shell-escape','-outdir='+output,'./'+p.main],{cwd:sources,env:this.runtime.env({TEXMFOUTPUT:output}),timeout:180000,onData:append,maxBytes:4*1024*1024});
    if(result.code===0){if(p.online&&attempt<39&&optionalPackages(result.output).length&&await this.runtime.resolve(result.output,append,progress,installed))continue;break;}
    if(result.timedOut||result.truncated)break;const failure=digest(result.output);if(seen.has(failure)||!p.online||attempt===39)break;seen.add(failure);if(!await this.runtime.resolve(result.output,append,progress,installed))break;
   }
   check(result.code===0,buildFailure(result,p));check((await stat(pdf)).size>0,'Compiler produced no PDF');
   const completed={phase:'success',pdfJobId:job.id,pdfSha256:digest(await readFile(pdf)),pdf,progress:{phase:'success',message:'PDF ready.',percent:100,updatedAt:new Date().toISOString()}};
   await atomic(join(root,'job.json'),JSON.stringify({...this.public(job),...completed,pdf:undefined}));
   Object.assign(job,completed);
  }catch(e){job.phase='error';job.message=e.message;progress({phase:'error',message:e.message});append('\n'+e.message+'\n');}
  job.finished=new Date().toISOString();await atomic(join(this.directory,id,'latest.json'),JSON.stringify(this.public(job)));
  const keep=new Set([job.id,job.pdfJobId]);for(const name of await readdir(join(this.directory,id)).catch(()=>[])){if(/^[a-z0-9-]{36}$/.test(name)&&!keep.has(name))await rm(join(this.directory,id,name),{recursive:true,force:true});}
  if(this.pending.delete(id)){this.jobs.delete(id);await this.start(id);}
 }
 async pdf(id,jobId){const latest=await this.latest(id);const allowed=latest.pdfJobId;check(jobId===allowed&&/^[a-z0-9-]{36}$/.test(jobId||''),'PDF is no longer current',404);const meta=await jsonFile(join(this.directory,id,jobId,'job.json'),null);check(meta,'PDF unavailable',404);return join(this.directory,id,jobId,'output',basename(meta.main,'.tex')+'.pdf');}
 async sync(id,{jobId,path,line,page,x,y}){
  const pdf=await this.pdf(id,jobId);check(this.runtime.bin||await this.runtime.discover(),'Compiler unavailable');const root=join(this.directory,id,jobId),source=await realpath(join(root,'source'));
  const args=path?[ 'view','-i',`${Math.max(1,Math.floor(line||1))}:1:${await this.safeSource(id,path,source)}`,'-o',pdf]:['edit','-o',`${Math.max(1,Math.floor(page||1))}:${Number(x)||0}:${Number(y)||0}:${pdf}`];
  const result=await run(join(this.runtime.bin,'synctex'),args,{cwd:source,env:this.runtime.env(),timeout:10000});check(result.code===0,'SyncTeX unavailable for this document');
  if(path){const m=result.output.match(/Page:(\d+)[\s\S]*?x:([\d.-]+)\ny:([\d.-]+)/);return m?{page:Number(m[1]),x:Number(m[2]),y:Number(m[3])}:{};}
  const input=result.output.match(/Input:(.+)\nLine:(\d+)/);if(!input)return {};const rel=relative(source,resolve(source,input[1].trim()));await this.safeSource(id,rel,source);return {path:rel,line:Number(input[2])};
 }
 async safeSource(id,path,source){const {confined}=await import('./projects.mjs');return confined(source,path);}
}
