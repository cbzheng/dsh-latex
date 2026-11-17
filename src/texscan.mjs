// Pure scanners shared by the Host index and the editor (no Node imports).
// They read structure for completion; this is not a TeX interpreter.
const clip=(value,max=300)=>{const text=String(value).replace(/\s+/g,' ').trim();return text.length>max?text.slice(0,max-1)+'…':text;};
// Blank comments, keeping offsets and newlines. \% is literal.
export function stripComments(source){
 let out='';
 for(let i=0;i<source.length;i++){
  const c=source[i];
  if(c==='\\'){out+=c+(source[i+1]??'');i++;continue;}
  if(c==='%'){let end=source.indexOf('\n',i);if(end<0)end=source.length;out+=' '.repeat(end-i);i=end-1;continue;}
  out+=c;
 }
 return out;
}
// Balanced {...} starting at index (which must hold "{"). Returns inner text and end offset.
export function braceGroup(text,index){
 if(text[index]!=='{')return null;
 let depth=0;
 for(let i=index;i<text.length;i++){
  const c=text[i];if(c==='\\'){i++;continue;}
  if(c==='{')depth++;else if(c==='}'&&!--depth)return {text:text.slice(index+1,i),end:i+1};
 }
 return null;
}
// Readable text of a title or caption: drop commands, keep their arguments.
export function plainText(value,max=300){
 let text=String(value);
 text=text.replace(/\\(?:label|cite[a-zA-Z]*|ref|autoref|cref|Cref|eqref|footnote|thanks|index)\*?(?:\[[^\]]*\])*\{[^{}]*\}/g,' ');
 text=text.replace(/\\texorpdfstring\{[^{}]*\}\{([^{}]*)\}/g,'$1').replace(/\\(?:[a-zA-Z@]+\*?|.)/g,m=>/^\\[%&#_$]$/.test(m)?m[1]:' ').replace(/[{}$~]/g,' ');
 return clip(text,max);
}
const lineOf=(starts,offset)=>{let lo=0,hi=starts.length-1;while(lo<hi){const mid=(lo+hi+1)>>1;if(starts[mid]<=offset)lo=mid;else hi=mid-1;}return lo+1;};
const lineStarts=text=>{const starts=[0];for(let i=text.indexOf('\n');i>=0;i=text.indexOf('\n',i+1))starts.push(i+1);return starts;};
const sectionKinds={part:'part',chapter:'chapter',section:'section',subsection:'section',subsubsection:'section',paragraph:'section',subparagraph:'section'};
const floatKinds=[[/^(?:figure|teaserfigure|subfigure|wrapfigure|sidewaysfigure)\*?$/,'figure'],[/^(?:table|subtable|longtable|sidewaystable|tabularx?)\*?$/,'table'],[/^(?:equation|align|gather|multline|eqnarray|flalign|alignat|subequations|split|IEEEeqnarray)\*?$/,'equation'],[/^(?:algorithm|algorithm2e|algorithmic)\*?$/,'algorithm'],[/^(?:lstlisting|listing|minted)\*?$/,'listing'],[/^(?:theorem|lemma|corollary|proposition|definition|remark|example|claim|conjecture|proof)\*?$/,'theorem'],[/^(?:enumerate|itemize|description)$/,'item']];
const kindOfEnvironment=name=>floatKinds.find(([pattern])=>pattern.test(name))?.[1];
// Labels with their kind and a human hint, command and environment definitions, packages, classes, bibliography files.
export function scanTex(source,{maxLabels=5000}={}){
 const text=stripComments(source),starts=lineStarts(text);
 const result={labels:[],commands:[],environments:[],packages:[],classes:[],bibliographies:[],bibitems:[],graphicsPaths:[]};
 const stack=[];let section=null;
 const pattern=/\\(begin|end|label|caption|part|chapter|section|subsection|subsubsection|paragraph|subparagraph|newcommand|renewcommand|providecommand|DeclareRobustCommand|DeclareMathOperator|NewDocumentCommand|RenewDocumentCommand|ProvideDocumentCommand|def|newenvironment|renewenvironment|NewDocumentEnvironment|newtheorem|usepackage|RequirePackage|documentclass|bibliography|addbibresource|bibitem|graphicspath)(\*?)(?![a-zA-Z@])/g;
 const argument=from=>{let i=from;while(/\s/.test(text[i]||''))i++;while(text[i]==='['){const end=text.indexOf(']',i);if(end<0)return null;i=end+1;while(/\s/.test(text[i]||''))i++;}return braceGroup(text,i);};
 for(let match;(match=pattern.exec(text));){
  const name=match[1],after=pattern.lastIndex,line=lineOf(starts,match.index);
  if(name==='begin'||name==='end'){
   const group=argument(after);if(!group)continue;const environment=group.text.trim();
   if(name==='begin')stack.push({name:environment,kind:kindOfEnvironment(environment),caption:'',labels:[]});
   else{const at=stack.map(e=>e.name).lastIndexOf(environment);if(at>=0){const closed=stack.splice(at);for(const frame of closed)for(const label of frame.labels)if(!label.hint&&frame.caption)label.hint=frame.caption;}}
   continue;
  }
  if(name==='label'){
   const group=argument(after);if(!group||!group.text.trim()||result.labels.length>=maxLabels)continue;
   const frame=[...stack].reverse().find(e=>e.kind&&e.kind!=='item'),inItem=stack.at(-1)?.kind==='item';
   const prefix=group.text.trim().match(/^(fig|tab|tbl|eq|eqn|sec|subsec|ch|chap|app|alg|lst|thm|lem|def|prop|cor|item)[:._-]/i)?.[1].toLowerCase();
   const byPrefix={fig:'figure',tab:'table',tbl:'table',eq:'equation',eqn:'equation',sec:'section',subsec:'section',ch:'chapter',chap:'chapter',app:'appendix',alg:'algorithm',lst:'listing',thm:'theorem',lem:'theorem',def:'theorem',prop:'theorem',cor:'theorem',item:'item'}[prefix];
   const label={key:clip(group.text,200),line,kind:frame?.kind||(inItem?'item':byPrefix||section?.kind||'text'),hint:frame?frame.caption:(inItem?'':section?.title||'')};
   result.labels.push(label);if(frame)frame.labels.push(label);
   continue;
  }
  if(name==='caption'){const group=argument(after);const frame=[...stack].reverse().find(e=>e.kind&&e.kind!=='item');if(group&&frame){frame.caption=plainText(group.text,160);for(const label of frame.labels)if(!label.hint)label.hint=frame.caption;}continue;}
  if(sectionKinds[name]){const group=argument(after);if(group)section={kind:sectionKinds[name],title:plainText(group.text,160)};continue;}
  if(['newcommand','renewcommand','providecommand','DeclareRobustCommand','DeclareMathOperator','NewDocumentCommand','RenewDocumentCommand','ProvideDocumentCommand'].includes(name)){
   let i=after;while(/\s/.test(text[i]||''))i++;if(text[i]==='{')i++;
   const command=/^\\([a-zA-Z@]+)/.exec(text.slice(i,i+80));if(!command)continue;i+=command[0].length;while(/[\s}]/.test(text[i]||''))i++;
   let args=0,optional=false;
   if(/DocumentCommand$/.test(name)){const spec=braceGroup(text,i);if(spec){const parts=spec.text.match(/[mov]|[OD]\{[^{}]*\}|[sd]/g)||[];args=parts.filter(p=>p==='m'||p==='v').length;optional=parts.some(p=>/^[oOdD]/.test(p));}}
   else if(name==='DeclareMathOperator')args=0;
   else{const count=/^\[(\d)\]\s*(\[)?/.exec(text.slice(i,i+40));if(count){args=Number(count[1]);optional=Boolean(count[2]);if(optional)args--;}}
   result.commands.push({name:command[1],args,...(optional?{optional:true}:{}),line});continue;
  }
  if(name==='def'){const command=/^\s*\\([a-zA-Z@]+)((?:#\d)*)/.exec(text.slice(after,after+80));if(command&&!command[1].includes('@'))result.commands.push({name:command[1],args:command[2].length/2,line});continue;}
  if(['newenvironment','renewenvironment','NewDocumentEnvironment','newtheorem'].includes(name)){const group=argument(after);if(group&&/^[a-zA-Z@*]+$/.test(group.text.trim()))result.environments.push(group.text.trim());continue;}
  if(name==='usepackage'||name==='RequirePackage'){const group=argument(after);if(group)for(const item of group.text.split(','))if(/^[\w.-]+$/.test(item.trim()))result.packages.push(item.trim());continue;}
  if(name==='documentclass'){const group=argument(after);if(group&&/^[\w./-]+$/.test(group.text.trim()))result.classes.push(group.text.trim());continue;}
  if(name==='bibliography'||name==='addbibresource'){const group=argument(after);if(group)for(const item of group.text.split(','))if(item.trim())result.bibliographies.push(item.trim());continue;}
  if(name==='bibitem'){const group=argument(after);if(group&&group.text.trim())result.bibitems.push({key:clip(group.text,200),line});continue;}
  if(name==='graphicspath'){const group=argument(after);if(group)for(const item of group.text.matchAll(/\{([^{}]*)\}/g))if(item[1].trim())result.graphicsPaths.push(item[1].trim());}
 }
 for(const frame of stack)for(const label of frame.labels)if(!label.hint&&frame.caption)label.hint=frame.caption;
 return result;
}
// BibTeX value: {braced}, "quoted", number or @string name, joined with #.
function bibValue(text,index,strings){
 let value='',i=index;
 for(;;){
  while(/\s/.test(text[i]||''))i++;
  if(text[i]==='{'){const group=braceGroup(text,i);if(!group)return null;value+=group.text;i=group.end;}
  else if(text[i]==='"'){let depth=0,j=i+1;for(;j<text.length;j++){const c=text[j];if(c==='\\'){j++;continue;}if(c==='{')depth++;else if(c==='}')depth--;else if(c==='"'&&depth<=0)break;}if(j>=text.length)return null;value+=text.slice(i+1,j);i=j+1;}
  else{const word=/^[^\s,#{}"=()]+/.exec(text.slice(i,i+200));if(!word)return null;value+=strings.get(word[0].toLowerCase())??word[0];i+=word[0].length;}
  while(/\s/.test(text[i]||''))i++;
  if(text[i]==='#'){i++;continue;}
  return {value,end:i};
 }
}
const bibText=value=>clip(String(value).replace(/\\(?:[a-zA-Z]+\s*|.)/g,m=>/^\\[&%$#_]$/.test(m)?m[1]:'').replace(/[{}]/g,'').replace(/~/g,' ').replace(/--+/g,'–'));
// "Last, First and Other, Name" → "Last and Other", "Last et al." beyond two.
export function authorLabel(value){
 const names=String(value).split(/\s+and\s+/i).map(name=>name.trim()).filter(Boolean).map(name=>name==='others'?'others':name.includes(',')?name.split(',')[0].trim():(/\{([^{}]+)\}\s*$/.exec(name)?.[1]||name.replace(/[{}]/g,'').split(/\s+/).at(-1)));
 const clean=names.map(name=>bibText(name)).filter(Boolean);if(!clean.length)return '';
 if(clean.at(-1)==='others')return clean[0]+' et al.';
 return clean.length===1?clean[0]:clean.length===2?clean[0]+' and '+clean[1]:clean[0]+' et al.';
}
export function parseBib(source,{maxEntries=10000}={}){
 const entries=[],strings=new Map([['jan','January'],['feb','February'],['mar','March'],['apr','April'],['may','May'],['jun','June'],['jul','July'],['aug','August'],['sep','September'],['oct','October'],['nov','November'],['dec','December']]);
 const starts=lineStarts(source),pattern=/@([a-zA-Z]+)\s*([{(])/g;
 for(let match;(match=pattern.exec(source))&&entries.length<maxEntries;){
  const type=match[1].toLowerCase();let i=pattern.lastIndex;
  if(type==='comment'||type==='preamble')continue;
  if(type==='string'){const name=/^\s*([^\s=,{}]+)\s*=/.exec(source.slice(i,i+200));if(name){const parsed=bibValue(source,i+name[0].length,strings);if(parsed){strings.set(name[1].toLowerCase(),parsed.value);pattern.lastIndex=parsed.end;}}continue;}
  const key=/^\s*([^\s,{}()=]+)\s*,/.exec(source.slice(i,i+400));if(!key)continue;i+=key[0].length;
  const fields={};
  for(let guard=0;guard<200;guard++){
   const field=/^\s*([a-zA-Z][\w-]*)\s*=/.exec(source.slice(i,i+200));if(!field)break;
   const parsed=bibValue(source,i+field[0].length,strings);if(!parsed)break;
   fields[field[1].toLowerCase()]??=parsed.value;i=parsed.end;
   if(source[i]===',')i++;else break;
  }
  pattern.lastIndex=Math.max(pattern.lastIndex,i);
  const year=(/\d{4}/.exec(fields.year||fields.date||'')||[''])[0];
  entries.push({key:clip(key[1],200),type,title:bibText(fields.title||fields.booktitle||''),author:authorLabel(fields.author||fields.editor||''),authors:bibText(fields.author||fields.editor||''),year,venue:bibText(fields.journal||fields.journaltitle||fields.booktitle||fields.publisher||fields.school||fields.howpublished||''),line:lineOf(starts,match.index)});
 }
 return entries;
}
