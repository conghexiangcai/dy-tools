import {CollectError} from './transport';
export type Group={id:string;name:string;member_count:number};
export type GroupCatalog={groups:Group[];belong:string[]};
export const GROUP_LIST='/aweme/v1/follow/group/list/';
export const GROUP_USERS='/aweme/v1/follow/group/user/list/';
export const GROUP_SETTINGS='/aweme/v1/follow/group/user/settings/';
export function losslessJSON(text:string):any{return JSON.parse(text,((key:string,value:any,context?:{source?:string})=>typeof value==='number'&&!Number.isSafeInteger(value)&&context?.source?context.source:value) as any)}
export function groupId(value:unknown):string{
  const s=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
  if(typeof s!=='string'||!/^\d{1,20}$/.test(s))throw new CollectError('SCHEMA','分组 ID 或分页游标格式不正确');return s;
}
export function groupIds(value:unknown):string[]{if(!Array.isArray(value))throw new CollectError('SCHEMA','分组归属缺失');return [...new Set(value.map(groupId))]}
function page(data:any){if(!data||![0,1,true,false].includes(data.has_more))throw new CollectError('SCHEMA','分组分页结构发生变化');return {more:!!data.has_more,cursor:groupId(data.cursor??0)}}
function number(value:any){if(!Number.isSafeInteger(value)||value<0)throw new CollectError('SCHEMA','分组数量缺失');return value as number}
export function parseCatalog(data:any,requireMembership=true){
  if(!Array.isArray(data?.groups))throw new CollectError('SCHEMA','分组目录缺失');
  const groups:Group[]=data.groups.map((g:any)=>{if(typeof g.name!=='string')throw new CollectError('SCHEMA','分组名称缺失');return {id:groupId(g.id),name:g.name,member_count:number(g.member_count)}});
  return {...page(data),groups,belong:requireMembership?groupIds(data.belong_groups):[],total:number(data.total)};
}
export function parseMembers(data:any){if(!Array.isArray(data?.user_list))throw new CollectError('SCHEMA','分组成员列表缺失');return {...page(data),ids:[...new Set<string>(data.user_list.map((u:any)=>groupId(u.uid)))],total:number(data.total)}}
type Read=(path:string,params:Record<string,string>)=>Promise<any>;
async function readCatalogPages(read:Read,secUid:string,requireMembership:boolean):Promise<GroupCatalog>{
  const groups=new Map<string,Group>(),belong=new Set<string>(),seen=new Set<string>();let cursor='0',total:number|undefined;
  for(let pages=0;pages<500;pages++){
    if(seen.has(cursor))throw new CollectError('SCHEMA','分组目录分页没有推进');seen.add(cursor);
    const p=parseCatalog(await read(GROUP_LIST,{cursor,count:'50',member_count:'0',sec_user_id:secUid,group_type:'1',source:'2',sort_type:'0'}),requireMembership);
    if(total!==undefined&&total!==p.total)throw new CollectError('CONFLICT','分组目录在读取期间发生变化，请刷新');total=p.total;
    for(const g of p.groups)groups.set(g.id,g);p.belong.forEach(id=>belong.add(id));
    if(!p.more){if(groups.size!==total||[...belong].some(id=>!groups.has(id)))throw new CollectError('SCHEMA','分组目录不完整');return {groups:[...groups.values()],belong:[...belong]}}
    if(!p.groups.length)break;cursor=p.cursor;
  }throw new CollectError('SCHEMA','分组目录分页未完整读取');
}
export const readCatalog=(read:Read,secUid:string)=>readCatalogPages(read,secUid,true);
export async function readDirectory(read:Read,secUid:string):Promise<{groups:Group[]}>{const {groups}=await readCatalogPages(read,secUid,false);return {groups}}
export async function readMembers(read:Read,group:Group):Promise<string[]>{
  const ids=new Set<string>(),seen=new Set<string>();let cursor='0',total:number|undefined;
  for(let pages=0;pages<10000;pages++){
    if(seen.has(cursor))throw new CollectError('SCHEMA','分组成员分页没有推进');seen.add(cursor);
    const p=parseMembers(await read(GROUP_USERS,{group_id:group.id,cursor,count:'50'}));
    if(total!==undefined&&total!==p.total)throw new CollectError('CONFLICT','分组成员在读取期间发生变化，请刷新');total=p.total;p.ids.forEach(id=>ids.add(id));
    if(!p.more){if(ids.size!==total||total!==group.member_count)throw new CollectError('CONFLICT','分组成员数量变化或读取不完整，请刷新');return [...ids]}
    if(!p.ids.length)break;cursor=p.cursor;
  }throw new CollectError('SCHEMA','分组成员分页未完整读取');
}
export function membershipDelta(initial:string[],selected:string[],current:string[],available:string[]){
  const before=new Set(groupIds(initial)),want=new Set(groupIds(selected)),now=new Set(groupIds(current)),allowed=new Set(groupIds(available));
  if([...want].some(id=>!allowed.has(id)))throw new CollectError('CONFLICT','分组已被删除，请重新打开弹窗');
  return {add:[...want].filter(id=>!before.has(id)&&!now.has(id)),del:[...before].filter(id=>!want.has(id)&&now.has(id))};
}
export function deltaConfirmed(delta:{add:string[];del:string[]},actual:string[]){const ids=new Set(actual);return delta.add.every(id=>ids.has(id))&&delta.del.every(id=>!ids.has(id))}
export function sameCatalog(a:Group[],b:Group[]){const key=(gs:Group[])=>JSON.stringify([...gs].sort((x,y)=>x.id.localeCompare(y.id)));return key(a)===key(b)}
