import {EditorState,EditorSelection} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine,drawSelection} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap,indentWithTab,isolateHistory} from '@codemirror/commands';
import {searchKeymap,highlightSelectionMatches} from '@codemirror/search';
import {StreamLanguage,syntaxHighlighting,HighlightStyle,bracketMatching} from '@codemirror/language';
import {stex} from '@codemirror/legacy-modes/mode/stex';
import {autocompletion,closeBrackets,closeBracketsKeymap} from '@codemirror/autocomplete';
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
const commands=['section','subsection','subsubsection','paragraph','textbf','textit','emph','cite','ref','label','begin','end','include','input','includegraphics','caption','footnote','item','frac','sqrt','alpha','beta','gamma','sum','int'];
export function mountEditor(parent,{text,onChange,onCompile,onSelection}){
 const listeners=new Set();
 const view=new EditorView({parent,state:EditorState.create({doc:text,extensions:[lineNumbers(),history(),drawSelection(),highlightActiveLine(),highlightSelectionMatches(),bracketMatching(),closeBrackets(),StreamLanguage.define(stex),syntaxHighlighting(writingHighlight),
  autocompletion({override:[context=>{const match=context.matchBefore(/\\[a-zA-Z]*/);return match?{from:match.from+1,options:commands.map(label=>({label,type:'keyword'}))}:null;}]}),
  keymap.of([{key:'Mod-b',run:view=>formatText(view,'bold')},{key:'Mod-i',run:view=>formatText(view,'italic')},{key:'Mod-Enter',run:()=>{onCompile?.();return true;}},...defaultKeymap,...historyKeymap,...searchKeymap,...closeBracketsKeymap,indentWithTab]),EditorView.lineWrapping,
  EditorView.theme({'&':{height:'100%',fontSize:'var(--ls-editor-size,14px)'},'.cm-scroller':{overflow:'auto',fontFamily:'ui-monospace,SFMono-Regular,monospace',lineHeight:'var(--ls-editor-line-height,1.55)'},'.cm-gutters':{backgroundColor:'transparent',color:'var(--ls-faint,var(--ls-muted))',border:'none'},'&.cm-focused':{outline:'none'},'.cm-activeLine':{backgroundColor:'var(--ls-active-line,var(--ls-bg))'},'.cm-activeLineGutter':{backgroundColor:'transparent',color:'var(--ls-ink)'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground':{backgroundColor:'var(--ls-selection)'},'.cm-cursor':{borderLeftColor:'var(--ls-ink)'},'.cm-panels':{backgroundColor:'var(--ls-panel)',color:'var(--ls-ink)'}}),
  EditorView.updateListener.of(update=>{for(const fn of listeners)fn(update);if(update.docChanged)onChange(update.state.doc.toString());if(update.selectionSet){const line=update.state.doc.lineAt(update.state.selection.main.head).number;onSelection?.(line);}})
 ]})});
 // In-place AI: subscribe to transactions, apply one undoable edit and expose DOM ranges for reveal.
 const onUpdate=fn=>{listeners.add(fn);return()=>listeners.delete(fn);};
 const replace=(from,to,insert)=>view.dispatch({changes:{from,to,insert},userEvent:'input.assist',annotations:isolateHistory.of('full'),scrollIntoView:true});
 const range=(from,to)=>{const a=view.domAtPos(from),b=view.domAtPos(to),r=document.createRange();r.setStart(a.node,a.offset);r.setEnd(b.node,b.offset);return r;};
 return {view,onUpdate,replace,range,format:kind=>formatText(view,kind),getText:()=>view.state.doc.toString(),setText:next=>{if(next!==view.state.doc.toString())view.dispatch({changes:{from:0,to:view.state.doc.length,insert:next}});},jump:line=>{const n=view.state.doc.line(Math.min(Math.max(1,line),view.state.doc.lines));view.dispatch({selection:{anchor:n.from},effects:EditorView.scrollIntoView(n.from,{y:'center'})});view.focus();},destroy:()=>{listeners.clear();view.destroy();}};
}
