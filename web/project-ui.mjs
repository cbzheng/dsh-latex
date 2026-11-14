// UI projections only: project files and jobs stay authoritative on the Host.
export function fileTree(files){
 const root={children:new Map()};
 for(const file of files){let node=root,path='';const parts=file.path.split('/');for(let index=0;index<parts.length;index++){
  const name=parts[index];path=path?path+'/'+name:name;
  if(!node.children.has(name))node.children.set(name,{name,path,directory:index<parts.length-1,children:new Map()});
  node=node.children.get(name);if(index===parts.length-1)Object.assign(node,file);
 }}
 const sort=node=>[...node.children.values()].sort((a,b)=>Number(b.directory)-Number(a.directory)||a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})).map(item=>({...item,children:sort(item)}));
 return sort(root);
}
export function parentFolders(path){const parts=path.split('/');return parts.slice(0,-1).map((_,i)=>parts.slice(0,i+1).join('/'));}
export function bytesLabel(bytes){if(!Number.isFinite(bytes))return '';if(bytes<1024)return Math.round(bytes)+' B';if(bytes<1024*1024)return (bytes/1024).toFixed(1)+' KiB';return (bytes/(1024*1024)).toFixed(1)+' MiB';}
export function progressValue(progress){if(Number.isFinite(progress?.percent))return Math.min(100,Math.max(0,progress.percent));if(progress?.totalBytes>0&&Number.isFinite(progress.receivedBytes))return Math.min(100,Math.max(0,100*progress.receivedBytes/progress.totalBytes));return undefined;}
