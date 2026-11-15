// Next Space In-place AI for LaTeX Studio. Uses only the host-provided `assistKit` SDK.
// Writes go into the live CodeMirror buffer (undoable, then saved with the normal
// compare-and-swap write), or through revision-checked file writes for other files.
const LINES=200;
const numbered=(text,from=1,to)=>{const lines=text.split('\n'),first=Math.max(1,from|0||1),last=Math.min(lines.length,to||first+LINES-1,first+399);return {fromLine:first,toLine:last,lineCount:lines.length,text:lines.slice(first-1,last).map((l,i)=>first+i+'| '+l).join('\n')};};
const subjectKey=(projectId,path)=>('latex-studio:'+projectId+':'+path).slice(0,900);
// Deletion keeps the whole text in its undo receipt. The host reads and writes text files up to
// 2 MiB; half of that covers every ordinary source and bibliography while bounding the receipt.
export const RESTORE_BYTES=1024*1024;
export const ENGINES=['pdflatex','xelatex','lualatex'];
const utf8Bytes=value=>new TextEncoder().encode(value).length;
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
 * env: {live, editor, request, flush, loadFile, refreshFiles, readOnly, applyProject, compile}
 *  live.project/live.file/live.session/live.standing are the StudioView's current values.
 *  loadFile is the interface's guarded file switch: it saves the open file first and returns
 *  false (switching nothing) when unsaved edits cannot be saved.
 */
export function latexAssistProvider(kit,env){
 const {live,editor,request}=env,o=kit.objectSchema,text=kit.textSchema;
 const path=text(1024),line={type:'integer',minimum:1,maximum:1000000};
 const projectId=()=>{const id=live.project?.id;if(!id)throw Error('请先打开 LaTeX 项目。 / Open a LaTeX project first.');return id;};
 const sources=()=>live.file&&editor.current?{[live.file.path]:editor.current.getText()}:{};
 const openText=p=>live.file?.path===p&&editor.current?editor.current.getText():null;
 const changed=Error('文件已被修改，未撤销。 / The file changed afterwards; it was kept.');
 const settingChanged=Error('设置已被修改，未撤销。 / The setting changed afterwards; it was kept.');

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
   // Lines outside CodeMirror's viewport have no DOM, so the host asks the editor to scroll.
   show:(from,to)=>handle.show(from,to),
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
  {name:'build_errors',description:'Latest compile status with TeX errors (file, line, message) and warning count.',parameters:o({},[])},
  {name:'git_status',description:'Git branch, changed files and the last commits of this project (as in the Git panel).',parameters:o({},[])},
  {name:'git_diff',description:'Diff of one changed file against the last commit (as in the Git panel), at most 24000 characters.',parameters:o({path},['path'])}
 ];
 const navigation=[
  {name:'open_file',description:'Open another project file in this editor, optionally at a line. Afterwards, edit that file only with edit_file; the captured selection is no longer editable.',parameters:o({path,line},['path'])},
  {name:'show_line',description:'Scroll the open file to a line and place the cursor there.',parameters:o({line},['line'])},
  {name:'compile',description:'Save and build the PDF now (the Compile button). Then use build_errors for the result.',parameters:o({},[])}
 ];

 async function read(name,args){
  const id=projectId();
  if(name==='read_file'){const own=openText(args.path);if(own!==null)return {path:args.path,...numbered(own,args.from_line,args.to_line)};return request('read',{projectId:id,path:args.path,fromLine:args.from_line||1,toLine:args.to_line||(args.from_line||1)+LINES-1});}
  if(name==='search')return request('search',{projectId:id,query:args.query,path:args.path,sources:sources()});
  if(name==='outline'){const value=await request('outline',{projectId:id,sources:sources()});return {main:live.project?.main,entries:(value.entries||[]).slice(0,300).map(e=>({path:e.path,line:e.line,level:e.level,title:e.title}))};}
  if(name==='list_files')return {files:(await request('tree',{projectId:id})).files.filter(f=>f.text).map(f=>f.path).slice(0,2000)};
  if(name==='build_errors')return request('errors',{projectId:id});
  if(name==='git_status'){const g=await request('git-status',{projectId:id});return {repository:g.repository,branch:g.branch,remote:g.remote,upstream:g.upstream,files:(g.files||[]).slice(0,500),history:g.history||[]};}
  if(name==='git_diff'){const {diff=''}=await request('git-diff',{projectId:id,path:args.path});return {path:args.path,diff:diff.slice(0,24000),truncated:diff.length>24000};}
  throw Error('Undeclared read '+name);
 }
 async function navigate(name,args){
  if(name==='open_file'){if(!await env.loadFile(args.path,{line:args.line}))throw Error('无法打开该文件。 / The file could not be opened.');return {path:args.path,line:args.line||1};}
  if(name==='show_line'){if(!editor.current)throw Error('No open file');editor.current.jump(args.line);return {path:live.file?.path,line:args.line};}
  if(name==='compile'){if(!env.compile||!await env.compile())throw Error('未编译：当前文件有未保存且无法保存的修改。 / Not built: the open file has unsaved changes that cannot be saved.');return {started:true};}
  throw Error('Undeclared navigation '+name);
 }
 const unsaved=()=>Error('当前文件有未保存且无法保存的修改，编辑器未切换。 / The open file has unsaved changes that cannot be saved; the editor was not switched.');
 // Host review: open the captured file again (the interface's guarded switch; a no-op when open).
 async function reopen(locator){
  if(!locator||locator.projectId!==live.project?.id)throw Error('该文件属于另一个项目。 / That file belongs to another project.');
  if(live.file?.path===locator.path&&editor.current)return session();
  if(!await env.loadFile(locator.path))throw unsaved();
  return session();
 }
 // Open a project text file for review through the guarded switch. A missing or binary file, or
 // an open file whose unsaved edits cannot be saved, is not switched to (false).
 async function openFile(p){
  if(live.file?.path===p&&editor.current)return true;
  const id=live.project?.id;if(!id)return false;
  const entry=await fileEntry(id,p).catch(()=>null);if(!entry?.text)return false;
  return Boolean(await env.loadFile(p).catch(()=>false));
 }
 const fileEntry=async(id,p)=>(await request('tree',{projectId:id})).files.find(f=>f.path===p)||null;
 const mainOf=async id=>(await request('projects')).projects.find(p=>p.id===id)?.main;
 async function configure(id,changes){const p=await request('configure',{projectId:id,changes});if(live.project?.id===id)await env.applyProject?.(p);return p;}
 // Rename and delete rebuild a file from its text, so only text the host can write back byte for
 // byte is accepted: a text-type file, valid UTF-8 (no U+FFFD after decoding), within the bounds.
 async function exactText(id,p,limit){
  const entry=await fileEntry(id,p);if(!entry)throw Error('文件不存在。 / No such file: '+p);
  if(!entry.text)throw Error('二进制文件无法逐字节恢复，未提供此操作。 / '+p+' is not a text file; its bytes could not be restored exactly, so this is not offered.');
  const file=await request('read',{projectId:id,path:p}).catch(e=>{throw /too large/i.test(e.message)?Error('文件超过 2 MiB，无法逐字节恢复。 / '+p+' is larger than 2 MiB; it could not be restored exactly.'):e;});
  if(file.text.includes('\uFFFD'))throw Error('文件不是有效的 UTF-8，无法逐字节恢复。 / '+p+' is not valid UTF-8 text; its bytes could not be restored exactly.');
  if(limit&&utf8Bytes(file.text)>limit)throw Error('文件超过 1 MiB，撤销无法保留全部内容，未删除。 / '+p+' is larger than 1 MiB; the undo could not keep its whole text, so it was not deleted.');
  return file;
 }
 // The open file is about to move or disappear: save it first, never discard unsaved edits.
 async function leaving(id,p){
  if(live.project?.id!==id||live.file?.path!==p)return false;
  if(!await env.flush())throw Error('该文件有未保存且无法保存的修改，未改动。 / This file has unsaved changes that cannot be saved; nothing was changed.');
  return true;
 }
 const own=(p,s)=>{if(p===s.path)throw Error('不能重命名或删除本次会话正在编辑的文件。 / The file this session edits cannot be renamed or deleted.');};
 const exists=(p,e)=>e.status===409?Error('目标已存在。 / '+p+' already exists.'):/unavailable|ENOENT/i.test(e.message)?Error('目标文件夹不存在。 / The folder for '+p+' does not exist.'):e;
 // Move text from one path to another: write the copy, carry the main setting, remove the original
 // only if unchanged. A failure takes back what was done, so the project is never left half moved.
 async function move(id,from,to,revision,carryMain){
  const copy=await request('write',{projectId:id,path:to,text:(await request('read',{projectId:id,path:from})).text,baseRevision:null}).catch(e=>{throw exists(to,e);});
  if(copy.revision!==revision){await request('remove-created',{projectId:id,path:to,revision:copy.revision}).catch(()=>{});throw changed;}
  let moved=false;
  try{if(carryMain){await configure(id,{main:to});moved=true;}await request('remove-created',{projectId:id,path:from,revision});}
  catch(e){if(moved)await configure(id,{main:from}).catch(()=>{});await request('remove-created',{projectId:id,path:to,revision}).catch(()=>{});throw e.status===409?changed:e;}
  await env.refreshFiles();
 }

 // Revision-checked whole-file write for files other than the captured one.
 async function writeFile(id,p,next,baseRevision){
  if(live.file?.path===p&&!await env.flush())throw Error('该文件有未保存的冲突。 / This file has an unsaved conflict.');
  const saved=await request('write',{projectId:id,path:p,text:next,baseRevision});
  if(live.project?.id===id&&live.file?.path===p)await env.loadFile(p);
  return saved;
 }
 // Host review: scroll the open file to the passage an edit_file change speaks of, without
 // touching selection or focus. Applied changes are found by their new text, pending ones by the
 // expected text, else the declared lines (clamped). Another file is opened first (guarded switch).
 function showLines(args){
  const handle=editor.current;if(!handle?.show||live.file?.path!==args.path)return false;
  const lines=handle.getText().split('\n'),count=v=>String(v??'').split('\n').length;
  let at=locateLines(lines,{...args,expected:args.text}),n=count(args.text);
  if(at<0){at=locateLines(lines,args);n=count(args.expected);}
  if(at<0){at=Math.min(Math.max(0,(args.from_line|0)-1),lines.length-1);n=Math.max(1,(args.to_line|0)-at);}
  const from=lines.slice(0,at).reduce((sum,l)=>sum+l.length+1,0);
  handle.show(from,from+lines.slice(at,at+n).join('\n').length);return true;
 }
 const extraActions=[
  {name:'create_file',description:'Create a new text file in this project (fails if it exists). Undo removes it only while unchanged. Add \\input/\\include separately if needed.',
   parameters:o({path,text:text(32000)},['path','text']),
   // Shown in the host's review as a new file's whole text.
   describe:args=>({kind:'text',label:args.path,anchor:'file:'+args.path,arg:['text'],before:'',after:args.text}),
   show:()=>false,
   async apply(args,s){const saved=await request('write',{projectId:s.projectId,path:args.path,text:args.text,baseRevision:null});await env.refreshFiles();return {projectId:s.projectId,path:args.path,revision:saved.revision};},
   async undo(r){if(live.file?.path===r.path&&live.project?.id===r.projectId){if(!await env.flush())throw changed;await env.loadFile(live.project.main);}await request('remove-created',r).catch(e=>{throw e.status===409?changed:e;});await env.refreshFiles();}},
  {name:'edit_file',description:'Replace whole lines from_line..to_line of another project file (not the captured file; use replace_lines there). expected must equal those lines exactly; read them first.',
   parameters:o({path,from_line:line,to_line:line,expected:text(32000),text:text(32000)},['path','from_line','to_line','expected','text']),
   // One reviewable change per passage: the file path groups them, the expected lines are the "before".
   describe:args=>({kind:'text',label:args.path,anchor:'file:'+args.path+':'+args.from_line,arg:['text'],before:args.expected,after:args.text}),
   show:args=>live.file?.path===args.path?showLines(args):openFile(args.path).then(ok=>ok&&showLines(args)),
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
   async undo(r){const current=await request('read',{projectId:r.projectId,path:r.path});if(current.revision!==r.revision)throw changed;await writeFile(r.projectId,r.path,r.before,r.revision);}},
  {name:'rename_file',description:'Rename or move a project text file to a new path in an existing folder (fails if that path exists). The main-file setting and the open editor follow the file. References such as \\input are not updated; use edit_file for them. Not the captured file. Undo moves it back only while it is unchanged.',
   parameters:o({path,to:path},['path','to']),
   describe:args=>({kind:'fields',label:'重命名 / Rename · '+args.path,anchor:'file:'+args.path,before:{path:args.path},after:{path:args.to}}),
   // The renamed file is opened where it now is (pending: where it still is).
   show:async args=>await openFile(args.to)||openFile(args.path),
   async apply(args,s){
    const id=s.projectId;own(args.path,s);if(args.to===args.path)throw Error('新旧路径相同。 / The new path is the same.');
    const file=await exactText(id,args.path),main=await mainOf(id)===args.path,open=await leaving(id,args.path);
    await move(id,args.path,args.to,file.revision,main);
    if(open)await env.loadFile(args.to);
    return {projectId:id,path:args.path,to:args.to,revision:file.revision,main};
   },
   async undo(r){
    const current=await request('read',{projectId:r.projectId,path:r.to}).catch(()=>{throw changed;});if(current.revision!==r.revision)throw changed;
    const open=await leaving(r.projectId,r.to);
    await move(r.projectId,r.to,r.path,r.revision,r.main&&await mainOf(r.projectId)===r.to);
    if(open)await env.loadFile(r.path);
   }},
  {name:'delete_file',description:'Delete a project text file (UTF-8, at most 1 MiB). Not the main file and not the captured file; binary or larger files are refused because the undo could not restore them exactly. References such as \\input are not updated. Undo restores the exact bytes under the same path while that path is free.',
   parameters:o({path},['path']),
   describe:args=>({kind:'entity',label:'删除文件 / Delete file · '+args.path,anchor:'file:'+args.path,before:{path:args.path},after:{}}),
   show:args=>openFile(args.path),
   async apply(args,s){
    const id=s.projectId;own(args.path,s);
    if(await mainOf(id)===args.path)throw Error('不能删除主文件；请先用 set_main_file 换主文件。 / The main file cannot be deleted; choose another main file first.');
    const file=await exactText(id,args.path,RESTORE_BYTES);
    if(await leaving(id,args.path)&&!await env.loadFile(live.project.main))throw unsaved();
    await request('remove-created',{projectId:id,path:args.path,revision:file.revision}).catch(e=>{throw e.status===409?changed:e;});
    await env.refreshFiles();
    return {projectId:id,path:args.path,revision:file.revision,text:file.text};
   },
   async undo(r){
    const saved=await request('write',{projectId:r.projectId,path:r.path,text:r.text,baseRevision:null}).catch(e=>{throw e.status===409?Error('该路径已有文件，未恢复。 / A file now exists at '+r.path+'; it was kept and nothing was restored.'):e;});
    await env.refreshFiles();
    if(saved.revision!==r.revision)throw Error('恢复后的内容与原文件不同。 / The restored file differs from the deleted one.');
   }},
  {name:'set_main_file',description:'Choose the main .tex file that is compiled (Settings → Main file). expected must be the current main file (context.main). Undo restores it while the setting is unchanged.',
   parameters:o({path,expected:path},['path','expected']),
   describe:args=>({kind:'fields',label:'主文件 / Main file',anchor:'setting:main',before:{main:args.expected},after:{main:args.path}}),
   show:()=>false,
   async apply(args,s){
    const now=await mainOf(s.projectId);if(now!==args.expected)throw Error('主文件已变化。 / The main file is now '+now+'; read the context again.');
    await configure(s.projectId,{main:args.path});return {projectId:s.projectId,from:args.expected,to:args.path};
   },
   async undo(r){if(await mainOf(r.projectId)!==r.to)throw settingChanged;await configure(r.projectId,{main:r.from});}},
  {name:'set_engine',description:'Choose the TeX engine (Settings → Engine): pdflatex, xelatex or lualatex. expected must be the current engine (context.engine). Undo restores it while the setting is unchanged.',
   parameters:o({engine:text(16),expected:text(16)},['engine','expected']),
   describe:args=>({kind:'fields',label:'编译引擎 / Engine',anchor:'setting:engine',before:{engine:args.expected},after:{engine:args.engine}}),
   show:()=>false,
   async apply(args,s){
    if(!ENGINES.includes(args.engine))throw Error('未知引擎。 / Unknown engine; use pdflatex, xelatex or lualatex.');
    const now=(await request('projects')).projects.find(p=>p.id===s.projectId)?.engine;if(now!==args.expected)throw Error('引擎已变化。 / The engine is now '+now+'; read the context again.');
    await configure(s.projectId,{engine:args.engine});return {projectId:s.projectId,from:args.expected,to:args.engine};
   },
   async undo(r){if((await request('projects')).projects.find(p=>p.id===r.projectId)?.engine!==r.to)throw settingChanged;await configure(r.projectId,{engine:r.from});}}
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
 return kit.textRangeProvider({focused:()=>Boolean(editor.current?.view.hasFocus),session,describe,read,navigate,reopen,extraActions});
}
