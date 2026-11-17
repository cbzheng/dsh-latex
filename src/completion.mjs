import {readFile,stat} from 'node:fs/promises';
import {check} from './util.mjs';
import {confined,relativePath} from './projects.mjs';
import {scanTex,parseBib} from './texscan.mjs';

const MAX_FILE=2*1024*1024,MAX_TOTAL=12*1024*1024,MAX_FILES=600,MAX_LABELS=5000,MAX_CITATIONS=10000,MAX_COMMANDS=2000;
// What the editor completes from: labels, bibliography entries and the project's own
// commands, read from every .tex/.sty/.bib file. Open editor drafts override the disk.
export async function completionIndex(projects,projectId,{sources={}}={}){
 const project=await projects.get(projectId),files=await projects.treeAt(project.root);
 check(sources&&typeof sources==='object'&&!Array.isArray(sources)&&Object.keys(sources).length<=8,'Invalid draft sources');
 for(const [path,text] of Object.entries(sources)){relativePath(path);check(typeof text==='string'&&text.length<=MAX_FILE,'Draft source too large');}
 const index={labels:[],citations:[],commands:[],environments:[],packages:[],classes:[],graphicsPaths:[],truncated:false};
 const seen={commands:new Set(),environments:new Set(),packages:new Set(),classes:new Set(),graphicsPaths:new Set(),citations:new Set()};
 const add=(kind,value,key=value)=>{if(seen[kind].has(key))return;seen[kind].add(key);index[kind].push(value);};
 let total=0,count=0;
 for(const file of files){
  const kind=/\.tex$/i.test(file.path)?'tex':/\.bib$/i.test(file.path)?'bib':/\.sty$/i.test(file.path)?'sty':null;if(!kind)continue;
  if(++count>MAX_FILES){index.truncated=true;break;}
  let text=sources[file.path];
  if(text===undefined){const full=await confined(project.root,file.path);const size=(await stat(full)).size;if(size>MAX_FILE){index.truncated=true;continue;}text=await readFile(full,'utf8');}
  total+=text.length;if(total>MAX_TOTAL){index.truncated=true;break;}
  if(kind==='bib'){for(const entry of parseBib(text,{maxEntries:MAX_CITATIONS-index.citations.length}))add('citations',{...entry,path:file.path},entry.key);continue;}
  const scan=scanTex(text,{maxLabels:MAX_LABELS-index.labels.length});
  for(const command of scan.commands)if(index.commands.length<MAX_COMMANDS)add('commands',{name:command.name,args:command.args,...(command.optional?{optional:true}:{}),...(command.redefined?{redefined:true}:{}),path:file.path},command.name);
  for(const name of scan.environments)add('environments',name);
  if(kind==='sty')continue;
  for(const label of scan.labels)index.labels.push({...label,path:file.path});
  for(const item of scan.bibitems)add('citations',{key:item.key,type:'bibitem',title:'',author:'',authors:'',year:'',venue:'',line:item.line,path:file.path},item.key);
  for(const name of scan.packages)add('packages',name);
  for(const name of scan.classes)add('classes',name);
  for(const name of scan.graphicsPaths)add('graphicsPaths',name);
 }
 if(index.labels.length>=MAX_LABELS||index.citations.length>=MAX_CITATIONS)index.truncated=true;
 return index;
}
