import {randomUUID} from 'node:crypto';
export type ChatMember={uid:string;sec_uid:string;nickname:string;alias:string};
export type ChatGroup={id:string;name:string;kind:'普通群'|'粉丝群'|'未知';expected:number|null;short_id?:string;conversation_type?:number;inbox_type?:number};
export type ChatSnapshot={id:string;group:ChatGroup;source:string;origin:'scan'|'import';collected_at:string|null;started_at?:string;imported_at?:string;complete:boolean;reason:string;members:ChatMember[]};
export type PendingRow={sheet:string;row:number;reason:string;values:string[]};
export type ChatBundle={format:'douyin-chat-members';version:1;exported_at:string;snapshots:ChatSnapshot[];unresolved:PendingRow[]};
export type MatchRow=ChatMember&{groups:{id:string;name:string;snapshot_id:string;collected_at:string|null;complete:boolean;side?:string}[];category?:string};
export type ChatResult={kind:'duplicates'|'find'|'compare';queried_at:string;scope:{id:string;name:string;snapshot_id:string;complete:boolean;collected_at:string|null;side?:string}[];complete:boolean;note:string;rows:MatchRow[];target_uid?:string;found?:boolean;status?:string};
export const textValue=(v:unknown,max=300)=>typeof v==='string'?v.slice(0,max):'';
export function reliableUID(v:unknown):string|null{if(typeof v==='number'){if(!Number.isSafeInteger(v)||v<1||String(v).length>15)return null;v=String(v)}return typeof v==='string'&&/^[1-9]\d{0,31}$/.test(v.trim())?v.trim():null}
export function safeGroupID(v:unknown):string|null{if(typeof v==='number'){if(!Number.isSafeInteger(v)||String(v).length>15)return null;v=String(v)}return typeof v==='string'&&v.trim().length>0&&v.length<=150&&!/[\x00-\x1f]/.test(v)?v.trim():null}
export function member(v:any):ChatMember|null{const uid=reliableUID(v?.uid??v?.user_id);if(!uid)return null;return {uid,sec_uid:typeof v.sec_uid==='string'&&/^MS4[A-Za-z0-9_-]{8,195}$/.test(v.sec_uid)?v.sec_uid:'',nickname:textValue(v.nickname),alias:textValue(v.alias??v.group_nickname)}}
export function distinctMembers(rows:ChatMember[]){const map=new Map<string,ChatMember>();for(const r of rows){const old=map.get(r.uid);map.set(r.uid,old?{uid:r.uid,sec_uid:r.sec_uid||old.sec_uid,nickname:r.nickname||old.nickname,alias:r.alias||old.alias}:r)}return [...map.values()]}
export function parseChatJSON(raw:any,source:string):{snapshots:ChatSnapshot[];unresolved:PendingRow[]}{
 const groups=Array.isArray(raw?.snapshots)?raw.snapshots:Array.isArray(raw?.groups)?raw.groups:Array.isArray(raw)?raw:null;if(!groups||groups.length>1000)throw Error('文件需要包含 snapshots 或 groups 数组（最多 1,000 个群）');
 const unresolved:PendingRow[]=Array.isArray(raw?.unresolved)?raw.unresolved.slice(0,300000).map((r:any)=>({sheet:textValue(r.sheet),row:Number.isSafeInteger(r.row)?r.row:0,reason:textValue(r.reason),values:Array.isArray(r.values)?r.values.slice(0,100).map((v:unknown)=>textValue(v)):[]})):[],snapshots:ChatSnapshot[]=[];let total=0;
 for(const [index,g] of groups.entries()){
  const meta=g?.group||g,id=safeGroupID(meta?.id);if(!id)throw Error('第 '+(index+1)+' 个群缺少可靠群 ID');if(!Array.isArray(g.members))throw Error('群 '+id+' 缺少 members 数组');total+=g.members.length;if(total>300000)throw Error('一次导入最多 300,000 行成员');
  const members:ChatMember[]=[];for(const [n,r] of g.members.entries()){const m=member(r);if(m)members.push(m);else unresolved.push({sheet:String(index+1),row:n+1,reason:'缺少可靠 UID 或数字 ID 已丢失精度',values:[textValue(r?.nickname),String(r?.uid??r?.user_id??'')]})}
  const dedup=distinctMembers(members),expected=Number.isSafeInteger(meta.expected)&&meta.expected>=0?meta.expected:Number.isSafeInteger(meta.member_count)&&meta.member_count>=0?meta.member_count:null;
  const complete=g.complete===true&&members.length===g.members.length&&(expected===null||expected===dedup.length);
  snapshots.push({id:randomUUID(),group:{id,name:textValue(meta.name)||id,kind:['普通群','粉丝群'].includes(meta.kind)?meta.kind:'未知',expected},source:textValue(g.source,1000)||source,origin:'import',collected_at:typeof g.collected_at==='string'&&Number.isFinite(Date.parse(g.collected_at))?g.collected_at:null,imported_at:new Date().toISOString(),complete,reason:complete?'来源文件声明完整':textValue(g.reason)||'来源未声明完整或成员数量不一致',members:dedup});
 }
 return {snapshots,unresolved};
}
export function latestGroups(snaps:ChatSnapshot[]):ChatSnapshot[]{const map=new Map<string,ChatSnapshot>();for(const s of snaps){const old=map.get(s.group.id);if(!old||(Date.parse(s.collected_at||s.imported_at||'')||0)>(Date.parse(old.collected_at||old.imported_at||'')||0))map.set(s.group.id,s)}return [...map.values()]}
function union(snaps:ChatSnapshot[],side?:string){const map=new Map<string,MatchRow>();for(const s of latestGroups(snaps))for(const m of s.members){let r=map.get(m.uid);if(!r){r={...m,groups:[]};map.set(m.uid,r)}r.groups.push({id:s.group.id,name:s.group.name,snapshot_id:s.id,collected_at:s.collected_at,complete:s.complete,...(side?{side}:{})})}return map}
export function inspectChats(kind:'duplicates'|'find'|'compare',selected:ChatSnapshot[],other:ChatSnapshot[]=[],uid?:string):ChatResult{
 const groups=latestGroups(selected),right=latestGroups(other);if(!groups.length)throw Error('请勾选至少一份群成员快照');if(kind==='duplicates'&&groups.length<2)throw Error('至少选择两个不同群；同一群的历史快照只算一个群');if(kind==='find'&&!reliableUID(uid))throw Error('请先识别并确认目标账号');if(kind==='compare'&&!right.length)throw Error('请勾选右侧待比较的群快照');
 const scope=(ss:ChatSnapshot[],side?:string)=>ss.map(s=>({id:s.group.id,name:s.group.name,snapshot_id:s.id,complete:s.complete,collected_at:s.collected_at,...(side?{side}:{})}));
 const complete=[...groups,...right].every(g=>g.complete),a=union(groups,kind==='compare'?'导入名单':undefined),b=union(right,'所选群');let rows:MatchRow[]=[];
 if(kind==='duplicates')rows=[...a.values()].filter(r=>r.groups.length>=2).sort((x,y)=>y.groups.length-x.groups.length||x.uid.localeCompare(y.uid));
 if(kind==='find'&&a.has(uid!))rows=[a.get(uid!)!];
 if(kind==='compare'){for(const [id,r] of a)rows.push({...r,groups:[...r.groups,...b.get(id)?.groups||[]],category:b.has(id)?'共同成员':'仅导入名单存在'});for(const [id,r] of b)if(!a.has(id))rows.push({...r,category:'仅所选群存在'})}
 return {kind,queried_at:new Date().toISOString(),scope:[...scope(groups,kind==='compare'?'导入名单':undefined),...scope(right,'所选群')],complete,note:complete?'结果基于所选快照的记录时间，不代表实时群成员状态':'本次已读取范围内；名单不完整，未找到或差异不能证明不在群内',rows,...(kind==='find'?{target_uid:uid,found:rows.length>0,status:rows.length?'已找到':complete?'所选完整快照中未找到':'未知：不完整快照中未找到'}:{})};
}
