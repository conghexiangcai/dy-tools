import {User,cleanUser,count} from './domain';
export class CollectError extends Error {constructor(public code:string,message:string){super(message);}}
export interface Transport {
  owner():Promise<User>;
  following(owner:User,offset:number,time:number):Promise<{users:User[];more:boolean;min_time:number}>;
  profile(user:User):Promise<any>;
  challenge(target?:User,navigate?:boolean):Promise<boolean>;
  show():void;
}
export const SELF='/aweme/v1/web/user/profile/self/';
export const FOLLOWING='/aweme/v1/web/user/following/list/';
export const PROFILE='/aweme/v1/web/user/profile/other/';
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
    return {user:pick(data.user),followings:Array.isArray(data.followings)?data.followings.map(pick):undefined,has_more:data.has_more,min_time:data.min_time};
  } catch(e:any){return {error:e.message==='TIMEOUT'?'TIMEOUT':'NETWORK'}} finally {clearTimeout(timer);}
}
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
