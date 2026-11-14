import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,access} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Projects} from '../src/projects.mjs';
import {CloneJobs,cloneProgress} from '../src/clone.mjs';
import {run,redact} from '../src/util.mjs';
import {Studio} from '../src/service.mjs';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function fixture(t){const root=await mkdtemp(join(tmpdir(),'latex-clone-'));t.after(()=>rm(root,{recursive:true,force:true}));return {root,projects:new Projects(join(root,'state'))};}
const result=(output='',code=0)=>({code,output,timedOut:false,idleTimedOut:false,cancelled:false,truncated:false});

test('Git progress reports actual stages, object counts and transferred bytes',()=>{
 assert.deepEqual(cloneProgress('Receiving objects:  42% (42/100), 1.50 MiB | 300 KiB/s'),{phase:'receiving',message:'Receiving objects:  42% (42/100), 1.50 MiB | 300 KiB/s',percent:42,completedObjects:42,totalObjects:100,receivedBytes:1572864});
 assert.equal(cloneProgress('remote: Counting objects: 100% (8/8), done.').phase,'counting');
 assert.equal(cloneProgress('Resolving deltas: 15% (3/20)').percent,15);
 assert.equal(cloneProgress('Updating files: 80% (8/10)').phase,'checkout');
 assert.equal(cloneProgress("Cloning into 'paper'..."),null);
});

test('background clone exposes live progress, reuses host auth environment and registers only after completion',async t=>{
 const {root,projects}=await fixture(t);let release,options,argv,called=false;const gate=new Promise(r=>{release=r;});
 const jobs=new CloneJobs(projects,{runner:async(command,args,value)=>{called=true;assert.equal(command,'git');argv=args;options=value;value.onData('Receiving objects: 42% (42/100), 1.50 MiB | 300 KiB/s\r');await gate;await writeFile(join(args.at(-1),'main.tex'),'\\documentclass{article}');return result();}});
 const job=await jobs.start(root,'paper','https://github.com/synthetic/paper/tree/main');
 assert.equal(job.phase,'queued');assert.equal(job.project,undefined);await sleep(0);assert.equal(called,true);
 const running=jobs.status(job.id);assert.equal(running.phase,'running');assert.equal(running.progress.percent,42);assert.equal(running.progress.receivedBytes,1572864);assert.match(running.log,/Receiving objects/);
 assert.equal(argv[1],'--progress');assert.ok(argv.includes('--branch'));assert.ok(options.timeout>3599000&&options.timeout<=3600000);assert.equal(options.inactivityTimeout,300000);assert.equal(options.env.GIT_TERMINAL_PROMPT,'0');assert.match(options.env.PATH,/\/opt\/homebrew\/bin/);assert.ok(!('SSH_AUTH_SOCK' in options.env),'Existing SSH agent is inherited, not replaced');assert.ok(!('GIT_ASKPASS' in options.env),'Existing GUI helpers are inherited');
 release();const p=await jobs.wait(job.id);assert.equal(p.main,'main.tex');assert.equal(jobs.status(job.id).phase,'success');assert.equal(jobs.status(job.id).project.id,p.id);
});

test('clone logs redact credentials even when a credential line arrives in separate chunks',async t=>{
 const {root,projects}=await fixture(t);
 const jobs=new CloneJobs(projects,{runner:async(command,args,{onData})=>{onData('fatal: https://private');onData('token@example.invalid/repo?token=hidden\nAuthorization: Bearer hidden-auth\nghp_synthetic');onData('secret\n');return result('Authentication failed',128);}});
 const job=await jobs.start(root,'paper','https://example.invalid/paper.git');await assert.rejects(jobs.wait(job.id));const status=jobs.status(job.id);
 assert.doesNotMatch(status.log,/privatetoken|hidden-auth|syntheticsecret|token=hidden/);assert.match(status.log,/redacted/);assert.equal(status.folderPreserved,true);assert.match(status.retryHint,/different folder name/);
 assert.doesNotMatch(redact('Authorization: Basic secret\nhttps://token@host/repo?access_token=secret'),/secret/);
});

test('existing destinations including dangling symlinks are never reused or deleted',async t=>{
 const {root,projects}=await fixture(t);await mkdir(join(root,'existing'));await writeFile(join(root,'existing','note'),'keep');await symlink(join(root,'absent'),join(root,'linked'));
 const jobs=new CloneJobs(projects,{runner:async()=>assert.fail('Git must not run')});
 for(const name of ['existing','linked'])await assert.rejects(jobs.start(root,name,'synthetic/paper'),{status:409});
 assert.equal(await readFile(join(root,'existing','note'),'utf8'),'keep');assert.equal(jobs.jobs.size,0);
});

test('cancellation preserves any files added to the new destination and never registers a partial clone',async t=>{
 const {root,projects}=await fixture(t);let entered;const ready=new Promise(r=>{entered=r;});
 const jobs=new CloneJobs(projects,{runner:async(command,args,{signal})=>{await writeFile(join(args.at(-1),'owner-note'),'preserve');entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {...result(),cancelled:true};}});
 const job=await jobs.start(root,'paper','synthetic/paper');await ready;jobs.cancel(job.id);await assert.rejects(jobs.wait(job.id),/cancelled/i);
 assert.equal(jobs.status(job.id).phase,'cancelled');assert.equal(await readFile(join(root,'paper','owner-note'),'utf8'),'preserve');assert.equal((await projects.list()).projects.length,0);
 await assert.rejects(jobs.start(root,'paper','synthetic/paper'),{status:409});
});

test('GitHub auth fallback uses progress but refuses to reuse a nonempty destination',async t=>{
 const {root,projects}=await fixture(t);let calls=0;
 const jobs=new CloneJobs(projects,{runner:async(command,args)=>{calls++;if(command==='git')return result('Authentication failed',128);assert.equal(command,'gh');assert.ok(args.includes('--progress'));await writeFile(join(args[3],'main.tex'),'\\documentclass{article}');return result();}});
 const job=await jobs.start(root,'fallback','synthetic/paper');assert.equal((await jobs.wait(job.id)).main,'main.tex');assert.equal(calls,2);
 const blocked=new CloneJobs(projects,{runner:async(command,args)=>{assert.equal(command,'git');await writeFile(join(args.at(-1),'keep'),'user data');return result('Authentication failed',128);}});
 const failure=await blocked.start(root,'nonempty','synthetic/paper');await assert.rejects(blocked.wait(failure.id),/Authentication failed/);assert.equal(await readFile(join(root,'nonempty','keep'),'utf8'),'user data');
});

test('real Git clones a synthetic branch through an inherited URL rewrite and reports forced progress',async t=>{
 const {root,projects}=await fixture(t),source=join(root,'source'),remote=join(root,'remote.git');await mkdir(source);
 for(const args of [['init','-b','main'],['add','main.tex'],['-c','user.name=Synthetic','-c','user.email=test@example.invalid','commit','-m','Synthetic branch']]){
  if(args[0]==='add')await writeFile(join(source,'main.tex'),'\\documentclass{article}\n\\begin{document}Synthetic\\end{document}');
  const value=await run('git',args,{cwd:source});assert.equal(value.code,0,value.output);
 }
 const bare=await run('git',['clone','--bare',source,remote]);assert.equal(bare.code,0,bare.output);
 const url='https://github.com/synthetic/transport.git';
 const jobs=new CloneJobs(projects,{runner:(command,args,options)=>run(command,args,{...options,env:{...options.env,GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'url.file://'+remote+'.insteadOf',GIT_CONFIG_VALUE_0:url}})});
 const job=await jobs.start(root,'cloned','https://github.com/synthetic/transport/tree/main');const project=await jobs.wait(job.id);
 assert.match(await readFile(join(project.root,'main.tex'),'utf8'),/Synthetic/);assert.match(jobs.status(job.id).log,/Receiving objects:\s*100%/);assert.equal(jobs.status(job.id).phase,'success');
});

test('process runner keeps active transfers alive, times out inactivity, and distinguishes total budget',async()=>{
 const active=await run(process.execPath,['-e',"let n=0;const t=setInterval(()=>{console.log(++n);if(n===8){clearInterval(t);}},150)"],{timeout:5000,inactivityTimeout:1000});assert.equal(active.code,0);assert.equal(active.idleTimedOut,false);
 const idle=await run(process.execPath,['-e','setInterval(()=>{},1000)'],{timeout:5000,inactivityTimeout:600});assert.equal(idle.idleTimedOut,true);assert.equal(idle.timedOut,false);
 const budget=await run(process.execPath,['-e','setInterval(()=>console.log("active"),80)'],{timeout:800,inactivityTimeout:1000});assert.equal(budget.timedOut,true);assert.equal(budget.idleTimedOut,false);
});

test('plugin disposal cancels running clones, preserves terminal jobs and refuses later starts',async t=>{
 const {root,projects}=await fixture(t);let entered;const ready=new Promise(r=>{entered=r;});
 const jobs=new CloneJobs(projects,{runner:async(command,args,{signal})=>{if(args.at(-1).endsWith('complete')){await writeFile(join(args.at(-1),'main.tex'),'\\documentclass{article}');return result();}entered();await new Promise(r=>signal.addEventListener('abort',r,{once:true}));return {...result(),cancelled:true};}});
 const complete=await jobs.start(root,'complete','synthetic/paper');await jobs.wait(complete.id);const finished=jobs.status(complete.id).finished;
 const running=await jobs.start(root,'active','synthetic/paper');await ready;await jobs.dispose();
 assert.equal(jobs.status(running.id).phase,'cancelled');assert.equal(jobs.status(complete.id).phase,'success');assert.equal(jobs.status(complete.id).finished,finished);
 await assert.rejects(jobs.start(root,'later','synthetic/paper'),/stopping/);
});

test('cancellation kills the whole Git-like process group, including a child helper',async t=>{
 if(process.platform==='win32'){t.skip('POSIX process groups');return;}
 const {root}=await fixture(t),marker=join(root,'orphan-marker'),controller=new AbortController();t.after(()=>controller.abort());
 const child="setTimeout(()=>require('node:fs').writeFileSync("+JSON.stringify(marker)+",'orphan'),400);setInterval(()=>{},1000)";
 const program="require('node:child_process').spawn(process.execPath,['-e',"+JSON.stringify(child)+"],{stdio:'ignore'});console.log('ready');setInterval(()=>{},1000)";
 const stopped=await run(process.execPath,['-e',program],{timeout:3000,signal:controller.signal,onData:chunk=>{if(chunk.includes('ready'))controller.abort();}});
 assert.equal(stopped.cancelled,true);assert.equal(stopped.timedOut,false);await sleep(650);await assert.rejects(access(marker),{code:'ENOENT'});
 const preaborted=await run(process.execPath,['-e',"process.exit(99)"],{signal:controller.signal});assert.equal(preaborted.cancelled,true);assert.equal(preaborted.code,1);
});

test('clone jobs cannot be started, inspected or cancelled by agent-only tool calls',async t=>{
 const {root}=await fixture(t),studio=new Studio(join(root,'service-state'));
 for(const action of ['clone-start','clone-job','clone-cancel'])await assert.rejects(studio.dispatch({action,id:'missing',parent:root,url:'synthetic/paper'},{user:false}),{status:403});
});
