import React from 'react';
import {createPortal} from 'react-dom';
import {mountEditor} from './editor.mjs';
import {words} from './words.mjs';
import {fileTree,parentFolders,bytesLabel,progressValue} from './project-ui.mjs';
import {latexAssistProvider} from './assist.mjs';
import {gitKind,relativeTime,splitPath,syncCounts,COMPILE_INTERVALS} from './git-ui.mjs';
const h=React.createElement;
export const inject=['slots','layout'];
const baseURL=()=>new URL('dsh-latex/',document.baseURI).href;
export async function request(action,args={}){const response=await fetch(baseURL()+'api',{method:'POST',headers:{'Content-Type':'application/json','X-DSH-LaTeX':'1'},body:JSON.stringify({action,...args})});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.message||'Request failed'),{status:response.status});return value;}
function Icon({name}){const paths={files:'M4 5h6l2 2h8v12H4z',git:'m8 4 8 8M8 4v12m0 0 8-8M6 2h4v4H6zm8 8h4v4h-4zm-8 4h4v4H6z',changes:'m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6z',settings:'M4 7h16M4 17h16M8 4v6m8 4v6',logs:'m5 7 4 4-4 4m7 2h7',back:'m14 5-7 7 7 7',close:'m6 6 12 12M18 6 6 18',forward:'M4 12h16m-6-6 6 6-6 6',plus:'M12 5v14M5 12h14',minus:'M5 12h14',more:'M5 12h.01M12 12h.01M19 12h.01',chevron:'m9 5 7 7-7 7',file:'M6 3h8l4 4v14H6zM14 3v5h5',image:'M4 4h16v16H4zM4 16l5-5 4 4 3-3 4 4M8 8h.01',download:'M12 3v12m-5-5 5 5 5-5M5 20h14',refresh:'M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-1l2 3M4 15l2 3a7 7 0 0 0 12-1',sidebar:'M4 5h16v14H4zM9.5 5v14',outline:'M4 6h16M8 12h12M12 18h8',branch:'M6 3v12M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0M21 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0M18 9a9 9 0 0 1-9 9',pull:'M12 4v11m-4-4 4 4 4-4M5 20h14',push:'M12 20V9m-4 4 4-4 4 4M5 4h14',play:'M8 5.5v13l10.5-6.5z',expand:'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5',collapse:'M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5',itemize:'M10 6h10M10 12h10M10 18h10M5 6h.01M5 12h.01M5 18h.01',enumerate:'M10 6h10M10 12h10M10 18h10M4.5 4.5 6 4v4.5M4.5 8.5H7M4.3 11.3c.3-.6.8-.8 1.3-.8.7 0 1.1.4 1.1 1 0 .9-2.4 1.8-2.4 2.9h2.5M4.4 16.2h2.3l-1.2 1.4c.8 0 1.3.4 1.3 1.1s-.6 1.1-1.3 1.1c-.5 0-1-.2-1.2-.6',figure:'M4 5h16v14H4zM4 16l4.5-4.5 4 4 2.5-2.5L20 18M15.5 9h.01',link:'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',check:'m5 12.5 4.5 4.5L19 7.5',commit:'M3 12h6m6 0h6M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0'};return h('svg',{viewBox:'0 0 24 24',width:20,height:20,fill:'none',stroke:'currentColor',strokeWidth:1.6,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true},h('path',{d:paths[name]||paths.files}));}
const button=(label,action,props={})=>h('button',{type:'button',onClick:action,...props},label);
const icon=(label,name,action,props={})=>button(h(Icon,{name}),action,{'aria-label':label,title:label,...props});
const draftKey=(id,path)=>'latex-studio:draft:'+id+':'+path;
function getDraft(id,path){try{return JSON.parse(sessionStorage.getItem(draftKey(id,path))||'null');}catch{return null;}}
function setDraft(id,path,value){try{if(value)sessionStorage.setItem(draftKey(id,path),JSON.stringify(value));else sessionStorage.removeItem(draftKey(id,path));}catch{}}

function renderTree(nodes,{expanded,setExpanded,current,main,onSelect,t},depth=0){
 return nodes.map(node=>{
  const open=expanded.has(node.path),toggle=()=>setExpanded(previous=>{const next=new Set(previous);if(next.has(node.path))next.delete(node.path);else next.add(node.path);return next;});
  return h('li',{key:node.path,role:'none'},button(h(React.Fragment,null,
   node.directory&&h('span',{className:'ls-tree-chevron '+(open?'is-open':'')},h(Icon,{name:'chevron'})),
   h(Icon,{name:node.directory?'files':node.text?'file':'image'}),h('span',{className:'ls-tree-name'},node.name),
   node.path===main&&h('span',{className:'ls-main-tag'},t.mainTag)),
   node.directory?toggle:()=>onSelect(node.path),{
    role:'treeitem','aria-level':depth+1,'aria-expanded':node.directory?open:undefined,'aria-selected':!node.directory?node.path===current:undefined,
    'aria-current':node.path===current?'page':undefined,'data-file-path':node.path,title:node.path,disabled:!node.directory&&!node.text,
    className:'ls-tree-row '+(node.directory?'is-folder':'is-file'),style:{'--ls-tree-depth':depth},
    onKeyDown:node.directory?event=>{if(event.key==='ArrowRight'&&!open||event.key==='ArrowLeft'&&open){event.preventDefault();toggle();}}:undefined
   }),node.directory&&open&&h('ul',{role:'group'},renderTree(node.children,{expanded,setExpanded,current,main,onSelect,t},depth+1)));
 });
}

function useHostTheme(){
 const read=()=>document.documentElement.dataset.theme||undefined,[theme,setTheme]=React.useState(read);
 React.useEffect(()=>{const observer=new MutationObserver(()=>setTheme(read()));observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});return()=>observer.disconnect();},[]);
 return theme;
}
export function StudioView({language:initialLanguage,instance,configure,registerBeforeLeave,reportState,active=true,pickDirectory,registerAssist,assistKit,readOnly,headerTarget,immersive=false,setImmersive,renderHints}){
 const [language,setLanguage]=React.useState(initialLanguage||(/\ben\b/.test(document.documentElement.lang)?'en':'zh')),t=words[language]||words.zh;
 const [projects,setProjects]=React.useState([]),[project,setProject]=React.useState(null),[files,setFiles]=React.useState([]),[file,setFile]=React.useState(null),[sidebar,setSidebar]=React.useState(false),[sheet,setSheet]=React.useState(''),[openDiff,setOpenDiff]=React.useState(''),[mobile,setMobile]=React.useState('source'),[error,setError]=React.useState(''),[saveState,setSaveState]=React.useState(''),[job,setJob]=React.useState({phase:'idle'}),[proposals,setProposals]=React.useState([]),[folder,setFolder]=React.useState(null),[mode,setMode]=React.useState('open'),[name,setName]=React.useState(''),[url,setURL]=React.useState(''),[git,setGit]=React.useState(null),[selected,setSelected]=React.useState([]),[message,setMessage]=React.useState(''),[diff,setDiff]=React.useState(''),[busy,setBusy]=React.useState(false),[newPath,setNewPath]=React.useState(''),[settings,setSettings]=React.useState(null),[expanded,setExpanded]=React.useState(new Set()),[remoteURL,setRemoteURL]=React.useState(''),[now,setNow]=React.useState(Date.now()),[cloneJob,setCloneJob]=React.useState(null),[navigatorMode,setNavigatorMode]=React.useState('files'),[outline,setOutline]=React.useState(null),[outlineVersion,setOutlineVersion]=React.useState(0),[outlineCursor,setOutlineCursor]=React.useState(1);
 const editorHost=React.useRef(null),pdfHost=React.useRef(null),editor=React.useRef(null),pdf=React.useRef(null),life=React.useRef({file:null,project:null,dirty:false,saving:null,timer:null,compileTimer:null,generation:0,lastText:null,conflict:false,line:1,alive:true,outlineTimer:null,outlineTarget:null,loadToken:0,pdfJobId:null}),upload=React.useRef(null);
 const live=life.current;live.project=project;live.file=file;live.navigatorMode=navigatorMode;live.active=active;live.job=job;live.saveState=saveState;live.readOnly=readOnly;
 const call=(action,args={})=>request(action,{projectId:project?.id,...args});
 const attempt=async(fn)=>{try{setError('');return await fn();}catch(e){setError(e.message);return null;}};
 async function refreshProjects(){const value=await request('projects');setProjects(value.projects);return value.projects;}
 // Stable project digest for In-place AI; refreshed on structure changes, never per keystroke.
 async function refreshStanding(){const id=live.project?.id;if(!id||!registerAssist)return;try{const value=await request('context',{projectId:id});if(live.project?.id===id)live.standing={projectId:id,value};}catch{}}
 function scheduleStanding(){clearTimeout(live.standingTimer);live.standingTimer=setTimeout(refreshStanding,4000);}
 async function refreshFiles(){const id=live.project?.id;if(!id)return;const tree=await request('tree',{projectId:id});if(live.project?.id===id)setFiles(tree.files);scheduleStanding();}
 function report(){reportState?.({dirty:['dirty','saving'].includes(live.saveState),saving:live.saveState==='saving',projectId:live.project?.id,currentFile:live.file?.path,...(live.cursor?{cursor:live.cursor}:{})});}
 async function flush(){
  clearTimeout(live.timer);if(live.saving){if(!await live.saving)return false;if(live.dirty)return flush();return true;}if(!live.dirty)return true;if(live.conflict)return false;
  const current=live.file,p=live.project;if(!current||!p)return true;const text=editor.current.getText(),generation=live.generation;setSaveState('saving');
  live.saving=(async()=>{try{const saved=await request('write',{projectId:p.id,path:current.path,text,baseRevision:current.revision});if(generation!==live.generation)return true;live.file=saved;setFile(saved);live.dirty=editor.current.getText()!==text;setDraft(p.id,current.path,live.dirty?{text:editor.current.getText(),baseRevision:saved.revision}:null);setSaveState(live.dirty?'dirty':'saved');scheduleStanding();live.changedSinceBuild=true;return true;}catch(e){live.conflict=e.status===409;setSaveState('dirty');setError(e.status===409?t.conflict:e.message||t.writeError);return false;}finally{live.saving=null;}})();return live.saving;
 }
 async function build(){if(!await flush())return;clearTimeout(live.compileTimer);const p=live.project;if(!p)return;live.changedSinceBuild=false;const next=await request('compile',{projectId:p.id});if(p.id===live.project?.id)setJob(next);}
 async function loadFile(path,{line}={}){
  const loadToken=++live.loadToken;if(!await flush()||loadToken!==live.loadToken)return false;clearTimeout(live.timer);const p=live.project;if(!p)return false;
  const read=await request('read',{projectId:p.id,path});if(p.id!==live.project?.id||loadToken!==live.loadToken)return false;const draft=getDraft(p.id,path);live.generation++;live.file=read;live.dirty=Boolean(draft&&draft.text!==read.text);live.conflict=Boolean(live.dirty&&draft.baseRevision!==read.revision);live.lastText=read.text;setFile(read);setSaveState(live.dirty?'dirty':'saved');setMobile('source');setExpanded(previous=>new Set([...previous,...parentFolders(path)]));
  editor.current?.destroy();editor.current=mountEditor(editorHost.current,{text:live.dirty?draft.text:read.text,onCompile:()=>attempt(build),onSelection:n=>{live.line=n;if(live.navigatorMode==='outline')setOutlineCursor(n);const view=editor.current?.view;if(view){const r=view.state.selection.main,doc=view.state.doc;live.cursor={line:n,...(r.empty?{}:{selection:{fromLine:doc.lineAt(r.from).number,toLine:doc.lineAt(r.to).number,chars:r.to-r.from}})};clearTimeout(live.reportTimer);live.reportTimer=setTimeout(report,300);}},onChange:text=>{live.dirty=text!==live.file.text;live.changedSinceBuild=true;setSaveState(live.dirty?'dirty':'saved');setDraft(p.id,path,live.dirty?{text,baseRevision:live.file.revision}:null);clearTimeout(live.timer);clearTimeout(live.outlineTimer);live.outlineTimer=setTimeout(()=>setOutlineVersion(v=>v+1),450);if(!live.conflict)live.timer=setTimeout(flush,650);}});
  live.line=line||1;setOutlineCursor(live.line);if(line)editor.current.jump(line);if(live.conflict)setError(t.conflict);return true;
 }
 async function selectProject(p){if(!await flush())return;clearTimeout(live.compileTimer);live.generation++;live.project=p;live.file=null;live.loadToken++;live.dirty=false;live.conflict=false;editor.current?.destroy();editor.current=null;pdf.current?.destroy();pdf.current=null;setFile(null);setProject(p);setJob({phase:'idle'});setSidebar(window.innerWidth>900);setSheet('');live.changedSinceBuild=false;setExpanded(new Set());setOutline(null);setOutlineCursor(1);live.outlineTarget=null;live.cursor=null;live.session=null;live.standing=null;setError('');configure?.({projectId:p.id});try{sessionStorage.setItem('latex-studio:project',p.id);}catch{}
  const tree=await request('tree',{projectId:p.id});if(live.project?.id!==p.id)return;setFiles(tree.files);if(tree.mainCandidates)p={...p,mainCandidates:tree.mainCandidates};setProject(p);live.project=p;const chosen=tree.files.find(f=>f.path===p.main)||tree.files.find(f=>f.text);refreshStanding();if(chosen)await loadFile(chosen.path);setJob(await request('job',{projectId:p.id}));
 }
 React.useEffect(()=>{live.alive=true;let restoringClone=false;try{const id=sessionStorage.getItem('latex-studio:clone');if(id){restoringClone=true;setCloneJob({id,phase:'running'});setBusy(true);}}catch{}attempt(async()=>{const list=await refreshProjects();let last;try{last=sessionStorage.getItem('latex-studio:project');}catch{}const p=list.find(p=>p.id===(instance?.config?.projectId||last));if(p&&!restoringClone)await selectProject(p);});return()=>{live.alive=false;clearTimeout(live.standingTimer);clearTimeout(live.reportTimer);clearTimeout(live.outlineTimer);clearTimeout(live.timer);clearTimeout(live.compileTimer);editor.current?.destroy();pdf.current?.destroy();};},[]);
 React.useEffect(()=>registerBeforeLeave?.(()=>flush()),[registerBeforeLeave]);
 React.useEffect(()=>{const handler=e=>{if(live.dirty){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[]);
 React.useEffect(()=>{report();},[saveState,project?.id,file?.path]);
 React.useEffect(()=>registerAssist&&assistKit?.textRangeProvider?registerAssist(latexAssistProvider(assistKit,{live,editor,request,flush,loadFile,refreshFiles,readOnly:()=>live.readOnly})):undefined,[registerAssist,assistKit]);
 React.useEffect(()=>{if(!project)return;let stopped=false,running=false;const poll=async()=>{if(stopped||running||!active)return;running=true;try{const id=project.id;const [next,changes]=await Promise.all([request('job',{projectId:id}),request('proposals',{projectId:id})]);if(stopped)return;setJob(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);setProposals(previous=>JSON.stringify(previous)===JSON.stringify(changes.proposals)?previous:changes.proposals);if(live.file&&!live.dirty&&!live.saving){const disk=await request('read',{projectId:id,path:live.file.path});if(!stopped&&disk.revision!==live.file.revision&&!live.dirty)await loadFile(disk.path);}}catch(e){if(!stopped)setError(e.message);}finally{running=false;}};poll();const timer=setInterval(poll,1600);return()=>{stopped=true;clearInterval(timer);};},[project?.id,active]);
 const pdfJob=job.pdfJobId;
 React.useEffect(()=>{if(!project||!pdfJob)return;let stopped=false,held;const controller=new AbortController(),p=project.id;attempt(async()=>{const library=await import(/* @vite-ignore */ baseURL()+'assets/pdf.mjs');if(stopped)return;pdf.current?.destroy();pdf.current=null;live.pdfJobId=null;held=await library.mountPDF(pdfHost.current,baseURL()+'pdf?projectId='+p+'&jobId='+pdfJob,{base:baseURL()+'assets/',signal:controller.signal,onError:e=>setError(e.message),onJump:point=>attempt(async()=>{if(!await flush())return;const target=await request('sync',{projectId:p,jobId:pdfJob,...point});if(target.path)await loadFile(target.path,{line:target.line});})});if(stopped){held?.destroy();return;}pdf.current=held;syncPainting();live.pdfJobId=pdfJob;const target=live.outlineTarget;if(target?.projectId===p){try{const point=await request('sync',{projectId:p,jobId:pdfJob,path:target.path,line:target.line});if(!stopped&&point.page&&target===live.outlineTarget){held?.jump(point);live.outlineTarget=null;}}catch(e){if(!stopped)setError(t.outlineSyncError+' '+e.message);}}});return()=>{stopped=true;controller.abort();held?.destroy();if(pdf.current===held){pdf.current=null;live.pdfJobId=null;}};},[project?.id,pdfJob]);
 // Optional host hints: a window that is fully covered stops painting PDF pages,
 // and under rendering pressure a window in the background keeps fewer page bitmaps.
 const syncPainting=()=>{
  const hint=live.renderHints?.get?.()||{},covered=hint.visibility==='occluded'||hint.visibility==='hidden';
  pdf.current?.setActive(live.active!==false&&!covered);
  pdf.current?.setResidentLimit?.(hint.quality==='reduced'&&hint.visibility!=='focused'?3:7);
 };
 live.renderHints=renderHints;
 React.useEffect(()=>{syncPainting();return renderHints?.subscribe?.(syncPainting);},[active,renderHints]);
 async function browse(path){setFolder(await request('folders',{...(path?{path}:{})}));}
 async function chooseProject(operation='open',seedURL=''){
  if(!await flush())return;setMode(operation);setName(seedURL.split('/').filter(Boolean).pop()?.replace(/\.git$/,'')||'');setURL(seedURL);
  if(operation==='clone'&&seedURL){const info=await request('repo-info',{url:seedURL});setName(info.name);}
  if(operation==='open'&&pickDirectory){const path=await pickDirectory();if(path){const p=await request('open',{path});await refreshProjects();await selectProject(p);}return;}
  await browse();
 }
 async function finishFolder(){if(busy)return;setBusy(true);setCloneJob(null);try{if(mode==='clone'){const next=await request('clone-start',{parent:folder.path,name,url});try{sessionStorage.setItem('latex-studio:clone',next.id);}catch{}setCloneJob(next);return;}const p=await request(mode,{...(mode==='open'?{path:folder.path}:{parent:folder.path,name})});setFolder(null);await refreshProjects();await selectProject(p);}catch(e){setBusy(false);throw e;}finally{if(mode!=='clone')setBusy(false);}}
 React.useEffect(()=>{if(!cloneJob?.id||!['queued','running'].includes(cloneJob.phase))return;let stopped=false,timer;const poll=async()=>{try{const next=await request('clone-job',{id:cloneJob.id});if(stopped)return;setCloneJob(next);if(['success','error','cancelled'].includes(next.phase)){try{sessionStorage.removeItem('latex-studio:clone');}catch{}setBusy(false);if(next.phase==='success'){setFolder(null);await refreshProjects();if(!stopped)await selectProject(next.project);}else if(!folder)setError(next.message||t.cloneCancelled);return;}}catch(e){if(!stopped){setError(e.message);if(e.status===404){try{sessionStorage.removeItem('latex-studio:clone');}catch{}setBusy(false);setCloneJob({id:cloneJob.id,phase:'error',message:e.message});return;}}}if(!stopped)timer=setTimeout(poll,700);};poll();return()=>{stopped=true;clearTimeout(timer);};},[cloneJob?.id]);
 React.useEffect(()=>{if(!project||!sidebar||navigatorMode!=='outline')return;let stopped=false;const timer=setTimeout(async()=>{try{const sources=live.file&&/\.tex$/i.test(live.file.path)&&editor.current?{[live.file.path]:editor.current.getText()}:{};const next=await request('outline',{projectId:project.id,sources});if(!stopped)setOutline(next);}catch(e){if(!stopped)setError(e.message);}},200);return()=>{stopped=true;clearTimeout(timer);};},[project?.id,project?.main,file?.path,file?.revision,navigatorMode,outlineVersion,sidebar]);
 async function jumpOutline(entry){const projectId=live.project?.id;if(!projectId||!await loadFile(entry.path,{line:entry.line})||projectId!==live.project?.id)return;const token=live.loadToken;setOutlineCursor(entry.line);live.outlineTarget={projectId,path:entry.path,line:entry.line};if(window.innerWidth<=700)setSidebar(false);const viewer=pdf.current,jobId=live.pdfJobId;if(viewer&&jobId){try{const point=await request('sync',{projectId,jobId,path:entry.path,line:entry.line});if(point.page&&token===live.loadToken&&viewer===pdf.current&&projectId===live.project?.id){viewer.jump(point);live.outlineTarget=null;}}catch(e){if(token===live.loadToken)setError(t.outlineSyncError+' '+e.message);}}}
 async function cancelClone(){const next=await request('clone-cancel',{id:cloneJob.id});setCloneJob(next);}

 async function loadGit(){const value=await call('git-status');setGit(value);setRemoteURL(value.remote||'');setSelected(value.files.filter(f=>!f.conflict).map(f=>f.path));setDiff('');setOpenDiff('');return value;}
 async function openNavigator(next){setOutlineCursor(live.line);setNavigatorMode(next);setSidebar(true);if(next==='git'){if(!await flush())return;await loadGit();}if(next==='files')setFiles((await call('tree')).files);}
 function toggleSidebar(){setSidebar(open=>{if(!open&&live.navigatorMode==='git')attempt(loadGit);return !open;});}
 async function openSheet(next){if(sheet===next){setSheet('');return;}if(!await flush())return;if(next==='settings')setSettings({...project});setSheet(next);}
 async function showDiff(path){if(openDiff===path){setOpenDiff('');return;}setOpenDiff(path);setDiff('');setDiff((await call('git-diff',{path})).diff);}
 async function gitAction(operation){if(!await flush()||busy)return;setBusy(true);try{const next=await call('git',{operation,paths:selected,message,...(operation==='connect'?{url:remoteURL}:{})});setGit(next);setSelected(next.files.filter(f=>!f.conflict).map(f=>f.path));setMessage('');setOpenDiff('');if(operation==='pull'){const tree=await call('tree');setFiles(tree.files);if(live.file)await loadFile(live.file.path);}}finally{setBusy(false);}}
 async function decide(proposal,accept){if(!await flush())return;await call('decide',{id:proposal.id,accept});setProposals((await call('proposals')).proposals);if(accept&&live.file?.path===proposal.path)await loadFile(proposal.path);if(accept){setFiles((await call('tree')).files);live.changedSinceBuild=true;}}
 async function saveSettings(){const mainChanged=settings.main!==project.main;const p=await call('configure',{changes:{main:settings.main,engine:settings.engine,online:settings.online,compileInterval:Number(settings.compileInterval??5),brief:settings.brief||''}});setProject(p);live.project=p;setSheet('');if(mainChanged&&files.some(f=>f.path===p.main))await loadFile(p.main);await refreshProjects();refreshStanding();}
 async function locate(){if(!await flush()||!pdfJob||!file)return;const target=await call('sync',{jobId:pdfJob,path:file.path,line:live.line});if(target.page){setMobile('pdf');pdf.current?.jump(target);}}
 const compileInterval=project?.compileInterval??5;
 React.useEffect(()=>{if(!project?.id||!compileInterval)return;const timer=setInterval(()=>{if(live.changedSinceBuild&&!live.readOnly&&!['running','queued'].includes(live.job?.phase))attempt(build);},compileInterval*60000);return()=>clearInterval(timer);},[project?.id,compileInterval]);
 React.useLayoutEffect(()=>{const heading=headerTarget?.closest?.('.ns-window-heading');if(!heading||!project)return;heading.dataset.appHeader='true';return()=>{delete heading.dataset.appHeader;};},[headerTarget,project?.id]);
 const running=['running','queued'].includes(job.phase);
 React.useEffect(()=>{if(!running&&!['queued','running'].includes(cloneJob?.phase))return;const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running,cloneJob?.phase]);
 const progress=job.progress||{},percent=progressValue(progress),elapsed=Math.max(0,Math.floor(((job.finished?Date.parse(job.finished):now)-Date.parse(job.started||job.created||new Date(now).toISOString()))/1000));
 const phaseLabel=t['phase_'+(progress.phase||job.phase)]||t.building;
 const mainOptions=[...new Set([...(project?.mainCandidates||[]),...files.filter(f=>/\.tex$/i.test(f.path)).map(f=>f.path)])];
 const outlineRows=outline?.entries||[],outlineMin=Math.min(2,...outlineRows.map(e=>e.level));
 const activeOutline=[...outlineRows,...(outline?.detached||[]).flatMap(group=>group.entries)].filter(e=>e.path===file?.path&&e.line<=outlineCursor).sort((a,b)=>b.line-a.line)[0]?.id;
 const outlineList=(entries,min=outlineMin)=>h('ul',{className:'ls-outline-list'},entries.map(entry=>h('li',{key:entry.id},button(entry.title||t.untitledSection,()=>attempt(()=>jumpOutline(entry)),{'data-outline-path':entry.path,'data-outline-line':entry.line,'aria-current':activeOutline===entry.id?'location':undefined,title:entry.path+':'+entry.line,className:'ls-outline-row',style:{'--ls-outline-depth':Math.max(0,entry.level-min)}}))));
 const cloneRunning=cloneJob&&['queued','running'].includes(cloneJob.phase),cloneProgress=cloneJob?.progress||{},clonePercent=progressValue(cloneProgress);
 const goHome=()=>attempt(async()=>{if(await flush()){clearTimeout(live.compileTimer);setProject(null);live.project=null;live.file=null;live.dirty=false;setFile(null);editor.current?.destroy();pdf.current?.destroy();setSidebar(false);setSheet('');}});
 const fmt=(kind,label,content)=>button(content,()=>editor.current?.format(kind),{'aria-label':label,title:label,disabled:!file||readOnly,onMouseDown:e=>e.preventDefault()});
 const sync=syncCounts(git?.upstream),changed=git?.files||[],selectable=changed.filter(f=>!f.conflict);
 const theme=useHostTheme();

 const toolbarItems=project?h(React.Fragment,null,
   icon(t.sidebar,'sidebar',toggleSidebar,{'aria-pressed':sidebar,className:'ls-sidebar-toggle'}),
   icon(t.openProject,'back',goHome),
   h('span',{className:'ls-title',title:project.root},project.title),
   h('span',{className:'ls-spacer'}),
   proposals.length>0&&button(h(React.Fragment,null,h(Icon,{name:'changes'}),h('span',{className:'ls-badge'},proposals.length)),()=>attempt(()=>openSheet('changes')),{'aria-label':t.changes+' ('+proposals.length+')',title:t.pending}),
   icon(t.logs,'logs',()=>attempt(()=>openSheet('logs')),{'aria-pressed':sheet==='logs'}),
   icon(t.settings,'settings',()=>attempt(()=>openSheet('settings')),{'aria-pressed':sheet==='settings'}),
   setImmersive&&icon(immersive?t.exitImmersive:t.immersive,immersive?'collapse':'expand',()=>setImmersive(!immersive),{'aria-pressed':immersive,'data-immersive-control':true})):
  h(React.Fragment,null,h('span',{className:'ls-title'},t.title),h('span',{className:'ls-spacer'}));
 const headerbar=headerTarget&&project?createPortal(h('div',{className:'ls-headerbar','data-theme':theme,'data-ns-header-control':true},toolbarItems),headerTarget):null;

 const navigatorPanel=project&&h('aside',{className:'ls-panel','aria-label':t.navigator},
  h('header',null,h('div',{className:'ls-navigator-switch',role:'group','aria-label':t.navigator},...['files','outline','git'].map(key=>button(t[key],()=>attempt(()=>openNavigator(key)),{'aria-pressed':navigatorMode===key,key}))),
   window.innerWidth<=700&&icon(t.close,'close',()=>setSidebar(false))),
  navigatorMode==='files'&&h('div',{className:'ls-files'},
   h('form',{className:'ls-new-file',onSubmit:e=>{e.preventDefault();attempt(async()=>{await call('write',{path:newPath,text:'',baseRevision:null});setNewPath('');setFiles((await call('tree')).files);await loadFile(newPath);});}},h('input',{value:newPath,onChange:e=>setNewPath(e.target.value),placeholder:t.path,'aria-label':t.path}),icon(t.newFile,'plus',undefined,{type:'submit',disabled:!newPath})),
   h('ul',{className:'ls-file-list',role:'tree','aria-label':t.files},renderTree(fileTree(files),{expanded,setExpanded,current:file?.path,main:project.main,onSelect:path=>attempt(()=>loadFile(path)),t})),
   button(h(React.Fragment,null,h(Icon,{name:'plus'}),t.upload),()=>upload.current.click(),{className:'ls-upload'}),
   h('input',{type:'file',hidden:true,ref:upload,onChange:e=>attempt(async()=>{const f=e.target.files?.[0];if(!f)return;const bytes=new Uint8Array(await f.arrayBuffer());let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));await call('upload',{path:f.name,base64:btoa(binary)});setFiles((await call('tree')).files);e.target.value='';})})),
  navigatorMode==='outline'&&h('nav',{className:'ls-outline','aria-label':t.outline},!outline?h('p',{role:'status'},t.loadingOutline):h(React.Fragment,null,outlineRows.length?outlineList(outlineRows):h('p',null,t.emptyOutline),...(outline.detached||[]).map(group=>h('details',{key:group.path,className:'ls-outline-detached'},h('summary',{title:group.path},group.path),outlineList(group.entries,Math.min(2,...group.entries.map(e=>e.level))))),outline?.truncated&&h('p',null,t.outlineTruncated))),
  navigatorMode==='git'&&h('div',{className:'ls-git'},!git?h('p',{role:'status',className:'ls-muted-note'},t.working):git.repository?h(React.Fragment,null,
   h('section',{className:'ls-git-card'},
    h('div',{className:'ls-git-branch'},h(Icon,{name:'branch'}),h('strong',{title:git.branch},git.branch||'HEAD'),
     sync.tracked&&h('span',{className:'ls-sync',title:t.syncState},h('span',{'data-zero':!sync.ahead||undefined},'↑',sync.ahead),h('span',{'data-zero':!sync.behind||undefined},'↓',sync.behind))),
    git.remote?h('div',{className:'ls-remote',title:git.remote},h(Icon,{name:'link'}),h('span',null,git.remote.replace(/^https?:\/\/(www\.)?/,'').replace(/\.git$/,''))):
     h('form',{className:'ls-connect',onSubmit:e=>{e.preventDefault();attempt(()=>gitAction('connect'));}},h('input',{value:remoteURL,onChange:e=>setRemoteURL(e.target.value),placeholder:'https://github.com/owner/paper','aria-label':t.remote,autoCapitalize:'none',spellCheck:false}),button(t.connect,undefined,{type:'submit',disabled:busy||!remoteURL.trim()})),
    h('div',{className:'ls-git-sync'},
     button(h(React.Fragment,null,h(Icon,{name:'pull'}),t.pull,sync.behind>0&&h('span',{className:'ls-badge'},sync.behind)),()=>attempt(()=>gitAction('pull')),{disabled:busy,'aria-label':t.pull}),
     button(h(React.Fragment,null,h(Icon,{name:'push'}),t.push,sync.ahead>0&&h('span',{className:'ls-badge'},sync.ahead)),()=>attempt(()=>gitAction('push')),{disabled:busy,'aria-label':t.push}))),
   h('section',{className:'ls-git-section'},
    h('header',null,h('h3',null,t.changesTitle),changed.length>0&&h('span',{className:'ls-count'},changed.length),h('span',{className:'ls-spacer'}),
     selectable.length>1&&h('input',{type:'checkbox','aria-label':t.all,title:t.all,checked:selected.length===selectable.length,onChange:e=>setSelected(e.target.checked?selectable.map(f=>f.path):[])})),
    changed.length?h(React.Fragment,null,
     h('ul',{className:'ls-git-files'},changed.map(f=>{const k=gitKind(f),parts=splitPath(f.path);return h('li',{key:f.path,'data-open':openDiff===f.path||undefined},
      h('div',{className:'ls-git-file','data-kind':k.kind},
       button(h(React.Fragment,null,h('span',{className:'ls-status','data-kind':k.kind,'aria-hidden':true},k.letter),h('span',{className:'ls-git-name'},h('span',null,parts.name),parts.dir&&h('small',null,parts.dir))),()=>attempt(()=>showDiff(f.path)),{title:f.status+' '+f.path,'aria-expanded':openDiff===f.path,'aria-label':t['git_'+k.kind]+' '+f.path}),
       h('input',{type:'checkbox',checked:selected.includes(f.path),disabled:f.conflict,'aria-label':f.path,onChange:e=>setSelected(e.target.checked?[...selected,f.path]:selected.filter(p=>p!==f.path))})),
      openDiff===f.path&&h('div',{className:'ls-diff'},diff?diff.split('\n').slice(0,400).map((line,i)=>h('div',{key:i,'data-line':line.startsWith('+++')||line.startsWith('---')?'meta':line[0]==='+'?'add':line[0]==='-'?'del':line.startsWith('@@')?'hunk':/^(diff|index) /.test(line)?'meta':undefined},line||' ')):h('span',{className:'ls-muted-note'},t.working)));})),
     h('form',{className:'ls-commit',onSubmit:e=>{e.preventDefault();attempt(()=>gitAction('commit'));}},
      h('textarea',{value:message,rows:2,onChange:e=>setMessage(e.target.value),placeholder:t.message,'aria-label':t.message,onKeyDown:e=>{if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)){e.preventDefault();if(selected.length&&message.trim())attempt(()=>gitAction('commit'));}}}),
      button(h(React.Fragment,null,h(Icon,{name:'check'}),t.commit+(selected.length?' · '+selected.length:'')),undefined,{type:'submit',className:'ls-primary',disabled:busy||!selected.length||!message.trim(),'aria-label':t.commit}))):
     h('p',{className:'ls-git-clean'},h(Icon,{name:'check'}),t.clean)),
   git.history.length>0&&h('section',{className:'ls-git-section'},h('header',null,h('h3',null,t.history)),
    h('ol',{className:'ls-timeline'},git.history.map((row,i)=>h('li',{key:row.id,'data-head':i===0||undefined},h('span',{className:'ls-node','aria-hidden':true}),h('div',null,h('span',{className:'ls-commit-message',title:row.message},row.message),h('small',null,h('code',null,row.id.slice(0,7)),' · ',relativeTime(row.date,language,now))))))))
   :h('div',{className:'ls-git-empty'},h(Icon,{name:'branch'}),h('p',null,t.noGit),button(t.init,()=>attempt(()=>gitAction('init')),{disabled:busy,className:'ls-primary'}))));

 const sheetView=sheet&&h('div',{className:'ls-modal-backdrop',onPointerDown:e=>{if(e.target===e.currentTarget)setSheet('');},onKeyDown:e=>{if(e.key==='Escape'){e.preventDefault();setSheet('');}}},h('section',{role:'dialog','aria-modal':true,'aria-label':t[sheet],className:'ls-sheet ls-sheet-'+sheet},
  h('header',null,h('h2',null,t[sheet]),icon(t.close,'close',()=>setSheet(''))),
  sheet==='settings'&&settings&&h('form',{className:'ls-settings',onSubmit:e=>{e.preventDefault();attempt(saveSettings);}},
   h('div',{className:'ls-field-group'},
    h('label',{className:'ls-field'},h('span',null,t.main),h('select',{'aria-label':t.main,value:settings.main,onChange:e=>setSettings({...settings,main:e.target.value})},mainOptions.map(path=>h('option',{key:path,value:path},path)))),
    h('div',{className:'ls-field'},h('span',null,t.engine),h('div',{className:'ls-segmented',role:'radiogroup','aria-label':t.engine},['pdflatex','xelatex','lualatex'].map(engine=>button({pdflatex:'pdfLaTeX',xelatex:'XeLaTeX',lualatex:'LuaLaTeX'}[engine],()=>setSettings({...settings,engine}),{key:engine,role:'radio','aria-checked':settings.engine===engine})))),
    h('label',{className:'ls-field'},h('span',null,t.interval),h('select',{'aria-label':t.interval,value:String(settings.compileInterval??5),onChange:e=>setSettings({...settings,compileInterval:Number(e.target.value)})},COMPILE_INTERVALS.map(n=>h('option',{key:n,value:String(n)},n?t.everyMinutes.replace('{n}',n):t.intervalOff)))),
    h('label',{className:'ls-field ls-switch'},h('span',null,t.online),h('input',{type:'checkbox',role:'switch',checked:settings.online,onChange:e=>setSettings({...settings,online:e.target.checked})})),
    h('div',{className:'ls-field'},h('span',null,t.language),h('div',{className:'ls-segmented',role:'radiogroup','aria-label':t.language},[['zh','中文'],['en','English']].map(([key,label])=>button(label,()=>setLanguage(key),{key,role:'radio','aria-checked':language===key}))))),
   h('label',{className:'ls-brief'},h('span',null,t.brief),h('textarea',{value:settings.brief||'',maxLength:8000,rows:5,placeholder:t.briefHint,onChange:e=>setSettings({...settings,brief:e.target.value})})),
   h('footer',null,button(t.cancel,()=>setSheet('')),button(t.save,undefined,{type:'submit',className:'ls-primary'}))),
  sheet==='logs'&&h('pre',{className:'ls-log'},job.log||job.message||t.noLog),
  sheet==='changes'&&h('div',{className:'ls-proposals'},!proposals.length?h('p',null,t.none):proposals.map(p=>h('article',{key:p.id,className:'ls-proposal'},h('h3',null,p.path),h('p',null,p.summary),h('details',null,h('summary',null,t.before),h('pre',{className:'ls-before'},p.before)),h('details',{open:true},h('summary',null,t.after),h('pre',{className:'ls-after'},p.text)),h('div',{className:'ls-review-actions'},button(t.reject,()=>attempt(()=>decide(p,false))),button(t.accept,()=>attempt(()=>decide(p,true)),{className:'ls-primary'})))))));

 return h('section',{className:'ls-root','data-latex-studio':true,'data-theme':theme,'data-host':headerTarget?'window':'inline','data-immersive':immersive||undefined,'data-mobile-view':mobile,'data-panel':project&&sidebar?navigatorMode:undefined},
  headerTarget?headerbar:h('header',{className:'ls-toolbar'},toolbarItems),
  cloneRunning&&!folder&&h('div',{className:'ls-clone-banner'},h('span',{role:'status'},t['clone_'+(cloneProgress.phase||cloneJob.phase)]||t.cloning),h('progress',{max:100,value:clonePercent,'aria-label':t.cloneProgress}),button(t.cancelClone,()=>attempt(cancelClone))),
  error&&!folder&&h('div',{role:'alert',className:'ls-error'},h('span',null,error),live.conflict&&button(t.recover,()=>navigator.clipboard.writeText(editor.current.getText())),live.conflict&&button(t.reload,()=>attempt(async()=>{const draft=editor.current.getText();setDraft(project.id,file.path,{text:draft,baseRevision:file.revision});live.dirty=false;live.conflict=false;const disk=await call('read',{path:file.path});live.file=disk;setFile(disk);editor.current.setText(disk.text);live.dirty=false;live.conflict=false;setSaveState('saved');setError('');})),icon(t.close,'close',()=>setError(''))),
  !project?h('main',{className:'ls-home'},
   h('div',{className:'ls-welcome'},h('span',{className:'ls-mark','aria-hidden':true},'{Σ}'),h('p',null,t.empty),h('div',{className:'ls-home-actions'},button(t.open,()=>attempt(()=>chooseProject()),{className:'ls-primary'}),button(t.create,()=>attempt(()=>chooseProject('create'))))),
   h('form',{className:'ls-github-import',onSubmit:e=>{e.preventDefault();attempt(()=>chooseProject('clone',url.trim()));}},h('label',null,h('span',null,t.github),h('input',{value:url,onChange:e=>setURL(e.target.value),placeholder:'https://github.com/owner/paper','aria-label':t.url,type:'text',autoCapitalize:'none',autoCorrect:'off',spellCheck:false})),button(t.githubImport,undefined,{type:'submit',disabled:!url.trim()})),
   projects.length>0&&h('section',{className:'ls-recent-section'},h('h2',null,t.recent),h('ul',{className:'ls-recents'},projects.map(p=>h('li',{key:p.id},button(h(React.Fragment,null,h(Icon,{name:'files'}),h('span',{className:'ls-recent-name'},h('strong',null,p.title),h('span',null,p.root))),()=>attempt(()=>selectProject(p)))))))):
  h('div',{className:'ls-work'},
   sidebar&&navigatorPanel,
   h('main',{className:'ls-writing'},
    h('div',{className:'ls-mobile-tabs'},button(t.source,()=>setMobile('source'),{'aria-pressed':mobile==='source'}),button(t.pdf,()=>setMobile('pdf'),{'aria-pressed':mobile==='pdf'})),
    h('section',{className:'ls-source','aria-label':t.source},
     h('div',{className:'ls-filebar'},
      button(h(React.Fragment,null,running?h('span',{className:'ls-spinner','aria-hidden':true}):h(Icon,{name:'play'}),h('span',null,running?t.building:t.compile)),()=>attempt(build),{className:'ls-compile','data-phase':job.phase,title:t.manual,'aria-label':running?t.building:t.compile,disabled:busy}),
      h('span',{className:'ls-current-file',title:file?.path},file?.path||''),
      h('div',{className:'ls-format-actions',role:'toolbar','aria-label':t.format},
       fmt('bold',t.bold,h('strong',null,'B')),fmt('italic',t.italic,h('em',null,'I')),h('span',{className:'ls-divider','aria-hidden':true}),
       fmt('itemize',t.itemize,h(Icon,{name:'itemize'})),fmt('enumerate',t.enumerate,h(Icon,{name:'enumerate'})),fmt('figure',t.figure,h(Icon,{name:'figure'}))),
      h('span',{role:'status',className:'ls-save-state','data-state':saveState||undefined,title:saveState?t[saveState]:''},saveState?t[saveState]:''),
      icon(t.forward,'forward',()=>attempt(locate),{disabled:!pdfJob||!file})),
     project&&(running||job.phase==='error')&&h('div',{className:'ls-build-status '+(job.phase==='error'?'is-error':''),'data-build-phase':progress.phase||job.phase},
      running?h(React.Fragment,null,
       h('div',{className:'ls-build-heading'},h('span',{role:'status',title:job.main||project.main},phaseLabel,job.main?' · '+job.main:'',progress.package?' · '+progress.package:''),h('span',{className:'ls-build-meta'},[Number.isFinite(progress.receivedBytes)?bytesLabel(progress.receivedBytes)+(progress.totalBytes?' / '+bytesLabel(progress.totalBytes):''):'',percent!==undefined?Math.floor(percent)+'%':'',elapsed+'s'].filter(Boolean).join(' · '))),
       h('progress',{max:100,value:percent,'aria-label':phaseLabel}),
       progress.message&&h('span',{className:'ls-build-detail',title:progress.message},progress.message)):
       h('span',{className:'ls-build-failure',role:'alert'},h('strong',null,t.failed),job.message||progress.message||t.buildFailed),
      h('div',{className:'ls-build-actions'},button(t.logs,()=>attempt(()=>openSheet('logs'))),job.phase==='error'&&button(t.retry,()=>attempt(build),{className:'ls-retry'}))),
     h('div',{className:'ls-editor',ref:editorHost})),
    h('section',{className:'ls-preview','aria-label':t.pdf},
     h('div',{className:'ls-pdfbar'},h('span',null,t.pdf),icon(t.zoomOut,'minus',()=>pdf.current?.zoom(1/1.2)),icon(t.zoomIn,'plus',()=>pdf.current?.zoom(1.2)),pdfJob&&h('a',{href:baseURL()+'pdf?projectId='+project.id+'&jobId='+pdfJob,download:project.title+'.pdf',title:t.download,'aria-label':t.download},h(Icon,{name:'download'}))),
     !pdfJob&&h('div',{className:'ls-pdf-empty'},h('p',null,running?phaseLabel:job.phase==='error'?t.buildFailed:t.waiting),job.phase==='error'?button(t.logs,()=>attempt(()=>openSheet('logs'))):!running&&button(t.compile,()=>attempt(build))),h('div',{className:'ls-pdf-scroll',ref:pdfHost})))),
  sheetView,
  folder&&h('div',{className:'ls-modal-backdrop'},h('section',{role:'dialog','aria-modal':true,'aria-label':t[mode],className:'ls-folder-dialog'},
   h('header',null,h('h2',null,t[mode]),icon(t.cancel,'close',()=>setFolder(null),{disabled:busy})),
   mode==='clone'&&h('label',null,t.url,h('input',{value:url,onChange:e=>setURL(e.target.value),'aria-label':t.url,disabled:busy,autoCapitalize:'none',spellCheck:false})),
   mode!=='open'&&h('label',null,t.name,h('input',{value:name,onChange:e=>setName(e.target.value),'aria-label':t.name,disabled:busy})),
   h('div',{className:'ls-folder-path'},icon(t.up,'back',()=>attempt(()=>browse(folder.parent)),{disabled:busy}),h('span',null,folder.path)),
   h('ul',null,folder.folders.map(f=>h('li',{key:f.path},button(h(React.Fragment,null,h(Icon,{name:'files'}),f.name),()=>attempt(()=>browse(f.path)),{disabled:busy})))),
   error&&h('p',{role:'alert',className:'ls-clone-error'},error),
   mode==='clone'&&cloneJob&&h('section',{className:'ls-clone-progress','data-clone-phase':cloneJob.phase},h('div',{role:'status'},t['clone_'+(cloneProgress.phase||cloneJob.phase)]||t.cloning),cloneRunning&&h('progress',{max:100,value:clonePercent,'aria-label':t.cloneProgress}),h('div',{className:'ls-clone-meta'},[clonePercent!==undefined?Math.floor(clonePercent)+'%':'',cloneRunning&&cloneJob.started?Math.max(0,Math.floor((now-Date.parse(cloneJob.started))/1000))+'s':'',cloneProgress.message].filter(Boolean).join(' · ')),cloneJob.message&&h('p',{role:cloneJob.phase==='error'?'alert':undefined},cloneJob.message),cloneJob.retryHint&&h('p',null,cloneJob.retryHint),cloneJob.log&&h('details',null,h('summary',null,t.cloneLog),h('pre',null,cloneJob.log))),
   busy&&mode!=='clone'&&h('p',{role:'status',className:'ls-cloning'},t.working),
   h('footer',null,button(cloneRunning?t.cancelClone:t.cancel,()=>cloneRunning?attempt(cancelClone):setFolder(null),{disabled:busy&&!cloneRunning}),button(busy?t.working:cloneJob?.phase==='error'?t.retry:mode==='open'?t.choose:t[mode],()=>attempt(finishFolder),{className:'ls-primary',disabled:busy||mode==='create'&&!name.trim()||mode==='clone'&&!url.trim()})))));
}

export function apply(ctx){
 const style=document.createElement('style');style.textContent=STYLE;document.head.append(style);ctx.effect(()=>()=>style.remove());
 let picker;ctx.inject(['remoteAccess'],sub=>{if(typeof globalThis.__DSH_DIRECTORY_PICKER__?.pick!=='function')return;return sub.remoteAccess.whenAccess('directoryPicker/pick',()=>{picker=()=>globalThis.__DSH_DIRECTORY_PICKER__.pick();return()=>{picker=null;};});});
 ctx.slots.inject('main',()=>{const dispose=ctx.slots.register({name:'main',key:'latex-studio'},props=>h(StudioView,{...props,pickDirectory:picker}));if(new URL(location.href).searchParams.get('latex')==='1')ctx.layout.selectPanel('latex-studio');return dispose;});
 ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'latex-studio',label:'LaTeX Studio',order:5},()=>h('span',{'aria-hidden':true},'∑')));
 ctx.inject(['nextSpace'],sub=>{
  sub.effect(()=>sub.nextSpace.register({contractVersion:1,id:'latex-studio',kind:'functional',supportsTransfer:false,resourceCreation:false,label:{zh:'LaTeX Studio',en:'LaTeX Studio'},icon:'∑',glyph:{paths:['M7.5 3.5C5 3.5 5.5 6 5.5 8.5S4.5 12 3.5 12c1 0 2 1 2 3.5s-.5 5 2 5','M16.5 3.5c2.5 0 2 2.5 2 5s1 3.5 2 3.5c-1 0-2 1-2 3.5s.5 5-2 5','M15 7.5H9l4 4.5-4 4.5h6']},multiple:true,windowHeader:true,initialState:()=>({})}));
  sub.slots.inject('next-space.view',()=>sub.slots.register({name:'next-space.view',key:'latex-studio'},props=>h(StudioView,{...props,pickDirectory:picker})));
 });
}
