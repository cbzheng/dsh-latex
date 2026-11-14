import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {check,run} from './util.mjs';
import {relativePath,confined} from './projects.mjs';
import {repositoryInfo,visibleRemote,sameRepository} from './repository.mjs';
export function parseStatus(raw){const tokens=raw.split('\0'),files=[];for(let i=0;i<tokens.length;i++){const row=tokens[i];if(!row)continue;const status=row.slice(0,2),path=row.slice(3),oldPath=/[RC]/.test(status)?tokens[++i]:undefined;files.push({status,path,oldPath,conflict:['DD','AU','UD','UA','DU','AA','UU'].includes(status)});}return files;}
export class Git{
 constructor(projects){this.projects=projects;}
 async command(id,args,{allowError=false,timeout=30000}={}){const p=await this.projects.get(id);const result=await run('git',['--no-pager','-c','core.quotepath=false',...args],{cwd:p.root,env:{GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0'},timeout});check(allowError||result.code===0,result.output||'Git operation failed',409);return result;}
 async status(id){const probe=await this.command(id,['rev-parse','--show-toplevel'],{allowError:true});if(probe.code!==0)return {repository:false,files:[],history:[],remote:null};const p=await this.projects.get(id);check(probe.output.trim()===p.root,'Open the repository root folder to manage Git',409);const raw=await this.command(id,['status','--porcelain=v1','-z']);const branch=await this.command(id,['branch','--show-current']);const log=await this.command(id,['log','-12','--format=%H%x00%s%x00%aI%x00'],{allowError:true});const fields=log.code===0?log.output.replace(/\n/g,'').split('\0'):[],history=[];for(let i=0;i+2<fields.length;i+=3)history.push({id:fields[i],message:fields[i+1],date:fields[i+2]});const upstream=await this.command(id,['rev-list','--left-right','--count','HEAD...@{upstream}'],{allowError:true});const origin=await this.command(id,['remote','get-url','origin'],{allowError:true});return {repository:true,remote:origin.code===0?visibleRemote(origin.output.trim()):null,branch:branch.output.trim(),files:parseStatus(raw.output),history,upstream:upstream.code===0?upstream.output.trim():null};}
 async diff(id,path){relativePath(path);const value=await this.command(id,['diff','--no-ext-diff','--no-textconv','HEAD','--',path],{allowError:true});if(value.code===0&&value.output)return {diff:value.output};const p=await this.projects.get(id);try{const file=await confined(p.root,path);if((await stat(file)).size>2*1024*1024)return {diff:'Binary or large file'};const text=await readFile(file,'utf8');return {diff:'+++ '+path+'\n'+text.split('\n').map(l=>'+'+l).join('\n')};}catch{return {diff:''};}}
 async mutate(id,action,args={}){return this.projects.lock(id,async()=>{
  if(action==='init'){const p=await this.projects.get(id);const status=await this.status(id);check(!status.repository,'Already a Git repository');await this.command(id,['init','-b','main']);return this.status(id);}
  const status=await this.status(id);check(status.repository,'This folder is not a Git repository');check(!status.files.some(f=>f.conflict),'Resolve existing conflicts with your Agent first',409);
  if(action==='connect'){const info=repositoryInfo(args.url);if(status.remote){check(sameRepository(status.remote,info.url),'This project already has a different origin. Its existing remote was preserved.',409);return status;}await this.command(id,['remote','add','origin',info.url]);return this.status(id);}
  if(action==='commit'){
   const {paths,message}=args;check(Array.isArray(paths)&&paths.length>0&&paths.length<=500,'Choose files to commit');check(typeof message==='string'&&message.trim()&&message.length<=4000,'Enter a commit message');
   for(const path of paths){relativePath(path);check(status.files.some(f=>f.path===path),'File is not changed: '+path);}
   await this.command(id,['add','--',...paths]);
   await this.command(id,['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','commit','--only','-m',message,'--',...paths]);
  }else if(action==='pull'){check(status.files.length===0,'Save and commit your changes before pulling',409);await this.command(id,['-c','core.hooksPath=/dev/null','pull','--ff-only','--no-rebase'],{timeout:120000});}
  else if(action==='push'){check(status.remote||status.upstream,'Connect a repository before pushing',409);check(status.branch,'Switch to a branch before pushing',409);await this.command(id,status.upstream?['push']:['push','--set-upstream','origin',status.branch],{timeout:120000});}
  else throw Object.assign(Error('Unknown Git action'),{status:400});
  return this.status(id);
 });}
}
