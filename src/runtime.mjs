import {mkdir,readdir,readFile,rm,rename,stat} from 'node:fs/promises';
import {join,delimiter} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable,Transform} from 'node:stream';
import {createWriteStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {atomic,jsonFile,check,run,serial} from './util.mjs';

export const RELEASE='v2026.11';
export const ARCHIVES={
 darwin:{file:'TinyTeX-1-darwin-v2026.11.tar.xz',sha256:'9416a257c4caea2f82351fa2f89252b8bd75dceeb0ce6e442d25530b1922a02d'},
 'linux-x64':{file:'TinyTeX-1-linux-x86_64-v2026.11.tar.xz',sha256:'5b75befa848deae702ae6fa12ff0eef3f110d7e4e2a979ae99f101eba3c9c70d'},
 'linux-arm64':{file:'TinyTeX-1-linux-arm64-v2026.11.tar.xz',sha256:'b351c365e4085a179c8d76fddadff612d4e4fd16a946953fb8b9d331f4f7344a'}
};
const mirror='https://mirror.ctan.org/systems/texlive/tlnet';
const mirrors=[mirror,'https://ctan.math.illinois.edu/systems/texlive/tlnet','https://mirrors.mit.edu/CTAN/systems/texlive/tlnet'];
export function archiveFor(platform=process.platform,arch=process.arch){const info=ARCHIVES[platform==='darwin'?'darwin':platform+'-'+arch];check(info,'This release supports macOS and Linux hosts');return info;}
export function missingFiles(log){
 const names=new Set(),add=name=>{if(/^[\w./+-]{1,160}$/.test(name)&&!name.includes('..'))names.add(name.split('/').at(-1));};
 for(const match of log.matchAll(/(?:File\s+[`'"]([^`'"\n]+\.(?:sty|cls|def|fd|bst|tex|tfm|otf|ttf|pfb|enc|map|vf|mf))[`'"]\s+not found|I can't find file\s+[`'"]([^`'"\n]+)[`'"]|\(file ([^()\n]+\.(?:pfb|ttf|otf|enc|map|tfm|vf))\)\s*:\s*(?:cannot open|not found))/g))add(match[1]||match[2]||match[3]);
 for(const match of log.matchAll(/Font\s+[^\n=]*=([^\s]+)(?:\s+at\s+[^\n]+)?\s+not loadable:\s*Metric \(TFM\) file not found/g))add(match[1]+'.tfm');
 return [...names];
}
export function searchPackages(output){const names=[];for(const line of output.split('\n')){const match=line.match(/^([a-z0-9][a-z0-9-]{0,80}):\s*$/);if(match&&!match[1].includes('.'))names.push(match[1]);}return [...new Set(names)];}
export function optionalPackages(log){
 const known={libertine:'libertine',newtxmath:'newtx',inconsolata:'inconsolata',zi4:'inconsolata'},packages=new Set();
 for(const match of log.matchAll(/Class acmart Warning:\s*You do not have the\s+([a-z0-9-]+)\s+package installed/gi))if(known[match[1]])packages.add(known[match[1]]);
 return [...packages];
}
export class Runtime{
 constructor(directory){this.directory=directory;this.root=join(directory,'runtime',RELEASE);this.serial=serial();this.state={phase:'unprepared',release:RELEASE};this.bin=null;}
 async discover(){try{const info=await jsonFile(join(this.root,'runtime.json'),null);if(!info||info.release!==RELEASE)return false;const bin=join(this.root,info.bin);await stat(join(bin,'pdflatex'));this.bin=bin;this.state={phase:'ready',release:RELEASE};return true;}catch{return false;}}
 async status(){if(!this.bin&&this.state.phase==='unprepared')await this.discover();return {...this.state,platform:process.platform,arch:process.arch};}
 env(extra={}){check(this.bin,'Compiler is not prepared',409);return {PATH:this.bin+delimiter+(process.env.PATH||'/usr/bin:/bin'),openin_any:'p',openout_any:'p',shell_escape:'f',...extra};}
 async prepare(online=true,onLog=()=>{},onProgress=()=>{}){
  if(this.bin||await this.discover())return;
  check(online,'Compiler is not cached. Connect once to prepare it.',409);const info=archiveFor();this.state={phase:'downloading',release:RELEASE};
  const progress=value=>{this.state={...this.state,...value};onProgress(value);};
  progress({phase:'downloading',message:'Downloading the private TeX compiler…',receivedBytes:0,totalBytes:null,percent:null});
  const temp=this.root+'.preparing-'+randomUUID();await mkdir(temp,{recursive:true,mode:0o700});const archive=join(temp,'runtime.tar.xz');
  try{
   const perl=await run('/usr/bin/perl',['-MFile::Find','-e','1']);check(perl.code===0,'The host Perl runtime is unavailable');
   onLog('Preparing TinyTeX '+RELEASE+'…\n');const response=await fetch('https://github.com/rstudio/tinytex-releases/releases/download/'+RELEASE+'/'+info.file,{signal:AbortSignal.timeout(240000)});check(response.ok&&response.body,'Cannot download TinyTeX');
   const declared=Number(response.headers.get('content-length'));const totalBytes=Number.isFinite(declared)&&declared>0?declared:null;
   let size=0,lastUpdate=0;const hash=createHash('sha256');const limit=new Transform({transform(chunk,encoding,callback){size+=chunk.length;if(size>240*1024*1024)return callback(Error('Runtime archive is too large'));hash.update(chunk);if(Date.now()-lastUpdate>=1000){lastUpdate=Date.now();progress({phase:'downloading',message:'Downloading the private TeX compiler…',receivedBytes:size,totalBytes,percent:totalBytes?Math.min(99,Math.floor(size/totalBytes*100)):null});}callback(null,chunk);}});
   await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(archive,{mode:0o600}));progress({phase:'verifying',message:'Verifying compiler download…',receivedBytes:size,totalBytes:size,percent:100});check(hash.digest('hex')===info.sha256,'TinyTeX checksum mismatch. Retry the download.');
   progress({phase:'extracting',message:'Extracting the private TeX compiler…',percent:null});const listing=await run('tar',['-tJf',archive]);check(listing.code===0,'Cannot read compiler archive');check(listing.output.split('\n').every(name=>!name.startsWith('/')&&!name.split('/').includes('..')),'Unsafe runtime archive');
   const unpack=join(temp,'unpacked');await mkdir(unpack);const extracted=await run('tar',['-xJf',archive,'-C',unpack],{timeout:120000});check(extracted.code===0,'Cannot extract compiler');
   const roots=await readdir(unpack);const folder=roots.find(x=>/tinytex/i.test(x));check(folder,'Compiler layout is unrecognized');const texRoot=join(unpack,folder);const bins=await readdir(join(texRoot,'bin'));const bin=bins.find(x=>process.platform==='darwin'?x.includes('darwin'):x.endsWith('-linux'));check(bin,'Compiler does not match this host');
   await atomic(join(texRoot,'runtime.json'),JSON.stringify({release:RELEASE,archive:info.file,sha256:info.sha256,bin:'bin/'+bin}));await mkdir(join(this.directory,'runtime'),{recursive:true});await rename(texRoot,this.root);this.bin=join(this.root,'bin',bin);
   this.state={phase:'ready',release:RELEASE};onProgress({phase:'ready',message:'Compiler ready.',percent:100});onLog('Compiler ready.\n');
  }catch(e){if(e.name==='TimeoutError'||e.name==='AbortError')e=Error('Compiler download timed out. Check the network and retry; no partial compiler was activated.');this.state={phase:'error',release:RELEASE,message:e.message};throw e;}finally{await rm(temp,{recursive:true,force:true});}
 }
 async install(packages,onLog=()=>{},onProgress=()=>{}){
  check(packages.length<=15&&packages.every(p=>/^[a-z0-9][a-z0-9-]{0,80}$/.test(p)),'Invalid TeX package');if(!packages.length)return;
  onLog('Installing TeX packages: '+packages.join(', ')+'\n');
  onProgress({phase:'installing',message:'Installing TeX dependencies: '+packages.join(', '),package:packages.join(', '),percent:null});
  let result=await this.repositoryRun(['install',...packages],240000,onLog);
  if(result.code!==0&&/update.*--self|self update|tlmgr itself/i.test(result.output)){
   const update=await this.repositoryRun(['update','--self'],180000,onLog);check(update.code===0,'TeX package manager update failed:\n'+update.output);result=await this.repositoryRun(['install',...packages],240000,onLog);
  }
  check(result.code===0,'Cannot prepare TeX dependencies. Check network and retry.');
 }
 async repositoryRun(args,timeout,onLog=()=>{}){let result;for(const repository of [...new Set([this.repository,...mirrors].filter(Boolean))]){result=await run(join(this.bin,'tlmgr'),['--repository',repository,...args],{env:this.env(),timeout,onData:onLog});if(result.code===0){this.repository=repository;return result;}if(!result.timedOut&&!/signature|download|fetch|connection|timed out|not load|404|500|502|503/i.test(result.output))break;onLog('TeX mirror is temporarily unavailable; trying another signed mirror.\n');}return result;}
 async resolve(log,onLog=()=>{},onProgress=()=>{},attempted=new Set()){
  const packages=new Set(optionalPackages(log));if(/biber(?:[\s'":]|$).*(?:not found|not recognized|No such file)|(?:not found|No such file).*biber/i.test(log))packages.add('biber');
  if(/auto expansion is only possible with scalable fonts|(?:pdfTeX error|mktexpk)[\s\S]*Font\s+(?:ec|tc)[a-z0-9]+\s+at\s+\d+\s+not found/i.test(log))packages.add('cm-super');
  if(/Fandol\w*-?(?:Regular|Bold|Italic)|fandol/i.test(log)&&/(?:not found|cannot be found|not loadable)/i.test(log))packages.add('fandol');
  for(const name of missingFiles(log)){
   onProgress({phase:'resolving',message:'Finding the TeX package for '+name,package:name,percent:null});onLog('Finding package for '+name+'…\n');
   const result=await this.repositoryRun(['search','--global','--file','/'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$'],120000,onLog);const matches=searchPackages(result.output);if(matches[0])packages.add(matches[0]);
  }
  const fresh=[...packages].filter(name=>!attempted.has(name));if(!fresh.length)return false;
  await this.install(fresh,onLog,onProgress);for(const name of fresh)attempted.add(name);return true;
 }
}
