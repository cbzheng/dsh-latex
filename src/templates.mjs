import {mkdir,readFile,writeFile,rm,readdir,lstat} from 'node:fs/promises';
import {join,basename} from 'node:path';
import {inflateRawSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {atomic,jsonFile,digest,check,serial,run} from './util.mjs';
import {SKELETONS} from './template-files.mjs';

// LAYOUT changes whenever the set of extracted files does, so older caches are fetched again.
const LAYOUT=2,MAX_ARCHIVE=8*1024*1024,MAX_FILE=2*1024*1024,MAX_FILES=40,STALE=24*60*60*1000;
const tlnet=['https://mirror.ctan.org/systems/texlive/tlnet','https://ctan.math.illinois.edu/systems/texlive/tlnet','https://mirrors.mit.edu/CTAN/systems/texlive/tlnet'];
// Publisher files are never shipped with the plugin or kept in its Git history: they are
// fetched from the publisher's own distribution, cached in private plugin state and copied
// into a new project. pick maps an archive member to its place in the project (or null).
export const TEMPLATES={
 article:{name:'Article',skeleton:'article'},
 acm:{name:'ACM',skeleton:'acm',upstream:{
  label:'acmart',origin:'CTAN',format:'tar.xz',urls:tlnet.map(base=>base+'/archive/acmart.tar.xz'),
  // The class and the BibTeX style only: the skeleton uses BibTeX, and the biblatex styles would crowd the project root.
  pick:name=>({'tex/latex/acmart/acmart.cls':'acmart.cls','bibtex/bst/acmart/ACM-Reference-Format.bst':'ACM-Reference-Format.bst'})[name]||null,
  required:['acmart.cls','ACM-Reference-Format.bst'],
  version:files=>{const match=/\\ProvidesClass\{acmart\}\s*\[\s*(\d{4}\/\d{2}\/\d{2})\s+v([\d.]+)/.exec(files.get('acmart.cls').toString('latin1'));check(match,'Unexpected acmart class file',502);return match[2];}
 }},
 nature:{name:'Nature',skeleton:'nature',upstream:{
  label:'sn-jnl',origin:'Springer Nature',format:'zip',urls:['https://resource-cms.springernature.com/springer-cms/rest/v1/content/18782940/data'],
  pick:name=>{const file=basename(name);if(file==='sn-jnl.cls')return 'sn-jnl.cls';if(!/(?:^|\/)bst\/[\w.-]+\.bst$/.test(name))return null;return file==='sn-nature.bst'?file:'bst/'+file;},
  required:['sn-jnl.cls','sn-nature.bst'],
  version:(files,response)=>{check(/\\ProvidesClass\{sn-jnl\}/.test(files.get('sn-jnl.cls').toString('latin1')),'Unexpected sn-jnl class file',502);return /\(([^()]{3,40}?)\s+version\)/i.exec(decodeURIComponent((response.headers.get('content-disposition')||'').replace(/\+/g,' ')))?.[1]||'';}
 }}
};
// Central-directory reader for the few members we want; stored and deflated entries only.
export function unzip(buffer,pick){
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}
 check(end>=0,'Template archive is not a zip file',502);
 const count=buffer.readUInt16LE(end+10),files=new Map();let at=buffer.readUInt32LE(end+16);
 for(let n=0;n<count;n++){
  check(at+46<=buffer.length&&buffer.readUInt32LE(at)===0x02014b50,'Damaged template archive',502);
  const method=buffer.readUInt16LE(at+10),packed=buffer.readUInt32LE(at+20),size=buffer.readUInt32LE(at+24),nameLength=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),local=buffer.readUInt32LE(at+42);
  const name=buffer.toString('utf8',at+46,at+46+nameLength);at+=46+nameLength+extra+comment;
  const target=pick(name);if(!target)continue;
  check(size<=MAX_FILE&&files.size<MAX_FILES,'Template file too large',502);check(local+30<=buffer.length&&buffer.readUInt32LE(local)===0x04034b50,'Damaged template archive',502);
  const start=local+30+buffer.readUInt16LE(local+26)+buffer.readUInt16LE(local+28),raw=buffer.subarray(start,start+packed);check(raw.length===packed,'Damaged template archive',502);
  const data=method===0?Buffer.from(raw):method===8?inflateRawSync(raw,{maxOutputLength:MAX_FILE}):null;check(data&&data.length===size,'Unsupported template archive',502);
  files.set(target,data);
 }
 return files;
}
async function untar(buffer,pick,scratch){
 const archive=join(scratch,'archive.tar.xz'),out=join(scratch,'unpacked');await mkdir(out,{recursive:true,mode:0o700});await writeFile(archive,buffer,{mode:0o600});
 const listing=await run('tar',['-tJf',archive],{timeout:60000});check(listing.code===0,'Cannot read template archive',502);
 const names=listing.output.split('\n').map(name=>name.trim()).filter(Boolean);check(names.every(name=>!name.startsWith('/')&&!name.split('/').includes('..')),'Unsafe template archive',502);
 const wanted=names.filter(name=>pick(name));check(wanted.length<=MAX_FILES,'Template archive has too many files',502);if(!wanted.length)return new Map();
 const extracted=await run('tar',['-xJf',archive,'-C',out,...wanted],{timeout:60000});check(extracted.code===0,'Cannot extract template archive',502);
 const files=new Map();
 for(const name of wanted){const full=join(out,name),info=await lstat(full);check(info.isFile()&&info.size<=MAX_FILE,'Unexpected template file',502);files.set(pick(name),await readFile(full));}
 return files;
}
async function body(response){
 check(Number(response.headers.get('content-length')||0)<=MAX_ARCHIVE,'Template archive too large',502);
 const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;check(size<=MAX_ARCHIVE,'Template archive too large',502);chunks.push(chunk);}
 return Buffer.concat(chunks);
}
export class Templates{
 constructor(directory,{fetch=globalThis.fetch,now=()=>Date.now()}={}){this.directory=directory;this.file=join(directory,'templates.json');this.fetch=fetch;this.now=now;this.queue=serial();this.running=new Map();}
 async state(){const value=await jsonFile(this.file,{version:1,templates:{}});check(value.version===1&&value.templates&&typeof value.templates==='object','Invalid template cache');for(const id of Object.keys(value.templates))if(value.templates[id]?.layout!==LAYOUT)delete value.templates[id];return value;}
 describe(id,entry){
  const spec=TEMPLATES[id],upstream=spec.upstream;
  return {id,name:spec.name,...(upstream?{upstream:{label:upstream.label,origin:upstream.origin,ready:Boolean(entry?.directory),version:entry?.version||'',fetched:entry?.fetched||'',checked:entry?.checked||'',stale:!entry?.checked||this.now()-Date.parse(entry.checked)>STALE,...(entry?.error?{error:entry.error}:{})}}:{})};
 }
 async list(){const state=await this.state();return {templates:Object.keys(TEMPLATES).map(id=>this.describe(id,state.templates[id]))};}
 // Fetch the publisher's current files. Unchanged archives only refresh the check time;
 // a failed check keeps the cached copy usable.
 async sync(id,{force=false}={}){
  check(typeof id==='string'&&Object.hasOwn(TEMPLATES,id),'Unknown template',404);const upstream=TEMPLATES[id].upstream;
  if(!upstream)return this.list().then(value=>value.templates.find(item=>item.id===id));
  if(!this.running.has(id))this.running.set(id,this.queue(()=>this.refresh(id,upstream,force)).finally(()=>this.running.delete(id)));
  return this.running.get(id);
 }
 async refresh(id,upstream,force){
  const state=await this.state(),previous=state.templates[id],checked=new Date(this.now()).toISOString();
  if(previous?.directory&&!force&&this.now()-Date.parse(previous.checked||0)<=STALE)return this.describe(id,previous);
  const save=async entry=>{const next=await this.state();next.templates[id]=entry;await atomic(this.file,JSON.stringify(next,null,2));return this.describe(id,entry);};
  let failure;
  for(const url of upstream.urls){
   try{
    const response=await this.fetch(url,{redirect:'follow',signal:AbortSignal.timeout(90000),headers:previous?.directory&&previous.etag&&previous.url===url?{'If-None-Match':previous.etag}:{}});
    if(response.status===304&&previous?.directory)return save({...previous,checked,error:undefined});
    check(response.ok,'Template source answered '+response.status,502);check(!response.url||response.url.startsWith('https://'),'Template source must use HTTPS',502);
    const archive=await body(response),sha256=digest(archive);
    if(previous?.directory&&previous.sha256===sha256)return save({...previous,checked,etag:response.headers.get('etag')||'',url,error:undefined});
    const scratch=join(this.directory,'.fetch-'+randomUUID());await mkdir(scratch,{recursive:true,mode:0o700});
    try{
     const files=upstream.format==='zip'?unzip(archive,upstream.pick):await untar(archive,upstream.pick,scratch);
     for(const name of upstream.required)check(files.get(name)?.length>0,'Template source lacks '+name,502);
     const version=upstream.version(files,response)||checked.slice(0,10),directory=id+'-'+sha256.slice(0,16),target=join(this.directory,directory);
     await rm(target,{recursive:true,force:true});
     for(const [name,data] of files){await mkdir(join(target,name,'..'),{recursive:true,mode:0o700});await writeFile(join(target,name),data,{mode:0o600});}
     const entry=await save({layout:LAYOUT,version,sha256,etag:response.headers.get('etag')||'',url,fetched:checked,checked,directory,files:[...files.keys()].sort()});
     for(const name of await readdir(this.directory))if(name.startsWith(id+'-')&&name!==directory)await rm(join(this.directory,name),{recursive:true,force:true});
     return entry;
    }finally{await rm(scratch,{recursive:true,force:true});}
   }catch(error){failure=error;}
  }
  const message=failure?.name==='TimeoutError'?'Template source timed out':failure?.status===502?failure.message:'Template source is unreachable';
  if(previous?.directory)return save({...previous,error:message});
  throw Object.assign(Error(message+'. Connect to the network to fetch the '+TEMPLATES[id].name+' template.'),{status:502});
 }
 // Everything a new project needs: skeleton text plus the cached publisher files.
 async blueprint(id='article'){
  check(typeof id==='string'&&Object.hasOwn(TEMPLATES,id),'Unknown template',404);
  const spec=TEMPLATES[id],skeleton=SKELETONS[spec.skeleton]({title:'Paper Title',year:new Date(this.now()).getUTCFullYear()});
  if(!spec.upstream)return skeleton;
  let entry=(await this.state()).templates[id];
  if(!entry?.directory){await this.sync(id);entry=(await this.state()).templates[id];}
  check(entry?.directory,'Template files are unavailable',502);
  const files=[...skeleton.files];
  for(const name of entry.files){const data=await readFile(join(this.directory,entry.directory,name));check(digest(data).length===64&&data.length<=MAX_FILE,'Template cache is damaged',500);files.push({path:name,data});}
  return {...skeleton,files,template:{id,version:entry.version}};
 }
}
