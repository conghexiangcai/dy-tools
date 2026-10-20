import {User,cleanUser,count} from './domain';
export class CollectError extends Error {constructor(public code:string,message:string){super(message);}}
export interface Transport {
  owner():Promise<User>;
  following(owner:User,offset:number,time:number):Promise<{users:User[];more:boolean;min_time:number}>;
  profile(user:User):Promise<any>;
  videos(user:User,cursor:number):Promise<VideoPage>;
  challenge(target?:User,navigate?:boolean):Promise<boolean>;
  show():void;
}
export const SELF='/aweme/v1/web/user/profile/self/';
export const FOLLOWING='/aweme/v1/web/user/following/list/';
export const PROFILE='/aweme/v1/web/user/profile/other/';
export const POSTS='/aweme/v1/web/aweme/post/';
export type VideoPage={videos:{id:string;time:number;pinned:boolean}[];more:boolean;cursor:number;valid:boolean};
export const baseParams={device_platform:'webapp',aid:'6383',channel:'channel_pc_web',version_code:'170400',version_name:'17.4.0',update_version_code:'170400',pc_client_type:'1',platform:'PC'};
// This function is serialized into the authenticated Douyin page. Never read/export credentials.
export async function pageRequest(path:string,params:Record<string,string>):Promise<any>{
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('TIMEOUT'));},20000)});
  try {
    const url=new URL(path,location.origin);url.search=new URLSearchParams(params).toString();
    const res=await Promise.race([fetch(url.href,{credentials:'include',signal:controller.signal}),deadline]);
    if(!res.ok)return {error:res.status===401?'LOGIN':'HTTP_'+res.status};
    const text=await Promise.race([res.text(),deadline]);let data:any;try{data=JSON.parse(text)}catch{return {error:'EMPTY'}}
    if(data.status_code!==0)return {error:'API_'+String(data.status_code)};
    const pick=(u:any)=>u&&Object.fromEntries(['uid','sec_uid','nickname','unique_id','short_id','follower_count','following_count','aweme_count','follow_status','secret'].filter(k=>u[k]!==undefined).map(k=>[k,u[k]]));
    return {user:pick(data.user),followings:Array.isArray(data.followings)?data.followings.map(pick):undefined,has_more:data.has_more,min_time:data.min_time,max_cursor:data.max_cursor,aweme_list:Array.isArray(data.aweme_list)?data.aweme_list.map((v:any)=>({aweme_id:v.aweme_id,create_time:v.create_time,is_top:v.is_top,author_uid:v.author?.uid})):data.aweme_list};
  } catch(e:any){return {error:e.message==='TIMEOUT'?'TIMEOUT':'NETWORK'}} finally {clearTimeout(timer);}
}
export function parseVideos(data:any,user:User):VideoPage{
  if(!data||typeof data!=='object')throw new CollectError('SCHEMA','作品列表接口结构发生变化');
  // Observed account-level unavailable response: status_code=0, aweme_list=null,
  // with both pagination fields omitted. This is unknown, not zero publications.
  if(data.aweme_list===null&&data.has_more===undefined&&data.max_cursor===undefined)return {videos:[],more:false,cursor:0,valid:false};
  if(![0,1,false,true].includes(data.has_more)||!(Array.isArray(data.aweme_list)||data.aweme_list===null))throw new CollectError('SCHEMA','作品列表接口结构发生变化');
  let valid=true;const videos:VideoPage['videos']=[];
  for(const v of data.aweme_list||[]){
    if(v.author_uid!==undefined&&String(v.author_uid)!==user.uid)throw new CollectError('SCHEMA','作品作者身份与请求账号不符');
    if(typeof v.aweme_id!=='string'||!/^\d+$/.test(v.aweme_id)||count(v.create_time)===null||v.create_time<1||v.create_time>Date.now()/1000+60){valid=false;continue}
    videos.push({id:v.aweme_id,time:v.create_time,pinned:v.is_top===1||v.is_top===true});
  }
  const more=!!data.has_more,cursor=count(data.max_cursor);if(more&&cursor===null)throw new CollectError('SCHEMA','作品分页游标缺失');
  return {videos,more,cursor:cursor??0,valid};
}
export function newestThree(videos:VideoPage['videos']):string[]{return [...new Map(videos.map(v=>[v.id,v])).values()].sort((a,b)=>b.time-a.time).slice(0,3).map(v=>new Date(v.time*1000).toISOString());}
export function checkPageResult(result:any){
  if(result?.error)throw new CollectError(result.error,result.error==='LOGIN'?'抖音登录已失效':result.error==='TIMEOUT'?'请求超时':result.error==='NETWORK'?'网络连接失败':'接口暂时无法读取（'+result.error+'）');
  if(!result||typeof result!=='object')throw new CollectError('SCHEMA','接口返回格式发生变化');return result;
}
export function parseOwner(data:any):User{if(!data?.user?.uid||data.user.uid==='0')throw new CollectError('LOGIN','请先在抖音窗口完成登录');try{return cleanUser(data.user)}catch{throw new CollectError('SCHEMA','本人账号接口未返回完整身份')}}
export function parseFollowing(data:any){
  if(!Array.isArray(data.followings)||![0,1,false,true].includes(data.has_more))throw new CollectError('SCHEMA','关注分页接口返回格式发生变化');
  let users:User[];try{users=data.followings.map(cleanUser)}catch{throw new CollectError('SCHEMA','关注列表包含无效账号身份')}
  const more=!!data.has_more;if(more&&(count(data.min_time)===null||!users.length))throw new CollectError('SCHEMA','关注分页游标无效');
  return {users,more,min_time:count(data.min_time)??0};
}
