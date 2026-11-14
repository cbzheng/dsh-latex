// Pure helpers for the graphical Git view (tested without a browser).
export function gitKind(file){
 if(file.conflict)return {letter:'!',kind:'conflict'};
 const s=file.status||'';
 if(s==='??')return {letter:'U',kind:'untracked'};
 if(s.includes('D'))return {letter:'D',kind:'deleted'};
 if(s.includes('R'))return {letter:'R',kind:'renamed'};
 if(s.includes('A'))return {letter:'A',kind:'added'};
 return {letter:'M',kind:'modified'};
}
export function splitPath(path){const i=path.lastIndexOf('/');return i<0?{name:path,dir:''}:{name:path.slice(i+1),dir:path.slice(0,i)};}
export function syncCounts(upstream){const [ahead,behind]=String(upstream||'').trim().split(/\s+/).map(Number);return {ahead:Number.isFinite(ahead)?ahead:0,behind:Number.isFinite(behind)?behind:0,tracked:Boolean(upstream)};}
export function relativeTime(date,language,now=Date.now()){
 const then=Date.parse(date);if(!Number.isFinite(then))return '';
 const seconds=Math.round((then-now)/1000),abs=Math.abs(seconds);
 const format=new Intl.RelativeTimeFormat(language==='zh'?'zh-CN':'en',{numeric:'auto'});
 for(const [unit,size] of [['year',31536000],['month',2592000],['week',604800],['day',86400],['hour',3600],['minute',60]])if(abs>=size)return format.format(Math.round(seconds/size),unit);
 return format.format(0,'minute');
}
export const COMPILE_INTERVALS=[0,1,2,5,10,15,30];
