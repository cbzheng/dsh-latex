import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const stage=resolve(process.env.LATEX_BUILD_DIR||'dist','package');
const temporary=await mkdtemp(join(tmpdir(),'latex-package-'));
try{
 const host=await import(pathToFileURL(join(stage,'host.mjs')));
 const routes=[],tools=[],adapters=[];
 const ctx={
  get:()=>({dir:temporary}),effect:callback=>callback(),
  webServer:{register:route=>{routes.push(route);return()=>{};}},
  connection:{authorizeIndex:async()=>true},
  tools:{register:tool=>tools.push(tool)},
  spaceData:{registerNative:adapter=>adapters.push(adapter)},
  inject(_services,callback){callback(this);}
 };
 await host.apply(ctx);
 assert.equal(routes[0].path,'/dsh-latex');
 assert.equal(tools[0].name,'latex_studio');
 const result=await tools[0].execute({action:'projects'});
 assert.deepEqual(JSON.parse(result).projects,[]);
 assert.deepEqual(tools[0].output.render({},result),[{type:'text',text:result}]);
 assert.equal(adapters[0].id,'latex-studio');
 const metadata=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
 assert.equal(Object.keys(metadata.dependencies||{}).length,0);
 assert.equal(metadata.dsh.client.platform,'web');
 console.log('Packaged host, tool, native adapter and client manifest passed.');
}finally{await rm(temporary,{recursive:true,force:true});}
