import {EditorState,EditorSelection} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,drawSelection,tooltips} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab,isolateHistory} from '@codemirror/commands';
import {searchKeymap,highlightSelectionMatches} from '@codemirror/search';
import {StreamLanguage,syntaxHighlighting,HighlightStyle,bracketMatching} from '@codemirror/language';
import {stex} from '@codemirror/legacy-modes/mode/stex';
import {autocompletion,closeBrackets,closeBracketsKeymap,snippet,startCompletion,pickedCompletion} from '@codemirror/autocomplete';
import {completionAt,withLiveFile,environmentClosed} from './complete.mjs';
import {scanTex,parseBib} from '../src/texscan.mjs';
import {tags} from '@lezer/highlight';

const writingHighlight=HighlightStyle.define([
 {tag:tags.comment,color:'var(--ls-syntax-comment,#667085)'},
 {tag:[tags.keyword,tags.tagName,tags.function(tags.variableName),tags.processingInstruction,tags.modifier],color:'var(--ls-syntax-keyword,#245ca5)'},
 {tag:[tags.string,tags.atom],color:'var(--ls-syntax-string,#416845)'},
 {tag:tags.number,color:'var(--ls-syntax-number,#865a2c)'},
 {tag:tags.invalid,color:'var(--ls-syntax-invalid,#b42318)'}
]);

// Environment snippets: lists turn selected lines into items; figure wraps a
// selection as its caption. One undoable step, indented like the current line.
export function insertEnvironment(view,kind){
 if(!['itemize','enumerate','figure'].includes(kind))return false;
 const state=view.state,range=state.selection.main,first=state.doc.lineAt(range.from),last=state.doc.lineAt(range.to);
 const indent=first.text.match(/^\s*/)[0],inner=indent+'  ';
 let body,cursor;
 if(kind==='figure'){
  const caption=state.sliceDoc(range.from,range.to).replace(/\s+/g,' ').trim();
  const head=`\\begin{figure}[htbp]\n${inner}\\centering\n${inner}\\includegraphics[width=\\linewidth]{`;
  body=head+`}\n${inner}\\caption{${caption}}\n${inner}\\label{fig:}\n${indent}\\end{figure}`;cursor=head.length;
 }else{
  const lines=range.empty?[]:state.sliceDoc(first.from,last.to).split('\n').map(l=>l.trim()).filter(Boolean);
  const items=lines.length?lines.map(l=>inner+'\\item '+l.replace(/^\\item\s*/,'')):[inner+'\\item '];
  body=`\\begin{${kind}}\n${items.join('\n')}\n${indent}\\end{${kind}}`;cursor=lines.length?body.length:`\\begin{${kind}}\n`.length+items[0].length;
 }
 let from,to,insert;
 if(!range.empty&&kind!=='figure'){from=first.from;to=last.to;insert=indent+body;cursor+=indent.length;}
 else if(!range.empty){from=range.from;to=range.to;const before=state.sliceDoc(first.from,range.from).trim()?'\n'+indent:'';insert=before+body;cursor+=before.length;}
 else{from=to=range.from;const lineEmpty=!first.text.trim();const before=lineEmpty?(range.from===first.from?indent:''):'\n'+indent;insert=before+body+(lineEmpty?'':'\n');cursor+=before.length;}
 view.dispatch({changes:{from,to,insert},selection:{anchor:from+cursor},scrollIntoView:true,userEvent:'input.format',annotations:isolateHistory.of('full')});view.focus();return true;
}
export function formatText(view,kind){
 if(['itemize','enumerate','figure'].includes(kind))return insertEnvironment(view,kind);
 const command={bold:'textbf',italic:'textit'}[kind];if(!command)return false;
 const changes=view.state.changeByRange(range=>{
  const selected=view.state.sliceDoc(range.from,range.to),prefix='\\'+command+'{';
  const wrapped=range.from>=prefix.length&&view.state.sliceDoc(range.from-prefix.length,range.from)===prefix&&view.state.sliceDoc(range.to,range.to+1)==='}';
  const start=wrapped?range.from-prefix.length:range.from+prefix.length;
  return {changes:wrapped?[{from:range.from-prefix.length,to:range.from,insert:''},{from:range.to,to:range.to+1,insert:''}]:{from:range.from,to:range.to,insert:prefix+selected+'}'},range:EditorSelection.range(start,start+selected.length)};
 });
 view.dispatch({...changes,scrollIntoView:true,userEvent:'input.format',annotations:isolateHistory.of('full')});view.focus();return true;
}
const clampTo=(view,x)=>Math.min(Math.max(0,x|0),view.state.doc.length);
// Only view.viewport is drawn: a range outside it has no DOM (null), so the host asks showRange instead.
export function viewRange(view,from,to){
 from=clampTo(view,from);to=clampTo(view,to??from);if(from<view.viewport.from||to>view.viewport.to)return null;
 try{const a=view.domAtPos(from),b=view.domAtPos(to),r=document.createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);return r;}catch{return null;}
}
// Scroll a (possibly stale) range into view, centred, without touching selection, focus or the document.
export function showRange(view,from,to){view.dispatch({effects:EditorView.scrollIntoView(EditorSelection.range(clampTo(view,from),clampTo(view,to??from)),{y:'center'})});}
// Completion: commands after a backslash, bibliography entries inside \cite{}, labels inside
// \ref{}, environments, packages and project files. getData returns {index,files,path,main}.
const insertText=(view,completion,from,to,text)=>{
 const next=view.state.sliceDoc(to,to+1),close=next==='}'||next===','||next===']'?'':'}';
 view.dispatch({changes:{from,to,insert:text+close},selection:{anchor:from+text.length+(close||next==='}'?1:0)},userEvent:'input.complete',annotations:pickedCompletion.of(completion)});
};
function toCompletion(kind,option){
 const base={label:option.label,type:option.type,...(option.detail?{detail:option.detail}:{}),...(option.info?{info:option.info}:{}),...(option.boost?{boost:option.boost}:{}),...(option.title?{title:option.title}:{})};
 if(kind==='command')return {...base,apply:(view,completion,from,to)=>{
  const next=view.state.sliceDoc(to,to+1);
  if(option.args&&(next==='{'||next==='[')){view.dispatch({changes:{from,to,insert:'\\'+option.name},selection:{anchor:from+option.name.length+1},userEvent:'input.complete',annotations:pickedCompletion.of(completion)});return;}
  snippet(option.template)(view,completion,from,to);if(option.chain)startCompletion(view);
 }};
 if(kind==='begin')return {...base,apply:(view,completion,from,to)=>{
  const doc=view.state.doc.toString(),opener=/\\begin\s*\{$/.exec(doc.slice(Math.max(0,from-40),from)),end=doc[to]==='}'?to+1:to;
  const rest=doc.slice(0,from-(opener?opener[0].length:0))+doc.slice(end);
  if(environmentClosed(rest,option.environment)){insertText(view,completion,from,to,option.label);return;}
  snippet(option.environment+'}'+(option.body||'\n\t${}')+'\n\\end{'+option.environment+'}')(view,completion,from,end);
 }};
 return {...base,apply:(view,completion,from,to)=>insertText(view,completion,from,to,option.insert)};
}
export function latexCompletionSource(getData){
 let cache={doc:null,index:null,merged:null};
 return context=>{
  const pos=context.pos,before=context.state.sliceDoc(Math.max(0,pos-40000),pos);
  if(!/\\[a-zA-Z@]*$|[{[][^{}]*$/.test(before.slice(-600)))return null;
  const data=getData?.()||{},index=data.index||null,doc=context.state.doc;
  if(cache.doc!==doc||cache.index!==index){
   let scan=null;const path=data.path||'';
   if(/\.(tex|sty)$/i.test(path))scan=scanTex(doc.toString());
   else if(/\.bib$/i.test(path))scan={labels:[],commands:[],environments:[],packages:[],classes:[],bibitems:[],entries:parseBib(doc.toString())};
   cache={doc,index,merged:withLiveFile(index||{},path,scan)||{}};
  }
  const result=completionAt(before,{...data,index:cache.merged});
  if(!result||!result.options.length)return null;
  if(result.kind==='command'&&!context.explicit&&/\\\\$/.test(before))return null;
  const offset=pos-before.length;
  return {from:offset+result.from,to:pos,filter:result.filter,...(result.kind==='command'?{validFor:/^\\[a-zA-Z@]*$/}:{}),options:result.options.map(option=>toCompletion(result.kind,option))};
 };
}
const completionTitle={position:90,render:completion=>{if(!completion.title)return null;const line=document.createElement('div');line.className='cm-completionTitle';line.textContent=completion.title;return line;}};
export function mountEditor(parent,{text,onChange,onCompile,onSelection,completion}){
 const listeners=new Set();
 const view=new EditorView({parent,state:EditorState.create({doc:text,extensions:[lineNumbers(),history(),drawSelection(),highlightActiveLine(),highlightSelectionMatches(),bracketMatching(),closeBrackets(),StreamLanguage.define(stex),syntaxHighlighting(writingHighlight),
  tooltips({tooltipSpace:view=>view.dom.getBoundingClientRect()}),
  autocompletion({override:[latexCompletionSource(completion)],icons:false,addToOptions:[completionTitle],maxRenderedOptions:100}),
  keymap.of([{key:'Mod-b',run:view=>formatText(view,'bold')},{key:'Mod-i',run:view=>formatText(view,'italic')},{key:'Mod-Enter',run:()=>{onCompile?.();return true;}},...defaultKeymap,...historyKeymap,...searchKeymap,...closeBracketsKeymap,indentWithTab]),EditorView.lineWrapping,
  EditorView.theme({'&':{height:'100%',fontSize:'var(--ls-editor-size,14px)'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace,SFMono-Regular,monospace',lineHeight:'var(--ls-editor-line-height,1.55)'},'.cm-gutters':{backgroundColor:'transparent',color:'var(--ls-faint,var(--ls-muted))',border:'none'},'&.cm-focused':{outline:'none'},'.cm-activeLine':{backgroundColor:'var(--ls-active-line,var(--ls-bg))'},'.cm-activeLineGutter':{backgroundColor:'transparent',color:'var(--ls-ink)'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--ls-selection)'},'.cm-cursor':{borderLeftColor:'var(--ls-ink)'},'.cm-panels':{backgroundColor:'var(--ls-panel)',color:'var(--ls-ink)'},
   '.cm-tooltip':{border:'1px solid var(--ls-line)',borderRadius:'10px',backgroundColor:'var(--ls-surface,var(--ls-panel))',color:'var(--ls-ink)',boxShadow:'var(--ls-shadow)',overflow:'hidden'},
   '.cm-tooltip.cm-tooltip-autocomplete > ul':{fontFamily:'inherit',maxHeight:'19em',minWidth:'260px',maxWidth:'min(540px,92vw)'},
   '.cm-tooltip.cm-tooltip-autocomplete > ul > li':{padding:'5px 12px',lineHeight:'1.4'},
   '.cm-tooltip-autocomplete ul li[aria-selected]':{backgroundColor:'var(--ls-selection)',color:'var(--ls-ink)'},
   '.cm-completionLabel':{fontFamily:'ui-monospace,SFMono-Regular,monospace',fontSize:'13px'},
   '.cm-completionMatchedText':{textDecoration:'none',fontWeight:'600'},
   '.cm-completionDetail':{fontStyle:'normal',color:'var(--ls-muted)',marginLeft:'12px',fontSize:'12.5px'},
   '.cm-completionTitle':{color:'var(--ls-muted)',fontSize:'12.5px',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'},
   '.cm-tooltip.cm-completionInfo':{padding:'6px 10px',maxWidth:'320px',whiteSpace:'pre-line',fontSize:'12.5px',color:'var(--ls-muted)'},
   '.cm-snippetField':{backgroundColor:'var(--ls-selection)'}}),
  EditorView.updateListener.of(update=>{for(const fn of listeners)fn(update);if(update.docChanged)onChange(update.state.doc.toString());if(update.selectionSet){const line=update.state.doc.lineAt(update.state.selection.main.head).number;onSelection?.(line);}})
 ]})});
 // In-place AI: subscribe to transactions, apply one undoable edit and expose DOM ranges for reveal.
 const onUpdate=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
 const replace=(from,to,insert)=>view.dispatch({changes:{from,to,insert},userEvent:'input.assist',annotations:isolateHistory.of('full'),scrollIntoView:true});
 const range=(from,to)=>viewRange(view,from,to),show=(from,to)=>showRange(view,from,to);
 return {view,onUpdate,replace,range,show,format:kind=>formatText(view,kind),getText:()=>view.state.doc.toString(),setText:next=>{if(next!==view.state.doc.toString())view.dispatch({changes:{from:0,to:view.state.doc.length,insert:next}});},jump:line=>{const n=view.state.doc.line(Math.min(Math.max(1,line),view.state.doc.lines));view.dispatch({selection:{anchor:n.from},effects:EditorView.scrollIntoView(n.from,{y:'center'})});view.focus();},destroy:()=>{listeners.clear();view.destroy();}};
}
