// What to offer at the cursor. Pure: takes the text before the cursor and project
// data, returns plain options; web/editor.mjs turns them into editor completions.
import {FREQUENT,COMMANDS,PACKAGE_COMMANDS,SYMBOLS,ENVIRONMENTS,PACKAGE_ENVIRONMENTS,ENVIRONMENT_BODIES,PACKAGES,CLASSES,BIBSTYLES} from './latex-data.mjs';

const LIMIT=100;
const IMAGE=/\.(pdf|png|jpe?g|eps|svg|gif|tiff?)$/i;
// Commands whose argument opens another list right after they are inserted.
const CHAINS=/^(?:[a-zA-Z]*cite[a-zA-Z]*|nocite|[a-zA-Z]*ref|crefrange|begin|end|input|include|subfile|includegraphics|usepackage|RequirePackage|documentclass|bibliography|bibliographystyle|addbibresource)$/;
// Optional-argument words that are placeholders; anything else in [] is literal.
const OPTIONAL_STOPS=new Set(['label','options','n','short','width','prenote','postnote']);
function parseSpec(spec){
 const name=/^[a-zA-Z@]+\*?/.exec(spec)[0],groups=[...spec.slice(name.length).matchAll(/\{((?:[^{}]|\{[^{}]*\})*)\}|\[([^\]]*)\]|\(([^)]*)\)|<([^>]*)>/g)];
 let label='\\'+name,template='\\'+name;
 for(const group of groups){
  const open=group[0][0],close=group[0].at(-1),inner=group[1]??group[2]??group[3]??group[4];
  if(open==='{'){label+='{}';template+=!inner?'{${}}':/^\\?[a-zA-Z][a-zA-Z, ]*$/.test(inner)?'{${'+inner+'}}':inner==='{}'?'{{${}}}':'{'+inner+'}';}
  else{label+=open+inner+close;template+=open+(open==='['&&OPTIONAL_STOPS.has(inner)?'${'+inner+'}':inner)+close;}
 }
 return {name,label,template,args:groups.length};
}
const specs=new Map();
const spec=text=>{if(!specs.has(text))specs.set(text,parseSpec(text));return specs.get(text);};
const fromDefinition=command=>({name:command.name,label:'\\'+command.name+(command.optional?'[]':'')+'{}'.repeat(command.args),template:'\\'+command.name+'{${}}'.repeat(command.args),args:command.args});
// Offered in every project: classes load these implicitly too often to tell.
const COMMON=['amsmath','amssymb','graphicx','xcolor','hyperref','url','natbib','booktabs','multirow','caption','subcaption'];
const loaded=index=>new Set([...COMMON,...(index?.packages||[]),...(index?.classes||[])]);

// The innermost \begin{...} before the cursor that has no \end yet.
export function openEnvironment(before){
 const stack=[];for(const match of before.slice(-40000).matchAll(/\\(begin|end)\s*\{([^{}\s]+)\}/g)){if(match[1]==='begin')stack.push(match[2]);else{const at=stack.lastIndexOf(match[2]);if(at>=0)stack.length=at;}}
 return stack.at(-1)||null;
}
// True when the document already holds an unmatched \end{name} for the environment being typed.
export function environmentClosed(document,name){
 const escaped=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
 const begins=(document.match(new RegExp('\\\\begin\\s*\\{'+escaped+'\\}','g'))||[]).length,ends=(document.match(new RegExp('\\\\end\\s*\\{'+escaped+'\\}','g'))||[]).length;
 return ends>begins;
}
const words=query=>query.toLowerCase().split(/\s+/).filter(Boolean);
// Every word must match somewhere; a match in an earlier field ranks higher.
function rank(items,query,fields){
 const tokens=words(query);
 if(!tokens.length)return items.slice(0,LIMIT);
 const scored=[];
 for(const item of items){
  let total=0,ok=true;
  for(const token of tokens){
   let best=0;
   for(const [field,weight] of fields){
    const value=item.search[field];if(!value)continue;const at=value.indexOf(token);if(at<0)continue;
    const score=weight+(at===0?30:/[^a-z0-9]/.test(value[at-1])?12:0);if(score>best)best=score;
   }
   if(!best){ok=false;break;}total+=best;
  }
  if(ok)scored.push([total,item]);
 }
 return scored.sort((a,b)=>b[0]-a[0]||a[1].key.localeCompare(b[1].key)).slice(0,LIMIT).map(([,item])=>item);
}
const searchable=new WeakMap();
function prepared(list,build){if(!searchable.has(list))searchable.set(list,list.map(item=>({...item,search:build(item)})));return searchable.get(list);}
const KIND={figure:'Fig.',table:'Table',equation:'Eq.',section:'Sec.',chapter:'Ch.',part:'Part',appendix:'App.',algorithm:'Alg.',listing:'Listing',theorem:'Thm.',item:'Item',text:''};
const relativeTo=(directory,path)=>{if(!directory)return path;const base=directory.split('/'),parts=path.split('/');let shared=0;while(shared<base.length&&shared<parts.length-1&&base[shared]===parts[shared])shared++;return [...Array(base.length-shared).fill('..'),...parts.slice(shared)].join('/');};
const fileOptions=(files,test,map,query)=>{const q=query.toLowerCase(),seen=new Set(),out=[];for(const file of files||[]){if(!test(file.path))continue;const label=map(file.path);if(seen.has(label)||!label.toLowerCase().includes(q))continue;seen.add(label);out.push({label,type:'file',insert:label});}return out.sort((a,b)=>Number(b.label.toLowerCase().startsWith(q))-Number(a.label.toLowerCase().startsWith(q))||a.label.localeCompare(b.label)).slice(0,LIMIT);};
const nameOptions=(names,query,type)=>{const q=query.toLowerCase(),seen=new Set(),out=[];for(const name of names){if(seen.has(name)||!name.toLowerCase().includes(q))continue;seen.add(name);out.push({label:name,type,insert:name});}return out.sort((a,b)=>Number(b.label.toLowerCase().startsWith(q))-Number(a.label.toLowerCase().startsWith(q))).slice(0,LIMIT);};

export function commandOptions(index){
 const active=loaded(index),seen=new Set(),options=[];
 const push=(item,extra)=>{if(seen.has(item.label))return;seen.add(item.label);options.push({label:item.label,template:item.template,name:item.name,args:item.args,chain:item.args>0&&CHAINS.test(item.name),type:'keyword',...(SYMBOLS[item.name]&&!item.args?{detail:SYMBOLS[item.name]}:{}),...extra});};
 for(const command of index?.commands||[])push(fromDefinition(command),{type:'function',boost:60,detail:command.path||''});
 FREQUENT.forEach((text,order)=>push(spec(text),{boost:40-order}));
 for(const [name,texts] of Object.entries(PACKAGE_COMMANDS))if(active.has(name))for(const text of texts)push(spec(text),COMMON.includes(name)?{}:{boost:10});
 for(const text of COMMANDS)push(spec(text));
 return options;
}
// Tables use booktabs rules when the project has them (acmart and sn-jnl load booktabs).
const environmentBody=(name,index)=>{const body=ENVIRONMENT_BODIES[name]||'';if(!/^table\*?$/.test(name))return body;const rules=['booktabs','acmart','sn-jnl'].some(item=>(index.packages||[]).includes(item)||(index.classes||[]).includes(item));return rules?body.replace('\\hline','\\toprule').replace('\\hline','\\bottomrule'):body;};
const commandCache=new WeakMap(),noIndex={};
// data: {index, files, path, main}. Returns {kind, from, to, options, filter} or null. Offsets are relative to before.length.
export function completionAt(before,data={}){
 const index=data.index||noIndex,end=before.length,tail=before.slice(-600),shift=end-tail.length;
 const reference=/\\hyperref\s*\[([^\]{}]*)$/.exec(tail);
 const argument=reference?null:/\\([a-zA-Z@]+)\*?((?:\s*\[[^\[\]{}]*\])*)\s*\{([^{}]*)$/.exec(tail);
 if(reference||argument){
  const name=reference?'ref':argument[1],content=reference?reference[1]:argument[3];
  const multiple=/cite|ref$|^usepackage$|^RequirePackage$|^bibliography$|^crefrange$/i.test(name)&&name!=='href';
  const token=(multiple?content.slice(content.lastIndexOf(',')+1):content).replace(/^\s+/,''),from=end-token.length,base={from,to:end,filter:false};
  if(/cite/i.test(name)){
   const entries=prepared(index.citations||[],entry=>({key:entry.key.toLowerCase(),author:(entry.authors||entry.author||'').toLowerCase(),title:(entry.title||'').toLowerCase(),year:entry.year||'',venue:(entry.venue||'').toLowerCase()}));
   return {...base,kind:'cite',options:rank(entries,token,[['key',100],['author',70],['title',50],['year',45],['venue',20]]).map(entry=>({label:entry.key,type:'cite',insert:entry.key,detail:[entry.author,entry.year].filter(Boolean).join(' '),title:entry.title,info:[entry.venue,entry.authors].filter(Boolean).join('\n')}))};
  }
  if(/ref$/i.test(name)&&name!=='href'||name==='crefrange'||name==='labelcref'||name==='cpageref'){
   const labels=prepared(index.labels||[],label=>({key:label.key.toLowerCase(),hint:(label.hint||'').toLowerCase(),kind:(KIND[label.kind]||'').toLowerCase()+' '+label.kind,path:(label.path||'').toLowerCase()}));
   return {...base,kind:'ref',options:rank(labels,token,[['key',100],['hint',60],['kind',30],['path',10]]).map(label=>({label:label.key,type:'ref',insert:label.key,detail:KIND[label.kind]||'',title:label.hint,info:label.path?label.path+':'+label.line:''}))};
  }
  if(name==='begin'||name==='end'){
   const active=loaded(index),names=[...(index.environments||[]),...ENVIRONMENTS];for(const [pack,list] of Object.entries(PACKAGE_ENVIRONMENTS))if(active.has(pack))names.unshift(...list);
   if(name==='end'){const open=openEnvironment(before.slice(0,end-argument[0].length+0));if(open)names.unshift(open);}
   return {...base,kind:name,options:nameOptions(names,token,'environment').map(option=>({...option,...(name==='begin'?{environment:option.label,body:environmentBody(option.label,index)}:{})}))};
  }
  if(name==='usepackage'||name==='RequirePackage')return {...base,kind:'package',options:nameOptions([...(data.files||[]).filter(f=>/\.sty$/i.test(f.path)).map(f=>f.path.replace(/\.sty$/i,'')),...PACKAGES],token,'package')};
  if(name==='documentclass')return {...base,kind:'class',options:nameOptions([...(data.files||[]).filter(f=>/\.cls$/i.test(f.path)).map(f=>f.path.replace(/\.cls$/i,'')),...CLASSES],token,'class')};
  if(name==='bibliographystyle')return {...base,kind:'bibstyle',options:nameOptions([...(data.files||[]).filter(f=>/\.bst$/i.test(f.path)).map(f=>f.path.replace(/\.bst$/i,'')),...BIBSTYLES],token,'bibstyle')};
  const directory=(data.main||'').includes('/')?data.main.slice(0,data.main.lastIndexOf('/')):'';
  if(name==='includegraphics'){const roots=(index.graphicsPaths||[]).map(root=>root.replace(/^\.\//,''));return {...base,kind:'graphics',options:fileOptions(data.files,path=>IMAGE.test(path),path=>{const local=relativeTo(directory,path),root=roots.find(root=>local.startsWith(root));return root?local.slice(root.length):local;},token)};}
  if(['input','include','subfile','subfileinclude'].includes(name))return {...base,kind:'input',options:fileOptions(data.files,path=>/\.tex$/i.test(path)&&path!==data.path&&path!==data.main,path=>relativeTo(directory,path).replace(/\.tex$/i,''),token)};
  if(name==='bibliography'||name==='addbibresource')return {...base,kind:'bibliography',options:fileOptions(data.files,path=>/\.bib$/i.test(path),path=>name==='bibliography'?relativeTo(directory,path).replace(/\.bib$/i,''):relativeTo(directory,path),token)};
  return null;
 }
 const command=/(\\+)([a-zA-Z@]*)$/.exec(tail);
 if(!command||command[1].length%2===0)return null;
 if(!commandCache.has(index))commandCache.set(index,commandOptions(index));
 return {kind:'command',from:shift+command.index+command[1].length-1,to:end,filter:true,options:commandCache.get(index)};
}
// Replace what the Host knows about the open file with a scan of its live text.
export function withLiveFile(index,path,scan){
 if(!index||!scan||!path)return index;
 const names=new Set((index.commands||[]).map(command=>command.name)),environments=new Set(index.environments||[]),keys=new Set((index.citations||[]).filter(entry=>entry.path!==path).map(entry=>entry.key));
 return {...index,
  labels:[...(index.labels||[]).filter(label=>label.path!==path),...scan.labels.map(label=>({...label,path}))],
  citations:[...(index.citations||[]).filter(entry=>entry.path!==path),...(scan.entries||scan.bibitems.map(item=>({key:item.key,type:'bibitem',title:'',author:'',authors:'',year:'',venue:'',line:item.line}))).filter(entry=>!keys.has(entry.key)).map(entry=>({...entry,path}))],
  commands:[...(index.commands||[]),...scan.commands.filter(command=>!names.has(command.name)).map(command=>({...command,path}))],
  environments:[...(index.environments||[]),...scan.environments.filter(name=>!environments.has(name))],
  packages:[...new Set([...(index.packages||[]),...scan.packages])],classes:[...new Set([...(index.classes||[]),...scan.classes])]};
}
