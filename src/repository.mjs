import {check,redact} from './util.mjs';

// Never accept embedded credentials. Authentication belongs to Git/SSH/gh.
export function repositoryInfo(value){
 check(typeof value==='string'&&value.trim().length<=2048,'Enter a GitHub link or HTTPS/SSH Git URL');
 let input=value.trim();check(input&&!/[\s\u0000-\u001f\u007f]/.test(input),'Enter a valid repository URL');
 if(/^github\.com\//i.test(input))input='https://'+input;
 const shorthand=input.match(/^([\w.-]+)\/([\w.-]+)$/);
 if(shorthand)input='https://github.com/'+shorthand[1]+'/'+shorthand[2];
 let url=input,host,path,branch=null;
 const scp=input.match(/^git@([\w.-]+):([^?#]+)$/);
 if(scp){host=scp[1].toLowerCase();path=scp[2];}
 else{
  let parsed;try{parsed=new URL(input);}catch{check(false,'Use a GitHub repository link or HTTPS/SSH Git URL');}
  check(['https:','ssh:'].includes(parsed.protocol),'Use an HTTPS or SSH Git URL');
  check(!parsed.password&&(!parsed.username||(parsed.protocol==='ssh:'&&parsed.username==='git')),'Repository links must not contain credentials');
  check(!parsed.search||parsed.hostname.toLowerCase()==='github.com'&&[...parsed.searchParams.keys()].every(k=>k==='tab'),'Repository links must not contain query credentials');
  host=parsed.hostname.toLowerCase();path=parsed.pathname.replace(/^\//,'');
  parsed.search='';parsed.hash='';url=parsed.href.replace(/\/$/,'');
 }
 check(host&&path&&!path.includes('\\'),'Invalid repository URL');
 let githubRepo=null,name;
 if(host==='github.com'){
  const parts=path.replace(/\/$/,'').split('/');
  check(parts.length===2||parts.length===4&&parts[2]==='tree','Use the repository link, or a branch link ending in /tree/BRANCH (not a file or folder link)');
  const owner=parts[0],repo=parts[1].replace(/\.git$/i,'');
  check(/^[\w.-]+$/.test(owner)&&owner!=='.'&&owner!=='..'&&/^[\w.-]+$/.test(repo)&&repo!=='.'&&repo!=='..','Invalid GitHub owner or repository');
  if(parts.length===4){try{branch=decodeURIComponent(parts[3]);}catch{check(false,'Invalid branch name');}check(branch&&!branch.startsWith('-')&&!/[\s\u0000-\u001f~^:?*[\\]/.test(branch)&&!branch.includes('..'),'Invalid branch name');}
  githubRepo=owner+'/'+repo;name=repo;
  url=scp?'git@github.com:'+githubRepo+'.git':input.startsWith('ssh:')?'ssh://git@github.com/'+githubRepo+'.git':'https://github.com/'+githubRepo+'.git';
 }else{name=path.split('/').filter(Boolean).at(-1)?.replace(/\.git$/i,'');check(name,'Invalid repository URL');}
 return {url,name,branch,githubRepo};
}
export function visibleRemote(value){
 return redact(value).replace(/(https?:\/\/)[^\s/@]+@/g,'$1[redacted]@').replace(/\?[^#\s]*/g,'?[redacted]');
}
export function sameRepository(a,b){
 if(a===b)return true;
 try{const x=repositoryInfo(a),y=repositoryInfo(b);return x.githubRepo&&y.githubRepo?x.githubRepo.toLowerCase()===y.githubRepo.toLowerCase():x.url===y.url;}catch{return false;}
}
