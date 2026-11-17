// Opt-in acceptance with the real publishers and a real compiler: fetch every upstream
// template, create a project from it and compile it. Needs network access.
//   LATEX_TEST_ROOT=/path/with/a/prepared/runtime node scripts/templates.mjs
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Studio} from '../src/service.mjs';
const root=resolve(process.env.LATEX_TEST_ROOT||await mkdtemp(join(tmpdir(),'latex-templates-')));
await mkdir(root,{recursive:true});const studio=new Studio(join(root,'state')),parent=join(root,'templates');
await rm(parent,{recursive:true,force:true});await mkdir(parent,{recursive:true});
const results=[];
for(const {id,upstream} of (await studio.dispatch({action:'templates'})).templates){
 const synced=upstream?await studio.dispatch({action:'template-sync',template:id,force:true}):null;
 if(upstream)assert.ok(synced.upstream.ready&&!synced.upstream.error,id+' template fetched');
 const project=await studio.dispatch({action:'create',parent,name:'paper-'+id,template:id});
 await studio.projects.configure(project.id,{online:true,autoCompile:false});await studio.compiler.start(project.id);
 const deadline=Date.now()+20*60*1000;let job;
 for(;;){job=await studio.compiler.latest(project.id);if(!['queued','running'].includes(job.phase))break;assert.ok(Date.now()<deadline,'Compilation timed out');await new Promise(done=>setTimeout(done,250));}
 assert.equal(job.phase,'success',id+'\n'+String(job.log).slice(-4000));
 assert.equal((await readFile(await studio.compiler.pdf(project.id,job.id))).subarray(0,4).toString(),'%PDF');
 const log=await readFile(join(studio.compiler.directory,project.id,job.id,'output','main.log'),'latin1'); // the final pass
 if(upstream){assert.match(await readFile(join(studio.compiler.directory,project.id,job.id,'output','main.bbl'),'utf8'),/Lamport/,id+' bibliography');assert.doesNotMatch(log,/There were undefined (?:references|citations)|Citation\(s\) may have changed/,id+' references resolve');}
 results.push({id,version:synced?.upstream.version||'',warnings:[...log.matchAll(/^(?:LaTeX|Package \w+|Class \w+) Warning: .*$/gm)].map(match=>match[0]).filter((line,index,all)=>all.indexOf(line)===index).slice(0,12)});
}
console.log(JSON.stringify({root,results},null,1));
