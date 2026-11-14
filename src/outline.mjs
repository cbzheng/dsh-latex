import {posix} from 'node:path';
import {check} from './util.mjs';

const levels={part:0,chapter:1,section:2,subsection:3,subsubsection:4,paragraph:5};
const literalEnvironments=new Set(['verbatim','verbatim*','Verbatim','BVerbatim','LVerbatim','SaveVerbatim','lstlisting','minted','comment','filecontents','filecontents*']);
const MAX_FILE=2*1024*1024,MAX_TOTAL=8*1024*1024,MAX_FILES=500,MAX_DEPTH=32,MAX_ENTRIES=10000,MAX_VISITS=2000;
const whitespace=(text,index)=>{while(/\s/.test(text[index]||'')&&index<text.length)index++;return index;};
function commandAt(text,index){
 if(text[index]!=='\\')return null;
 const match=/^\\([A-Za-z@]+|[^\r\n])/.exec(text.slice(index));
 return match?{name:match[1],end:index+match[0].length}:null;
}
function groupAt(text,index,open='{',close='}'){
 if(text[index]!==open)return null;
 let depth=1,braces=0;
 for(let cursor=index+1;cursor<text.length;cursor++){
  if(text[cursor]==='\\'){const command=commandAt(text,cursor);if(command){cursor=command.end-1;continue;}}
  if(open==='['){if(text[cursor]==='{')braces++;else if(text[cursor]==='}')braces=Math.max(0,braces-1);if(braces)continue;}
  if(text[cursor]===open)depth++;
  if(text[cursor]===close&&!--depth)return {text:text.slice(index+1,cursor),end:cursor+1};
 }
 return null;
}
function maskLiterals(source){
 // Keep code-unit offsets and newlines intact, including escaped percent signs.
 const chars=source.split(''),blank=(from,to)=>{for(let i=from;i<to;i++)if(chars[i]!=='\n'&&chars[i]!=='\r')chars[i]=' ';};
 for(let cursor=0;cursor<source.length;cursor++){
  if(source[cursor]==='%'){const end=source.indexOf('\n',cursor);blank(cursor,end<0?source.length:end);cursor=(end<0?source.length:end)-1;continue;}
  const command=commandAt(source,cursor);if(!command)continue;
  if(command.name==='verb'){
   let start=command.end;if(source[start]==='*')start++;
   const delimiter=source[start];if(delimiter&&!/\s/.test(delimiter)){let end=start+1;while(end<source.length&&source[end]!==delimiter&&!/[\r\n]/.test(source[end]))end++;blank(cursor,end+(source[end]===delimiter?1:0));cursor=end;continue;}
  }
  if(command.name==='begin'){
   const group=groupAt(source,whitespace(source,command.end));
   if(group&&literalEnvironments.has(group.text.trim())){
    const name=group.text.trim(),pattern=new RegExp('\\\\end\\s*\\{\\s*'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\s*\\}','g');pattern.lastIndex=group.end;
    const end=pattern.exec(source),to=end?pattern.lastIndex:source.length;blank(cursor,to);cursor=to-1;continue;
   }
  }
  cursor=command.end-1;
 }
 return chars.join('');
}
function titleText(text){
 let output='';
 for(let index=0;index<text.length;index++){
  const char=text[index];if(char==='{'||char==='}'||char==='$')continue;if(char==='~'){output+=' ';continue;}
  if(char!=='\\'){output+=char;continue;}
  const command=commandAt(text,index);if(!command)continue;index=command.end-1;
  if(/^[^A-Za-z@]$/.test(command.name)){output+=/^[%&#_$\{\}]$/.test(command.name)?command.name:' ';continue;}
  let cursor=whitespace(text,command.end);
  if(text[cursor]==='['){const optional=groupAt(text,cursor,'[',']');if(optional)cursor=whitespace(text,optional.end);}
  const first=groupAt(text,cursor);
  if(command.name==='texorpdfstring'&&first){const second=groupAt(text,whitespace(text,first.end));output+=titleText(second?.text||first.text);index=(second||first).end-1;}
  else if(['label','index','footnote','thanks','cite','citep','citet'].includes(command.name)&&first)index=first.end-1;
  else if(!first)output+=command.name;
 }
 const title=output.replace(/\s+/g,' ').trim();return title.length>500?title.slice(0,499)+'…':title;
}
function parseSource(source){
 const text=maskLiterals(source),events=[];let line=1,last=0;
 const lineAt=index=>{for(;last<index;last++)if(text[last]==='\n')line++;return line;};
 for(let index=0;index<text.length;index++){
  const command=commandAt(text,index);if(!command)continue;
  const commandLine=lineAt(index);let cursor=whitespace(text,command.end),starred=false;
  if(text[cursor]==='*'){starred=true;cursor=whitespace(text,cursor+1);}
  if(Object.hasOwn(levels,command.name)){
   let short;if(text[cursor]==='['){short=groupAt(text,cursor,'[',']');if(!short){index=command.end-1;continue;}cursor=whitespace(text,short.end);}
   const title=groupAt(text,cursor);if(title){events.push({type:'heading',line:commandLine,level:levels[command.name],command:command.name,title:titleText(short?.text||title.text),starred});index=title.end-1;continue;}
  }
  if(['input','include','subfile'].includes(command.name)){
   const target=groupAt(text,cursor),bare=!target&&command.name==='input'?/^[^\s%{}\\]+/.exec(text.slice(cursor)):null;
   if(target||bare){events.push({type:'include',line:commandLine,target:(target?.text||bare[0]).trim()});index=target?target.end-1:cursor+bare[0].length-1;continue;}
  }
  if(command.name==='endinput')break;
  if(command.name==='end'){const environment=groupAt(text,cursor);if(environment?.text.trim()==='document')break;}
  // Macro definitions describe commands; headings in their bodies are not document headings.
  if(['def','gdef','edef','xdef'].includes(command.name)){
   const name=commandAt(text,cursor);if(name){const start=text.indexOf('{',name.end),body=start>=0?groupAt(text,start):null;if(body){index=body.end-1;continue;}}
  }
  if(['newcommand','renewcommand','providecommand','DeclareRobustCommand','newenvironment','renewenvironment'].includes(command.name)){
   const name=groupAt(text,cursor)||commandAt(text,cursor);if(name){cursor=whitespace(text,name.end);for(let n=0;n<2&&text[cursor]==='[';n++){const optional=groupAt(text,cursor,'[',']');if(!optional)break;cursor=whitespace(text,optional.end);}const body=groupAt(text,cursor);if(body){cursor=body.end;if(command.name.endsWith('environment')){const ending=groupAt(text,whitespace(text,cursor));if(ending)cursor=ending.end;}index=cursor-1;continue;}}
  }
  index=command.end-1;
 }
 return events;
}
const safePath=path=>typeof path==='string'&&path.length>0&&path.length<1024&&!path.includes('\\')&&!path.includes('\0')&&!posix.isAbsolute(path)&&!path.split('/').some(part=>!part||part==='.'||part==='..'||part.startsWith('.')||['node_modules','__MACOSX'].includes(part));

/** Read-only outline. Unsaved sources override visible .tex files without writing to disk. */
export async function outlineProject(projects,projectId,{sources={}}={}){
 check(sources&&typeof sources==='object'&&!Array.isArray(sources),'Invalid outline sources');
 const project=await projects.get(projectId),files=await projects.treeAt(project.root),main=project.main,visible=new Set(files.filter(file=>file.text&&/\.tex$/i.test(file.path)&&safePath(file.path)).map(file=>file.path));
 let overrideBytes=0;const overrides=new Map(Object.entries(sources));check(overrides.size<=100,'Too many outline sources');
 for(const [path,text]of overrides){check(visible.has(path)&&safePath(path),'Outline source must be a visible TeX file');check(typeof text==='string'&&Buffer.byteLength(text)<=MAX_FILE,'Outline source too large');overrideBytes+=Buffer.byteLength(text);}
 check(overrideBytes<=MAX_TOTAL,'Outline sources too large');
 const entries=[],detached=[],warnings=[],cache=new Map(),visited=new Set();let total=0,truncated=false,sequence=0,visits=0;
 const warn=(code,path,line,target)=>{if(warnings.length<100)warnings.push({code,path,...(line?{line}:{}),...(target?{target:target.slice(0,500)}: {})});};
 async function read(path){
  if(cache.has(path))return cache.get(path);
  if(cache.size>=MAX_FILES){truncated=true;warn('file_limit',path);return null;}
  try{
   const source=overrides.has(path)?overrides.get(path):(await projects.read(projectId,path)).text;
   const size=Buffer.byteLength(source);if(size>MAX_FILE||total+size>MAX_TOTAL){truncated=true;warn('source_limit',path);cache.set(path,null);return null;}total+=size;
   if(source.includes('\0')||source.includes('\ufffd')){warn('binary_source',path);cache.set(path,null);return null;}
   const events=parseSource(source);cache.set(path,events);return events;
  }catch{warn('read_failed',path);cache.set(path,null);return null;}
 }
 function targetFor(path,target){
  // TeX normally resolves from the project cwd; a relative fragment is a useful fallback.
  if(!target||target.includes('\\')||target.includes('\0')||/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(target)||posix.isAbsolute(target))return null;
  const candidates=[posix.normalize(target),posix.normalize(posix.join(posix.dirname(path),target))];
  for(let candidate of candidates){if(!/\.tex$/i.test(candidate))candidate+='.tex';if(safePath(candidate)&&visible.has(candidate))return candidate;}
  return null;
 }
 function add(event,path,output){if(sequence>=MAX_ENTRIES){truncated=true;return false;}output.push({id:path+':'+event.line+':'+sequence++,path,line:event.line,level:event.level,command:event.command,title:event.title,starred:event.starred});return true;}
 async function visit(path,stack=[]){
  if(visits++>=MAX_VISITS){truncated=true;warn('include_limit',path);return;}
  if(stack.includes(path)){warn('include_cycle',path);return;}
  if(stack.length>=MAX_DEPTH){truncated=true;warn('depth_limit',path);return;}
  visited.add(path);const events=await read(path);if(!events)return;
  for(const event of events){if(sequence>=MAX_ENTRIES||visits>MAX_VISITS){truncated=true;break;}if(event.type==='heading')add(event,path,entries);else{const target=targetFor(path,event.target);if(target)await visit(target,[...stack,path]);else warn('include_unresolved',path,event.line,event.target);}}
 }
 if(visible.has(main))await visit(main);else warn('main_unavailable',main);
 for(const path of [...visible].sort()){
  if(visited.has(path))continue;const events=await read(path),local=[];if(events)for(const event of events)if(event.type==='heading'&&!add(event,path,local))break;
  if(local.length)detached.push({path,entries:local});if(sequence>=MAX_ENTRIES){truncated=true;break;}
 }
 return {main,entries,detached,warnings,truncated};
}
