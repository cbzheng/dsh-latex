// Next Space In-place AI for LaTeX Studio. Uses only the host-provided `assistKit` SDK.
// Writes go into the live CodeMirror buffer (undoable, then saved with the normal
// compare-and-swap write), or through revision-checked file writes for other files.
const LINES=200;
const numbered=(text,from=1,to)=>{const lines=text.split('\n'),first=Math.max(1,from|0||1),last=Math.min(lines.length,to||first+LINES-1,first+399);return {fromLine:first,toLine:last,lineCount:lines.length,text:lines.slice(first-1,last).map((l,i)=>first+i+'| '+l).join('\n')};};
const subjectKey=(projectId,path)=>('latex-studio:'+projectId+':'+path).slice(0,900);
// Index of the first of the expected whole lines. Earlier accepted changes in the same file move
// later ones, so a miss at the given numbers falls back to the nearest exact match by content.
export function locateLines(lines,args){
 const want=String(args.expected).split('\n'),same=i=>i>=0&&i+want.length<=lines.length&&want.every((line,k)=>lines[i+k]===line);
 if(args.to_line>=args.from_line&&args.to_line-args.from_line+1===want.length&&same(args.from_line-1))return args.from_line-1;
 if(!args.expected)return -1;
 let best=-1;
 for(let i=0;i+want.length<=lines.length;i++)if(same(i)&&(best<0||Math.abs(i-(args.from_line-1))<Math.abs(best-(args.from_line-1))))best=i;
 return best;
}

/**
 * env: {live, editor, request, flush, loadFile, refreshFiles, readOnly, t}
 *  live.project/live.file/live.session/live.standing are the StudioView's current values.
 */
export function latexAssistProvider(kit,env){
 const {live,editor,request}=env,o=kit.objectSchema,text=kit.textSchema;
 const path=text(1024),line={type:'integer',minimum:1,maximum:1000000};
 const projectId=()=>{const id=live.project?.id;if(!id)throw Error('请先打开 LaTeX 项目。 / Open a LaTeX project first.');return id;};
 const sources=()=>live.file&&editor.current?{[live.file.path]:editor.current.getText()}:{};
 const openText=p=>live.file?.path===p&&editor.current?editor.current.getText():null;
 const changed=Error('文件已被修改，未撤销。 / The file changed afterwards; it was kept.');

 // A session is one editor instance showing one file. Switching files ends direct edits.
 function session(){
  const handle=editor.current,file=live.file,project=live.project;if(!handle||!file||!project)return null;
  if(live.session?.handle===handle)return live.session;
  const s={handle,path:file.path,projectId:project.id,
   text:()=>handle.getText(),
   selection:()=>{const r=handle.view.state.selection.main;return {from:r.from,to:r.to};},
   replace:(from,to,insert)=>handle.replace(from,to,insert),
   onChange:fn=>handle.onUpdate(u=>{if(u.docChanged)fn((pos,assoc)=>u.changes.mapPos(pos,assoc));}),
   domRange:(from,to)=>handle.range(from,to),
   async flush(){if(editor.current===handle)await env.flush();},
   async save(){
    if(editor.current===handle){if(!await env.flush())throw Error('保存被拒绝：文件已在外部修改。 / Save refused: the file changed outside this editor.');return {revision:live.file.revision};}
    return {revision:(await request('read',{projectId:s.projectId,path:s.path})).revision};
   }};
  live.session=s;return s;
 }

 const reads=[
  {name:'read_file',description:'Read numbered lines of any project text file (default 200 lines from from_line). The open file includes unsaved edits.',parameters:o({path,from_line:line,to_line:line},['path'])},
  {name:'search',description:'Case-insensitive literal search across project text files, or one file when path is given. Returns path, line and text.',parameters:o({query:text(200),path},['query'])},
  {name:'outline',description:'Section outline of the document from the main file, with file paths and line numbers.',parameters:o({},[])},
  {name:'list_files',description:'List project files that can be edited as text.',parameters:o({},[])},
  {name:'build_errors',description:'Latest compile status with TeX errors (file, line, message) and warning count.',parameters:o({},[])}
 ];
 const navigation=[
  {name:'open_file',description:'Open another project file in this editor, optionally at a line. Afterwards, edit that file only with edit_file; the captured selection is no longer editable.',parameters:o({path,line},['path'])},
  {name:'show_line',description:'Scroll the open file to a line and place the cursor there.',parameters:o({line},['line'])}
 ];

 async function read(name,args){
  const id=projectId();
  if(name==='read_file'){const own=openText(args.path);if(own!==null)return {path:args.path,...numbered(own,args.from_line,args.to_line)};return request('read',{projectId:id,path:args.path,fromLine:args.from_line||1,toLine:args.to_line||(args.from_line||1)+LINES-1});}
  if(name==='search')return request('search',{projectId:id,query:args.query,path:args.path,sources:sources()});
  if(name==='outline'){const value=await request('outline',{projectId:id,sources:sources()});return {main:live.project?.main,entries:(value.entries||[]).slice(0,300).map(e=>({path:e.path,line:e.line,level:e.level,title:e.title}))};}
  if(name==='list_files')return {files:(await request('tree',{projectId:id})).files.filter(f=>f.text).map(f=>f.path).slice(0,2000)};
  if(name==='build_errors')return request('errors',{projectId:id});
  throw Error('Undeclared read '+name);
 }
 async function navigate(name,args){
  if(name==='open_file'){if(!await env.loadFile(args.path,{line:args.line}))throw Error('无法打开该文件。 / The file could not be opened.');return {path:args.path,line:args.line||1};}
  if(name==='show_line'){if(!editor.current)throw Error('No open file');editor.current.jump(args.line);return {path:live.file?.path,line:args.line};}
  throw Error('Undeclared navigation '+name);
 }

 // Revision-checked whole-file write for files other than the captured one.
 async function writeFile(id,p,next,baseRevision){
  if(live.file?.path===p&&!await env.flush())throw Error('该文件有未保存的冲突。 / This file has an unsaved conflict.');
  const saved=await request('write',{projectId:id,path:p,text:next,baseRevision});
  if(live.project?.id===id&&live.file?.path===p)await env.loadFile(p);
  return saved;
 }
 const extraActions=[
  {name:'create_file',description:'Create a new text file in this project (fails if it exists). Undo removes it only while unchanged. Add \\input/\\include separately if needed.',
   parameters:o({path,text:text(32000)},['path','text']),
   // Shown in the host's review as a new file's whole text.
   describe:args=>({kind:'text',label:args.path,anchor:'file:'+args.path,arg:['text'],before:'',after:args.text}),
   async apply(args,s){const saved=await request('write',{projectId:s.projectId,path:args.path,text:args.text,baseRevision:null});await env.refreshFiles();return {projectId:s.projectId,path:args.path,revision:saved.revision};},
   async undo(r){if(live.file?.path===r.path&&live.project?.id===r.projectId){if(!await env.flush())throw changed;await env.loadFile(live.project.main);}await request('remove-created',r).catch(e=>{throw e.status===409?changed:e;});await env.refreshFiles();}},
  {name:'edit_file',description:'Replace whole lines from_line..to_line of another project file (not the captured file; use replace_lines there). expected must equal those lines exactly; read them first.',
   parameters:o({path,from_line:line,to_line:line,expected:text(32000),text:text(32000)},['path','from_line','to_line','expected','text']),
   // One reviewable change per passage: the file path groups them, the expected lines are the "before".
   describe:args=>({kind:'text',label:args.path,anchor:'file:'+args.path+':'+args.from_line,arg:['text'],before:args.expected,after:args.text}),
   async apply(args,s){
    if(args.path===s.path)throw Error('请用 replace_lines 修改当前文件。 / Use replace_lines for the captured file.');
    if(live.file?.path===args.path&&!await env.flush())throw changed;
    const current=await request('read',{projectId:s.projectId,path:args.path}),lines=current.text.split('\n');
    const at=locateLines(lines,args);
    if(at<0&&args.to_line>lines.length)throw Error('行号超出文件范围。 / Line range is outside the file.');
    if(at<0)throw Error('这些行已有变化，请重新读取。 / Those lines changed; read them again.');
    lines.splice(at,args.expected.split('\n').length,...args.text.split('\n'));
    const saved=await writeFile(s.projectId,args.path,lines.join('\n'),current.revision);
    return {projectId:s.projectId,path:args.path,before:current.text,revision:saved.revision};
   },
   async undo(r){const current=await request('read',{projectId:r.projectId,path:r.path});if(current.revision!==r.revision)throw changed;await writeFile(r.projectId,r.path,r.before,r.revision);}}
 ];

 function describe(s){
  const p=live.project,job=live.job||{};
  return {
   label:p.title+' · '+s.path,
   readOnly:Boolean(env.readOnly?.()||live.conflict),
   subject:{key:subjectKey(s.projectId,s.path),locator:{projectId:s.projectId,path:s.path},revision:live.file?.path===s.path?live.file.revision:'unknown'},
   ...(live.standing?.projectId===s.projectId?{standing:live.standing.value}:{}),
   context:{app:'LaTeX Studio',file:s.path,main:p.main,engine:p.engine,unsaved:Boolean(live.dirty),build:{phase:job.phase||'idle',...(job.phase==='error'&&job.message?{message:String(job.message).slice(0,400)}:{})},
    hint:'Line numbers refer to the current file. Use replace_selection/insert_at_cursor for the captured place, replace_lines for elsewhere in this file, and the declared reads for other files instead of asking the user.'},
   reads,navigation
  };
 }
 return kit.textRangeProvider({focused:()=>Boolean(editor.current?.view.hasFocus),session,describe,read,navigate,extraActions});
}
