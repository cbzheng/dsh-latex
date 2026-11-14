// Bounded, read-mostly helpers shared by the latex_studio Agent tool and Next Space In-place AI.
// The goal is small, stable context: line ranges instead of whole files and a project digest
// whose revision only changes when the project's structure or brief changes.
import {readFile,stat,unlink} from 'node:fs/promises';
import {confined,relativePath} from './projects.mjs';
import {digest,check} from './util.mjs';

export const BRIEF_CHARS=8000;
const LINES=400,MATCHES=100;
const uncomment=line=>{let slashes=0;for(let i=0;i<line.length;i++){if(line[i]==='%'&&slashes%2===0)return line.slice(0,i);slashes=line[i]==='\\'?slashes+1:0;}return line;};

export function numbered(text,from=1,to=from+LINES-1){
 const lines=text.split('\n'),first=Math.max(1,Math.trunc(from)||1),last=Math.min(lines.length,Math.trunc(to)||lines.length,first+LINES-1);
 return {fromLine:first,toLine:last,lineCount:lines.length,text:lines.slice(first-1,last).map((l,i)=>first+i+'| '+l).join('\n')};
}

// Stable per-project digest used as the standing (cacheable) context.
export async function projectContext(projects,id){
 const p=await projects.get(id),files=await projects.treeAt(p.root),tex=files.filter(f=>/\.(tex|sty|cls)$/i.test(f.path)).slice(0,200);
 const packages=new Set(),macros=new Map(),bib=new Set();
 for(const f of tex){
  let source;try{const full=await confined(p.root,f.path);if((await stat(full)).size>512*1024)continue;source=(await readFile(full,'utf8')).split(/\r?\n/).map(uncomment).join('\n');}catch{continue;}
  for(const m of source.matchAll(/\\usepackage\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))for(const name of m[1].split(','))if(name.trim())packages.add(name.trim());
  for(const m of source.matchAll(/\\(?:re)?newcommand\*?\s*\{?\\([A-Za-z@]+)\}?\s*(?:\[(\d)\])?/g))if(macros.size<80)macros.set(m[1],m[2]?'#'+m[2]:'');
  for(const m of source.matchAll(/\\(?:bibliography|addbibresource)\s*(?:\[[^\]]*\])?\s*\{([^}]+)\}/g))for(const name of m[1].split(','))bib.add(name.trim());
 }
 const text=[
  p.brief?'Project brief (written by the owner):\n'+p.brief:'',
  'Project: '+p.title+'. Main file: '+p.main+'. Engine: '+p.engine+'.',
  'Files ('+files.length+'): '+files.filter(f=>f.text).slice(0,200).map(f=>f.path).join(', ')+(files.length>200?', …':''),
  packages.size?'Packages: '+[...packages].sort().join(', '):'',
  macros.size?'Macros: '+[...macros].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>'\\'+k+v).join(' '):'',
  bib.size?'Bibliography: '+[...bib].sort().join(', '):''
 ].filter(Boolean).join('\n').slice(0,24000);
 return {key:'latex-studio:'+id,revision:digest(text).slice(0,32),text};
}

export async function readRange(projects,id,path,from,to){const file=await projects.read(id,path);return {path,revision:file.revision,...numbered(file.text,from,to)};}

// Literal, case-insensitive search across text sources; live editor drafts override disk.
export async function search(projects,id,query,{sources={},path}={}){
 check(typeof query==='string'&&query.trim().length>0&&query.length<=200,'Search text required');
 const p=await projects.get(id),needle=query.toLowerCase(),matches=[];
 const files=path?[{path:relativePath(path),text:true}]:(await projects.treeAt(p.root)).filter(f=>f.text);
 for(const f of files){
  if(matches.length>=MATCHES)break;
  let text=typeof sources[f.path]==='string'?sources[f.path]:null;
  if(text===null){try{text=(await projects.read(id,f.path)).text;}catch{continue;}}
  text.split('\n').forEach((line,i)=>{if(matches.length<MATCHES&&line.toLowerCase().includes(needle))matches.push({path:f.path,line:i+1,text:line.slice(0,300)});});
 }
 return {query,matches,truncated:matches.length>=MATCHES};
}

// Compact TeX diagnostics from the latest build log.
export function diagnostics(job){
 const log=job?.log||'',errors=[];let warnings=0;const lines=log.split('\n');
 for(let i=0;i<lines.length&&errors.length<30;i++){
  const line=lines[i];
  const fileLine=line.match(/^(.*?\.(?:tex|sty|cls|bib|bbl)):(\d+):\s*(.+)$/);
  if(fileLine){errors.push({path:fileLine[1].replace(/^\.\//,''),line:Number(fileLine[2]),message:fileLine[3].slice(0,300)});continue;}
  if(/^!\s/.test(line)){const at=lines.slice(i+1,i+8).map(l=>l.match(/^l\.(\d+)/)).find(Boolean);errors.push({message:line.slice(2,302),...(at?{line:Number(at[1])}:{})});}
  if(/Warning:/.test(line))warnings++;
 }
 return {phase:job?.phase||'idle',message:job?.message,errors,warnings};
}

// Local edits are converted into the existing whole-file proposal format; the owner still decides.
export async function proposeEdit(projects,{projectId,path,baseRevision,summary,edits}){
 check(Array.isArray(edits)&&edits.length>0&&edits.length<=50,'One to fifty edits required');
 const file=await projects.read(projectId,path);check(file.revision===baseRevision,'Proposal base changed',409);
 let text=file.text;
 for(const edit of edits){
  check(edit&&typeof edit==='object'&&typeof edit.text==='string','Each edit needs text');
  if(typeof edit.find==='string'){
   check(edit.find.length>0,'find must not be empty');const at=text.indexOf(edit.find);check(at>=0,'Text to replace was not found: '+edit.find.slice(0,80),409);
   check(text.indexOf(edit.find,at+1)<0,'Text to replace is ambiguous; include more surrounding text',409);
   text=text.slice(0,at)+edit.text+text.slice(at+edit.find.length);
  }else{
   const lines=text.split('\n'),from=edit.fromLine,to=edit.toLine??from;
   check(Number.isInteger(from)&&Number.isInteger(to)&&from>=1&&to>=from-1&&to<=lines.length,'Invalid line range');
   if(typeof edit.expected==='string')check(lines.slice(from-1,to).join('\n')===edit.expected,'Those lines changed; read them again',409);
   lines.splice(from-1,to-from+1,...edit.text.split('\n'));text=lines.join('\n');
  }
 }
 return projects.propose({projectId,path,text,baseRevision,summary});
}

// Undo of an In-place AI "create file": only an unchanged file created by that action is removed.
export async function removeCreated(projects,id,path,revision){
 return projects.lock(id,async()=>{
  const p=await projects.get(id),file=await confined(p.root,path),current=await projects.read(id,path);
  check(current.revision===revision,'The file changed after it was created; it was kept',409);
  await unlink(file);return {path,removed:true};
 });
}
