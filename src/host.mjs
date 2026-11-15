import {join} from 'node:path';
import {homedir} from 'node:os';
import {Studio,createHandler} from './service.mjs';

export const name='latex-studio';
export const inject=['webServer','connection'];
export async function apply(ctx,config={}){
 const profile=ctx.get('profileContext')?.dir||process.env.DSH_HOME||join(homedir(),'.dsh');
 const directory=config.dataDirectory||process.env.LATEX_STUDIO_DATA||join(profile,'latex-studio');
 const studio=new Studio(directory);await studio.projects.ready;
 ctx.effect(()=>()=>studio.projects.clones.dispose());
 ctx.effect(()=>ctx.webServer.register({kind:'prefix',path:'/dsh-latex',handler:createHandler(studio,{assets:new URL('./assets/',import.meta.url),authorize:(req,res)=>ctx.connection.authorizeIndex(req,res)})}));
 ctx.inject(['tools'],sub=>{
  sub.tools.register({name:'latex_studio',description:'Read registered LaTeX projects, inspect files/Git, compile and propose source edits. Never write source directly; the owner accepts or rejects proposals in LaTeX Studio. Save context: start with context (cached project digest and brief), use outline/search, then read with fromLine/toLine instead of whole files. For edits prefer propose-edit with edits [{find,text}] or [{fromLine,toLine,expected,text}] and the file baseRevision; propose replaces a whole file. errors summarizes the latest build log. Project registration and Git mutations are user-only. Actions: projects, context, tree, outline, read, search, errors, propose-edit, propose, proposals, compile, job, git-status, git-diff.',
   parameters:{type:'object',required:['action'],additionalProperties:false,properties:{action:{type:'string',enum:['projects','context','tree','outline','read','search','errors','propose-edit','propose','proposals','compile','job','git-status','git-diff']},projectId:{type:'string'},path:{type:'string'},text:{type:'string'},baseRevision:{oneOf:[{type:'string'},{type:'null'}]},summary:{type:'string'},fromLine:{type:'integer',minimum:1},toLine:{type:'integer',minimum:1},query:{type:'string',maxLength:200},edits:{type:'array',maxItems:50,items:{type:'object',additionalProperties:false,properties:{find:{type:'string'},fromLine:{type:'integer',minimum:1},toLine:{type:'integer',minimum:0},expected:{type:'string'},text:{type:'string'}},required:['text']}}}},
   output:{schema:{type:'string'},render:(_args,value)=>[{type:'text',text:value}]},
   async execute(args){return JSON.stringify(await studio.dispatch(args,{user:false}));}
  });
 });
 // Next Space verifies In-place AI edits by reading the saved file back on the Host.
 // Older Next Space releases do not know the readback kind; register without it there.
 const nativeView={version:1,id:'latex-studio',upstream:{package:'@cbzheng/dsh-latex',version:'0.5.4'},capabilities:['read-projects','latex_studio','review-ai-changes','local-git','managed-tex','in-place-ai'],data:[{label:'Registered LaTeX folders',service:'LaTeX Studio',uri:'dsh://latex-studio/projects'}],read:async()=>studio.projects.list()};
 const assistance={version:1,kind:'readback',revision:async locator=>(await studio.projects.read(locator?.projectId,locator?.path)).revision};
 ctx.inject(['spaceData'],sub=>sub.effect(()=>{try{return sub.spaceData.registerNative({...nativeView,assistance});}catch{return sub.spaceData.registerNative(nativeView);}}));
}
