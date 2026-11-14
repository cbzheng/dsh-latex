import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,mkdir,writeFile,rename,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';

export const digest = value => createHash('sha256').update(value).digest('hex');
export const check = (ok,message,status=400) => {if(!ok)throw Object.assign(Error(message),{status});};
export async function jsonFile(file,fallback){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw e;}}
export async function atomic(file,data,mode=0o600){
 await mkdir(dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+randomUUID()+'.tmp';
 try{await writeFile(temp,data,{mode});await rename(temp,file);}finally{await unlink(temp).catch(()=>{});}
}
export function serial(){let tail=Promise.resolve();return fn=>{const p=tail.then(fn,fn);tail=p.catch(()=>{});return p;};}
export function redact(value){return String(value).replace(/(https?:\/\/)[^\s/@]+@/g,'$1[redacted]@').replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g,'[redacted]').replace(/((?:proxy-)?authorization\s*:\s*)[^\r\n]+/gi,'$1[redacted]').replace(/([?&](?:access_token|token|password|client_secret)=)[^&#\s]+/gi,'$1[redacted]');}
export function run(command,args,{cwd,env,timeout=120000,inactivityTimeout=0,maxBytes=2*1024*1024,onData,signal}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){resolve({code:1,output:'',timedOut:false,idleTimedOut:false,cancelled:true,truncated:false});return;}
  const child=spawn(command,args,{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let output='',bytes=0,timedOut=false,idleTimedOut=false,cancelled=false,settled=false,idleTimer;
  const stop=()=>{try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
  const timer=timeout>0?setTimeout(()=>{timedOut=true;stop();},timeout):null;
  const active=()=>{clearTimeout(idleTimer);if(inactivityTimeout>0)idleTimer=setTimeout(()=>{idleTimedOut=true;stop();},inactivityTimeout);};
  const abort=()=>{cancelled=true;stop();};signal?.addEventListener('abort',abort,{once:true});active();
  const cleanup=()=>{clearTimeout(timer);clearTimeout(idleTimer);signal?.removeEventListener('abort',abort);};
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{active();bytes+=chunk.length;if(bytes<=maxBytes){output+=chunk.toString();onData?.(chunk.toString());}else stop();});
  child.on('error',e=>{if(settled)return;settled=true;cleanup();reject(e);});
  child.on('close',(code)=>{if(settled)return;settled=true;cleanup();resolve({code:code??1,output:redact(output),timedOut,idleTimedOut,cancelled,truncated:bytes>maxBytes});});
 });
}
