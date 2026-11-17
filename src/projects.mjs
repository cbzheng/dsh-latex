import {readFile,readdir,realpath,lstat,mkdir,writeFile,rm,stat,access} from 'node:fs/promises';
import {join,resolve,relative,sep,isAbsolute,dirname,basename} from 'node:path';
import {homedir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {atomic,jsonFile,digest,check,serial,run} from './util.mjs';
import {CloneJobs} from './clone.mjs';
import {SKELETONS} from './template-files.mjs';

export const ENGINES=['pdflatex','xelatex','lualatex'];
export const TEXT=/(?:\.(tex|bib|sty|cls|bst|txt|md|json|ya?ml|csv|tsv)|\.gitignore|\.gitattributes)$/i;
const internal=part=>part.startsWith('.')&&!['.gitignore','.gitattributes'].includes(part)||['node_modules','__MACOSX'].includes(part);
const transient=/\.(aux|log|toc|out|fls|fdb_latexmk|synctex(?:\.gz)?|bcf|run\.xml|blg)$/i;
export function relativePath(value){
 check(typeof value==='string'&&value.length>0&&value.length<1024&&!value.includes('\0')&&!value.includes('\\')&&!isAbsolute(value),'Invalid relative file path');
 check(value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!internal(p)),'Internal or unsafe file path');return value;
}
export async function confined(root,name,{create=false}={}){
 relativePath(name);root=await realpath(root);const full=join(root,name),parent=await realpath(dirname(full));
 check(parent===root||parent.startsWith(root+sep),'Path escapes project',403);
 try{const st=await lstat(full);check(!st.isSymbolicLink(),'Symbolic links are read-only',403);const canonical=await realpath(full);check(canonical.startsWith(root+sep),'Path escapes project',403);}
 catch(e){if(e.code!=='ENOENT'||!create)throw e;}
 return full;
}
export class Projects{
 constructor(directory){this.directory=directory;this.file=join(directory,'projects.json');this.queue=serial();this.locks=new Map();this.clones=new CloneJobs(this);this.ready=jsonFile(this.file,{version:1,projects:[]}).then(v=>{check(v.version===1&&Array.isArray(v.projects),'Invalid project registry');this.value=v;});}
 lock(id,fn){if(!this.locks.has(id))this.locks.set(id,serial());return this.locks.get(id)(fn);}
 async list(){await this.ready;return {projects:this.value.projects.map(p=>({...p}))};}
 async get(id){await this.ready;const p=this.value.projects.find(p=>p.id===id);check(p,'Unknown project',404);check(await realpath(p.root)===p.root,'Project folder moved',409);return p;}
 async saveRegistry(){await atomic(this.file,JSON.stringify(this.value,null,2));}
 async open(path,{template}={}){return this.queue(async()=>{
  await this.ready;check(typeof path==='string'&&isAbsolute(path),'Choose an absolute folder');const root=await realpath(path);check((await stat(root)).isDirectory(),'Choose a folder');
  let p=this.value.projects.find(p=>p.root===root);if(p)return {...p};
  check(this.value.projects.length<100,'Project limit reached');
  p={id:randomUUID(),root,title:basename(root),main:'main.tex',engine:'pdflatex',online:true,compileInterval:5};
  p.mainCandidates=await this.mainCandidatesAt(root,await this.treeAt(root));
  p.main=p.mainCandidates[0]||'main.tex';
  try{const source=await readFile(join(root,p.main),'utf8');const magic=source.match(/^%\s*!TEX\s+program\s*=\s*(pdflatex|xelatex|lualatex)/im);if(magic)p.engine=magic[1];else if(/\\(?:usepackage(?:\[[^\]]*\])?\{(?:fontspec|xeCJK)\}|documentclass(?:\[[^\]]*\])?\{ctex)/.test(source))p.engine='xelatex';}catch{}
  if(template)p.template={id:template.id,version:template.version};
  this.value.projects.push(p);await this.saveRegistry();return {...p};
 });}
 async configure(id,changes){return this.queue(async()=>{const p=await this.get(id),next={...p};if(changes.main!==undefined){relativePath(changes.main);check(/\.tex$/i.test(changes.main),'Main file must be .tex');const file=await confined(p.root,changes.main);check((await stat(file)).isFile(),'Main file must be a regular .tex file');next.main=changes.main;}if(changes.engine!==undefined){check(ENGINES.includes(changes.engine),'Unknown engine');next.engine=changes.engine;}if(changes.brief!==undefined){check(typeof changes.brief==='string'&&changes.brief.length<=8000,'Project brief is limited to 8000 characters');if(changes.brief.trim())next.brief=changes.brief;else delete next.brief;}for(const key of ['online','autoCompile'])if(changes[key]!==undefined){check(typeof changes[key]==='boolean','Invalid setting');next[key]=changes[key];}if(changes.compileInterval!==undefined){check(Number.isInteger(changes.compileInterval)&&changes.compileInterval>=0&&changes.compileInterval<=120,'Build interval must be 0–120 minutes');next.compileInterval=changes.compileInterval;}if(!('brief' in next))delete p.brief;Object.assign(p,next);await this.saveRegistry();return {...p};});}
 async mainCandidatesAt(root,files){
  const tex=files.filter(f=>/\.tex$/i.test(f.path));
  const score=path=>path.split('/').length*10+(/^(?:main|paper|manuscript|root|index)\.tex$/i.test(basename(path))?-30:0)+(/(?:^|\/)(?:templates?|samples?|examples?)(?:\/|[-_.])/i.test(path)?100:0);
  tex.sort((a,b)=>score(a.path)-score(b.path)||a.path.localeCompare(b.path));
  const roots=[],hinted=new Map(),names=new Set(tex.map(f=>f.path));
  for(const file of tex.slice(0,500)){
   const full=await confined(root,file.path);if((await stat(full)).size>2*1024*1024)continue;
   const source=await readFile(full,'utf8');
   for(const match of source.matchAll(/^\s*%\s*!TEX\s+root\s*=\s*(.*?)\s*$/gim)){
    const target=relative(root,resolve(root,dirname(file.path),match[1].replace(/^['"]|['"]$/g,''))).split(sep).join('/');
    if(names.has(target))hinted.set(target,(hinted.get(target)||0)+1);
   }
   const uncommented=source.split(/\r?\n/).map(line=>{let slashes=0;for(let i=0;i<line.length;i++){if(line[i]==='%'&&slashes%2===0)return line.slice(0,i);slashes=line[i]==='\\'?slashes+1:0;}return line;}).join('\n');
   if(/\\document(?:class|style)\s*(?:\[[\s\S]*?\]\s*)?\{/.test(uncommented))roots.push(file.path);
  }
  const candidates=roots.length?roots:tex.map(f=>f.path);
  return candidates.sort((a,b)=>(hinted.get(b)||0)-(hinted.get(a)||0)||score(a)-score(b)||a.localeCompare(b));
 }
 async treeAt(root){const result=[];const walk=async(dir,prefix='')=>{const entries=await readdir(dir,{withFileTypes:true});for(const e of entries.sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory())||a.name.localeCompare(b.name))){if(internal(e.name)||e.isSymbolicLink())continue;const path=prefix+e.name;if(e.isDirectory())await walk(join(dir,e.name),path+'/');else if(e.isFile()&&!transient.test(e.name)){result.push({path,text:TEXT.test(path)});check(result.length<=5000,'Project has too many files');}}};await walk(root);return result;}
 async tree(id){const p=await this.get(id),files=await this.treeAt(p.root),mainCandidates=await this.mainCandidatesAt(p.root,files);p.mainCandidates=mainCandidates;return {files,mainCandidates,project:{...p}};}
 async read(id,path){const p=await this.get(id);check(TEXT.test(path),'This file is not a text document');const file=await confined(p.root,path);check((await stat(file)).size<=2*1024*1024,'File too large');const text=await readFile(file,'utf8');return {path,text,revision:digest(text)};}
 async write(id,path,text,baseRevision){return this.lock(id,async()=>{
  const p=await this.get(id);check(TEXT.test(path),'This file is not editable');check(typeof text==='string'&&Buffer.byteLength(text)<=2*1024*1024,'Text too large');
  const file=await confined(p.root,path,{create:baseRevision===null});let old=null,mode=0o644;try{old=await readFile(file);mode=(await stat(file)).mode&0o777;}catch(e){if(e.code!=='ENOENT')throw e;}
  check((old===null?null:digest(old))===baseRevision,'File changed outside this editor. Review your draft before saving.',409);
  await atomic(file,text,mode);const saved=await this.read(id,path);check(saved.text===text,'Save readback differs',409);return saved;
 });}
 async upload(id,path,base64){return this.lock(id,async()=>{const p=await this.get(id);check(typeof base64==='string','Invalid upload');const file=await confined(p.root,path,{create:true});try{await access(file);throw Object.assign(Error('File already exists'),{status:409});}catch(e){if(e.code!=='ENOENT')throw e;}const bytes=Buffer.from(base64,'base64');check(bytes.length<=16*1024*1024,'Upload too large');await writeFile(file,bytes,{flag:'wx',mode:0o644});return {path,revision:digest(await readFile(file))};});}
 async folder(path=homedir()){
  check(typeof path==='string'&&isAbsolute(path),'Invalid folder');const root=await realpath(path);const entries=await readdir(root,{withFileTypes:true});return {path:root,parent:dirname(root),folders:entries.filter(e=>e.isDirectory()&&!internal(e.name)).slice(0,250).map(e=>({name:e.name,path:join(root,e.name)}))};
 }
 // blueprint: {files:[{path,text|data}],template?} from src/templates.mjs.
 async create(parent,name,blueprint=SKELETONS.article()){
  check(/^[\p{L}\p{N} _.-]{1,80}$/u.test(name)&&!name.startsWith('.'),'Invalid project name');const base=await realpath(parent),root=join(base,name);await mkdir(root,{mode:0o700});
  /* A failure leaves the new folder in place for recovery. */
  for(const file of blueprint.files){relativePath(file.path.replace(/\/\.gitkeep$/,'/keep'));/* placeholder keeps an empty folder in Git */const target=join(root,file.path);await mkdir(dirname(target),{recursive:true,mode:0o700});await writeFile(target,file.data??file.text,{flag:'wx',mode:0o644});}
  const result=await run('git',['init','-b','main'],{cwd:root});check(result.code===0,'Git is unavailable');
  return this.open(root,{template:blueprint.template});
 }
 async clone(parent,name,url){
  const job=await this.clones.start(parent,name,url);return this.clones.wait(job.id);
 }
 async propose({projectId,path,text,baseRevision,summary}){await this.get(projectId);check(typeof summary==='string'&&summary.length>0&&summary.length<=1000,'A change summary is required');check(typeof text==='string'&&Buffer.byteLength(text)<=2*1024*1024,'Proposal too large');let before;try{before=await this.read(projectId,path);}catch(e){if(e.code!=='ENOENT')throw e;before={text:'',revision:null};}check(before.revision===baseRevision,'Proposal base changed',409);const id=randomUUID(),record={id,projectId,path,text,baseRevision,summary,before:before.text,created:new Date().toISOString(),status:'pending'};await atomic(join(this.directory,'proposals',id+'.json'),JSON.stringify(record));return record;}
 async proposals(projectId){const root=join(this.directory,'proposals');await mkdir(root,{recursive:true,mode:0o700});const rows=[];for(const name of await readdir(root)){if(!/^[\w-]+\.json$/.test(name))continue;const row=await jsonFile(join(root,name),null);if(row?.projectId===projectId&&row.status==='pending')rows.push(row);}return {proposals:rows.sort((a,b)=>a.created.localeCompare(b.created))};}
 async decide(projectId,id,accept){check(/^[a-z0-9-]{36}$/.test(id),'Invalid proposal');return this.queue(async()=>{const file=join(this.directory,'proposals',id+'.json'),p=await jsonFile(file,null);check(p&&p.projectId===projectId,'Unknown proposal',404);check(p.status==='pending','Proposal already decided',409);let saved;if(accept)saved=await this.write(projectId,p.path,p.text,p.baseRevision);p.status=accept?'accepted':'rejected';await atomic(file,JSON.stringify(p));return {id,status:p.status,saved};});}
 async snapshot(id,target){const project={...await this.get(id)},files=await this.treeAt(project.root);let total=0;const hashes=[];await mkdir(target,{recursive:true,mode:0o700});for(const f of files){const full=await confined(project.root,f.path);const st=await stat(full);total+=st.size;check(total<=100*1024*1024,'Project snapshot exceeds 100 MiB');const bytes=await readFile(full);await mkdir(dirname(join(target,f.path)),{recursive:true});await writeFile(join(target,f.path),bytes);hashes.push(f.path+'\0'+digest(bytes));}return {...project,sourceDigest:digest(hashes.join('\n')),fileCount:files.length};}
}
