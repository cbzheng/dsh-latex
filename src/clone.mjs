import {mkdir,realpath,lstat,readdir} from 'node:fs/promises';
import {join,isAbsolute,delimiter} from 'node:path';
import {randomUUID} from 'node:crypto';
import {repositoryInfo} from './repository.mjs';
import {check,run,redact,serial} from './util.mjs';

const terminal=new Set(['success','error','cancelled']);
const authFailure=/authentication|could not read Username|terminal prompts disabled|permission denied \(publickey\)|repository not found/i;
const retryHint='The destination is preserved. Open it if Git completed, or choose a different folder name to retry. No existing folder is deleted.';
const stages={Enumerating:'enumerating',Counting:'counting',Compressing:'compressing',Receiving:'receiving',Resolving:'resolving',Updating:'checkout','Checking out':'checkout','Filtering content':'checkout'};

export function cloneProgress(line){
 const match=line.match(/(?:remote:\s*)?(Enumerating|Counting|Compressing|Receiving|Resolving|Updating|Checking out|Filtering content)(?: objects| deltas| files)?:\s*(\d+)%\s*(?:\((\d+)\/(\d+)\))?/i);
 if(!match)return null;
 const name=Object.keys(stages).find(key=>key.toLowerCase()===match[1].toLowerCase()),percent=Math.min(100,Number(match[2]));
 const result={phase:stages[name],message:line.trim(),percent};
 if(match[3]){result.completedObjects=Number(match[3]);result.totalObjects=Number(match[4]);}
 const bytes=line.match(/\),?\s*([\d.]+)\s*(bytes|[KMGT]iB)\b/i);
 if(bytes&&result.phase==='receiving'){const units={bytes:1,kib:1024,mib:1024**2,gib:1024**3,tib:1024**4};result.receivedBytes=Math.round(Number(bytes[1])*units[bytes[2].toLowerCase()]);}
 return result;
}

export class CloneJobs{
 constructor(projects,{runner=run,inactivityTimeout=5*60*1000,totalTimeout=60*60*1000}={}){this.projects=projects;this.runner=runner;this.inactivityTimeout=inactivityTimeout;this.totalTimeout=totalTimeout;this.jobs=new Map();this.starts=serial();}
 public(job){const {controller,done,...value}=job;return {...value,progress:{...value.progress}};}
 status(id){const job=this.jobs.get(id);check(job,'Clone job is unavailable. If the app restarted, inspect the destination folder before retrying.',404);return this.public(job);}
 start(parent,name,url){return this.starts(()=>this.startJob(parent,name,url));}
 async startJob(parent,name,url){
  check(!this.disposed,'The plugin is stopping. Reopen it before starting a clone.',409);
  const info=repositoryInfo(url);name=typeof name==='string'&&name.trim()?name.trim():info.name;
  check(/^[\p{L}\p{N} _.-]{1,80}$/u.test(name)&&!name.startsWith('.'),'Invalid project name');
  check(typeof parent==='string'&&isAbsolute(parent),'Choose a destination folder for the repository');
  const base=await realpath(parent);check((await lstat(base)).isDirectory(),'Choose a destination folder');
  check([...this.jobs.values()].filter(j=>!terminal.has(j.phase)).length<2,'Two clones are already running. Wait or cancel one.',409);
  const destination=join(base,name);try{await lstat(destination);throw Object.assign(Error('Folder already exists. Open it instead or choose another name.'),{status:409});}catch(e){if(e.code!=='ENOENT')throw e;}
  // Exclusive creation reserves this name. We never recursively remove this
  // user-visible folder, including on cancellation, failure or auth fallback.
  await mkdir(destination,{mode:0o700});
  const started=new Date().toISOString(),job={id:randomUUID(),phase:'queued',destination,started,updatedAt:started,lastOutputAt:started,log:'',progress:{phase:'queued',message:'Waiting to connect…',percent:null},controller:new AbortController()};
  this.jobs.set(job.id,job);for(const [id,old] of this.jobs){if(this.jobs.size<=30)break;if(terminal.has(old.phase))this.jobs.delete(id);}
  job.done=Promise.resolve().then(()=>this.execute(job,info));return this.public(job);
 }
 cancel(id){const job=this.jobs.get(id);check(job,'Unknown clone job',404);if(!terminal.has(job.phase)){job.controller.abort();job.progress={phase:'cancelling',message:'Cancelling Git and its child processes…',percent:null};job.updatedAt=new Date().toISOString();}return this.public(job);}
 dispose(){this.disposed=true;return this.starts(async()=>{const active=[...this.jobs.values()].filter(job=>!terminal.has(job.phase));for(const job of active)this.cancel(job.id);await Promise.allSettled(active.map(job=>job.done));});}
 async wait(id){const job=this.jobs.get(id);check(job,'Unknown clone job',404);await job.done;check(job.phase==='success',job.message||'Git clone failed');return job.project;}
 async execute(job,info){
  const progress=value=>{job.progress=value;job.updatedAt=new Date().toISOString();};
  let pending='';const line=value=>{value=redact(value);if(!value)return;job.log=(job.log+value+'\n').slice(-64000);job.lastOutputAt=new Date().toISOString();job.updatedAt=job.lastOutputAt;const update=cloneProgress(value);if(update)progress(update);};
  const append=chunk=>{pending+=chunk;const rows=pending.split(/[\r\n]+/);pending=rows.pop();for(const row of rows)line(row);if(pending.length>16384){line('[A long Git output line was omitted.]');pending='';}};
  const flush=()=>{if(pending){line(pending);pending='';}};
  // GUI apps may not inherit Homebrew's PATH. Add the standard locations only
  // for these children; preserve SSH_AUTH_SOCK and configured credential helpers.
  const env={PATH:[process.env.PATH||'/usr/bin:/bin','/opt/homebrew/bin','/usr/local/bin'].join(delimiter),GIT_TERMINAL_PROMPT:'0',GH_PROMPT_DISABLED:'1',GH_NO_UPDATE_NOTIFIER:'1',GH_DEBUG:'',GIT_TRACE:'0',GIT_TRACE_PACKET:'0',GIT_TRACE_CURL:'0',GIT_CURL_VERBOSE:'0',GIT_TRACE_REDACT:'1'};
  // Use an existing agent/key without silently waiting for an SSH password.
  // Custom SSH commands/wrappers remain authoritative; host-key checks remain.
  if(!process.env.GIT_SSH_COMMAND&&!process.env.GIT_SSH)env.GIT_SSH_COMMAND='ssh -o BatchMode=yes';
  const started=Date.now(),branch=info.branch?['--branch',info.branch]:[];
  const invoke=async(command,args)=>{check(!job.controller.signal.aborted,'Clone cancelled');const budget=this.totalTimeout-(Date.now()-started);check(budget>0,'Git clone exceeded its one-hour total budget.');const result=await this.runner(command,args,{env,timeout:budget,inactivityTimeout:this.inactivityTimeout,signal:job.controller.signal,onData:append,maxBytes:8*1024*1024});flush();return result;};
  try{
   job.phase='running';progress({phase:'connecting',message:'Connecting with your existing Git/SSH credentials. Check for a credential-helper authorization window.',percent:null});
   let result=await invoke('git',['clone','--progress',...branch,'--',info.url,job.destination]);
   if(!job.controller.signal.aborted&&!result.cancelled&&!result.timedOut&&!result.idleTimedOut&&result.code!==0&&info.githubRepo&&authFailure.test(result.output)&&!(await readdir(job.destination)).length){
    line('Git authentication was unavailable; trying the existing GitHub CLI login.');progress({phase:'connecting',message:'Trying the existing GitHub CLI login…',percent:null});
    try{result=await invoke('gh',['repo','clone',info.githubRepo,job.destination,'--','--progress',...branch]);}catch(e){if(e.code!=='ENOENT')throw e;line('GitHub CLI is unavailable in this app environment.');}
   }
   if(job.controller.signal.aborted||result.cancelled)throw Error('Clone cancelled. '+retryHint);
   if(result.idleTimedOut)throw Error('Git produced no activity for five minutes. Check the network and any credential-helper authorization window. '+retryHint);
   if(result.timedOut)throw Error('Git clone exceeded its one-hour total budget. '+retryHint);
   if(result.truncated)throw Error('Git exceeded the diagnostic output limit. Disable unusually verbose Git hooks or filters and retry. '+retryHint);
   check(result.code===0,(redact(result.output).trim().slice(-4000)||'Git clone failed.')+'\nCheck Git/SSH or gh authentication from this app environment; a desktop app may have a different PATH or SSH agent than Terminal. '+retryHint);
   progress({phase:'registering',message:'Opening the cloned project…',percent:null});
   job.project=await this.projects.open(job.destination);job.phase='success';progress({phase:'success',message:'Repository ready.',percent:100});
  }catch(e){flush();job.phase=job.controller.signal.aborted?'cancelled':'error';job.message=redact(e.message||'Git clone failed.');job.folderPreserved=true;job.retryHint=retryHint;progress({phase:job.phase,message:job.message,percent:null});}
  job.finished=new Date().toISOString();job.updatedAt=job.finished;
 }
}
