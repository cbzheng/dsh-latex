import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {Projects} from './projects.mjs';
import {Compiler} from './compiler.mjs';
import {Git} from './git.mjs';
import {outlineProject} from './outline.mjs';
import {repositoryInfo} from './repository.mjs';
import {check,redact} from './util.mjs';
import {completionIndex} from './completion.mjs';
import {Templates} from './templates.mjs';
import {projectContext,readRange,search,diagnostics,proposeEdit,removeCreated} from './assist.mjs';

export class Studio{
 constructor(directory,{fetch}={}){this.projects=new Projects(directory);this.templates=new Templates(join(directory,'templates'),{fetch});this.compiler=new Compiler(this.projects);this.git=new Git(this.projects);}
 async dispatch(args,{user=true}={}){
  const {action,projectId}=args;check(typeof action==='string','Action required');
  if(action==='repo-info'){check(user,'Only the user can import repositories',403);return repositoryInfo(args.url);}
  if(action==='projects')return {...await this.projects.list(),runtime:await this.compiler.runtime.status()};
  if(action==='open'){check(user,'Only the user can register project folders',403);return this.projects.open(args.path);}
  if(action==='folders'){check(user,'Only the user can browse host folders',403);return this.projects.folder(args.path);}
  if(action==='templates')return this.templates.list();
  if(action==='template-sync'){check(user,'Only the user can update templates',403);return this.templates.sync(args.template,{force:args.force===true});}
  if(action==='create'){check(user,'Only the user can create projects',403);return this.projects.create(args.parent,args.name,await this.templates.blueprint(args.template||'article'));}
  if(action==='clone'){check(user,'Only the user can create projects',403);return this.projects.clone(args.parent,args.name,args.url);}
  if(action==='clone-start'){check(user,'Only the user can import repositories',403);return this.projects.clones.start(args.parent,args.name,args.url);}
  if(action==='clone-job'){check(user,'Only the user can inspect clone jobs',403);return this.projects.clones.status(args.id);}
  if(action==='clone-cancel'){check(user,'Only the user can cancel clone jobs',403);return this.projects.clones.cancel(args.id);}
  if(action==='outline')return outlineProject(this.projects,projectId,{sources:args.sources||{}});
  if(action==='index')return completionIndex(this.projects,projectId,{sources:args.sources||{}});
  if(action==='tree')return this.projects.tree(projectId);
  if(action==='read')return args.fromLine!==undefined||args.toLine!==undefined?readRange(this.projects,projectId,args.path,args.fromLine,args.toLine):this.projects.read(projectId,args.path);
  if(action==='context')return projectContext(this.projects,projectId);
  if(action==='search')return search(this.projects,projectId,args.query,{sources:args.sources||{},path:args.path});
  if(action==='errors')return diagnostics(await this.compiler.latest(projectId));
  if(action==='propose-edit')return proposeEdit(this.projects,args);
  if(action==='remove-created'){check(user,'Only the user interface can remove files',403);return removeCreated(this.projects,projectId,args.path,args.revision);}
  if(action==='write'){check(user,'Use a proposal for AI edits',403);return this.projects.write(projectId,args.path,args.text,args.baseRevision);}
  if(action==='upload'){check(user,'Only the user can upload files',403);return this.projects.upload(projectId,args.path,args.base64);}
  if(action==='configure'){check(user,'Only the user can change project settings',403);return this.projects.configure(projectId,args.changes||{});}
  if(action==='propose')return this.projects.propose(args);
  if(action==='proposals')return this.projects.proposals(projectId);
  if(action==='decide'){check(user,'Only the user can accept or reject a proposal',403);return this.projects.decide(projectId,args.id,args.accept===true);}
  if(action==='compile')return this.compiler.start(projectId);
  if(action==='job')return this.compiler.public(await this.compiler.latest(projectId));
  if(action==='sync')return this.compiler.sync(projectId,args);
  if(action==='git-status')return this.git.status(projectId);
  if(action==='git-diff')return this.git.diff(projectId,args.path);
  if(action==='git'){check(user,'Git mutations require a user action',403);return this.git.mutate(projectId,args.operation,args);}
  throw Object.assign(Error('Unknown action'),{status:400});
 }
}

const types={js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8',html:'text/html; charset=utf-8',bcmap:'application/octet-stream',ttf:'font/ttf',otf:'font/otf',wasm:'application/wasm',pfb:'application/octet-stream'};
export function createHandler(studio,{authorize=async()=>true,assets=new URL('../assets/',import.meta.url),prefix='/dsh-latex'}={}){
 return async(req,res)=>{
  if(!await authorize(req,res))return;
  const url=new URL(req.url,'http://localhost'),path=url.pathname.slice(prefix.length);
  const json=(status,value)=>res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(value));
  try{
   if(path==='/api'){
    check(req.method==='POST','POST required',405);check(req.headers['x-dsh-latex']==='1'&&req.headers['content-type']?.startsWith('application/json'),'Same-origin JSON request required',403);
    check(!['cross-site','same-site'].includes(req.headers['sec-fetch-site']),'Cross-origin request refused',403);
    if(req.headers.origin){const origin=new URL(req.headers.origin);const hosts=[req.headers.host,req.headers['x-forwarded-host']].filter(Boolean);check(hosts.includes(origin.host),'Origin mismatch',403);}
    let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;check(size<=24*1024*1024,'Request too large',413);chunks.push(chunk);}
    const args=JSON.parse(Buffer.concat(chunks).toString('utf8'));check(args&&typeof args==='object'&&!Array.isArray(args),'Invalid request');json(200,await studio.dispatch(args));return;
   }
   check(['GET','HEAD'].includes(req.method),'Method not allowed',405);
   if(path==='/pdf'){
    const file=await studio.compiler.pdf(url.searchParams.get('projectId'),url.searchParams.get('jobId'));const bytes=await readFile(file);res.writeHead(200,{'Content-Type':'application/pdf','Content-Length':bytes.length,'Cache-Control':'no-store','Content-Disposition':'inline; filename="paper.pdf"','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);return;
   }
   check(path.startsWith('/assets/'),'Not found',404);const name=path.slice(8);check(/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..'),'Invalid asset',404);
   const file=new URL(name,assets);check(file.href.startsWith(assets.href),'Invalid asset',404);const bytes=await readFile(file);const mime=types[name.split('.').at(-1)]||'application/octet-stream';res.writeHead(200,{'Content-Type':mime,'Content-Length':bytes.length,'Cache-Control':'private, max-age=3600','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:bytes);
  }catch(e){json(e.status||400,{message:redact(e.code==='ENOENT'?'File or folder is unavailable':e.message||'Operation failed')});}
 };
}
