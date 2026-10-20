import {Session} from 'electron';
import {DouyinTransport} from './browser';
import {ActionWire,ActionConnection} from './action-service';
import {ActionItem,ActionKind} from './tool-store';
import {CollectError,baseParams} from './transport';
import {uidValid} from './domain';
export const actionRoutes={follow:'/aweme/v1/web/commit/follow/user/',digg:'/aweme/v1/web/commit/item/digg/',collect:'/aweme/v1/web/aweme/collect/',recommend:'/aweme/v1/web/familiar/recommend/cancel',likes:'/aweme/v1/web/aweme/favorite/',collections:'/aweme/v1/web/aweme/listcollection/',recommendations:'/aweme/v1/web/familiar/recommend/feed/',detail:'/aweme/v1/web/aweme/detail/'};
// Runs only in the isolated Douyin page. Return selected business fields, never headers/cookies.
export async function actionRequest(path:string,query:Record<string,string>,body:Record<string,string>|null){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
 try{const url=new URL(path,location.origin);url.search=new URLSearchParams(query).toString();const r=await fetch(url.href,{method:body?'POST':'GET',credentials:'include',cache:'no-store',headers:body?{'Content-Type':'application/x-www-form-urlencoded'}:{},...(body?{body:new URLSearchParams(body).toString()}:{}),signal:abort.signal});
 if(!r.ok)return {error:r.status===401?'LOGIN':'HTTP_'+r.status};const text=await r.text();let d:any;try{d=JSON.parse(text,((k:string,v:any,c?:{source?:string})=>typeof v==='number'&&!Number.isSafeInteger(v)&&c?.source?c.source:v) as any)}catch{return {error:'EMPTY'}}
 if(d.verify_type||d.verify_center_decision_conf||d.verify_detail)return {error:'CAPTCHA'};if(d.status_code!==0)return {error:'API_'+String(d.status_code)};
 const pick=(a:any)=>a&&Object.fromEntries(['aweme_id','desc','aweme_type','user_digged','collect_stat','user_recommend_status'].filter(k=>a[k]!==undefined).map(k=>[k,a[k]]));
 return {status_code:0,aweme_list:Array.isArray(d.aweme_list)?d.aweme_list.map(pick):d.aweme_list,aweme_detail:pick(d.aweme_detail),has_more:d.has_more,cursor:d.cursor,max_cursor:d.max_cursor};
 }catch{return {error:abort.signal.aborted?'TIMEOUT':'NETWORK'}}finally{clearTimeout(timer)}
}
export function mediaState(kind:ActionKind,d:any,id:string):'done'|'needed'|'unknown'{if(!d||d.aweme_id!==id)return 'unknown';const n=kind==='unlike'?d.user_digged:kind==='uncollect'?d.collect_stat:undefined;return n===0?'done':n===1?'needed':'unknown'}
export function mediaPage(d:any,kind:ActionKind){
 if(!Array.isArray(d?.aweme_list)||![0,1,true,false].includes(d.has_more))throw new CollectError('SCHEMA','作品列表未完整返回，未生成可执行名单');
 const items:ActionItem[]=d.aweme_list.map((v:any)=>{if(!uidValid(v.aweme_id))throw new CollectError('SCHEMA','作品 ID 无效');return {id:v.aweme_id,label:typeof v.desc==='string'?v.desc.slice(0,200):v.aweme_id,aweme_type:Number.isSafeInteger(v.aweme_type)?v.aweme_type:undefined,url:'https://www.douyin.com/video/'+v.aweme_id,state:'pending'}});
 const cursor=kind==='uncollect'?d.cursor:d.max_cursor;if(d.has_more&&!(typeof cursor==='string'&&/^\d+$/.test(cursor)||Number.isSafeInteger(cursor)&&cursor>=0))throw new CollectError('SCHEMA','作品分页游标无效');return {items,more:!!d.has_more,cursor:String(cursor??0)};
}
export class DouyinActionWire implements ActionWire {
 constructor(private session:Session,private transport:DouyinTransport){}
 challenge(){return this.transport.challenge()}show(){this.transport.show()}
 async connect(owner:string):Promise<ActionConnection&{list(kind:ActionKind,progress?:(n:number)=>void,guard?:()=>void):Promise<ActionItem[]>}>{
  const fingerprint=async()=> (await this.session.cookies.get({url:'https://www.douyin.com'})).filter(c=>/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)$/.test(c.name)).map(c=>c.name+'='+c.value).sort().join(';');
  await this.transport.ensure();const original=await fingerprint();const user=await this.transport.owner();if(user.uid!==owner||await fingerprint()!==original)throw new CollectError('ACCOUNT_CHANGED','当前抖音账号与预览账号不同或会话已变化，请重新连接');if(!original)throw new CollectError('LOGIN','请先登录抖音');let last=0;
  const assert=async()=>{if(await fingerprint()!==original)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化，操作已暂停')};
  const request=async(path:string,params:Record<string,string>={},body:Record<string,string>|null=null,write=false,guard?:()=>void):Promise<any>=>{
   if(!Object.values(actionRoutes).includes(path))throw Error('不支持的接口');
   for(let retry=0;;retry++){try{return await this.transport.exclusive(async()=>{
    await assert();await new Promise(r=>setTimeout(r,Math.max(0,1000-(Date.now()-last))));await assert();last=Date.now();const wc=await this.transport.ensure();if(new URL(wc.getURL()).origin!=='https://www.douyin.com')throw new CollectError('LOGIN','请回到抖音网页登录');
    guard?.();const data=await wc.executeJavaScript('('+actionRequest.toString()+')('+JSON.stringify(path)+','+JSON.stringify({...baseParams,...params})+','+JSON.stringify(body)+')');await assert();
    if(data?.error)throw new CollectError(data.error,data.error==='CAPTCHA'?'请手动完成抖音验证':'接口未确认（'+data.error+'），没有将结果计为成功');return data;
   })}catch(e:any){if(write||retry>=2||!['EMPTY','TIMEOUT','NETWORK'].includes(e.code))throw e;if(await this.challenge())throw new CollectError('CAPTCHA','请手动完成抖音验证')}}
  };
  const list=async(kind:ActionKind,progress=(n:number)=>{},guard=()=>{}):Promise<ActionItem[]>=>{
   if(!['unlike','uncollect','unrecommend'].includes(kind))throw Error('不支持的作品列表');const items=new Map<string,ActionItem>(),seen=new Set<string>();let cursor='0';
   for(let page=0;page<5000;page++){guard();await assert();if(seen.has(cursor))throw new CollectError('SCHEMA','分页未推进，请重新读取');seen.add(cursor);
    const path=kind==='unlike'?actionRoutes.likes:kind==='uncollect'?actionRoutes.collections:actionRoutes.recommendations;
    const d=await request(path,kind==='uncollect'?{}:{sec_user_id:user.sec_uid,max_cursor:cursor,min_cursor:'0',count:'20',...(kind==='unrecommend'?{from:'1',device_platform:'',app_name:'douyin_web'}:{cut_version:'1'})},kind==='uncollect'?{cursor,count:'20'}:null);
    guard();const p=mediaPage(d,kind);p.items.forEach(i=>items.set(i.id,i));progress(items.size);if(!p.more)return [...items.values()];if(!p.items.length)throw new CollectError('SCHEMA','分页返回空页，名单不完整');cursor=p.cursor;
   }throw new CollectError('SCHEMA','列表过长，本次读取未完成');
  };
  return {assert,list,inspect:async(kind,item)=>{
   await assert();if(kind==='follow'||kind==='unfollow'){
    if(!item.sec_uid)return 'unknown';const u=await this.transport.resolveSec(item.sec_uid);await assert();if(u.uid!==item.id)return 'unknown';const following=u.follow_status===1||u.follow_status===2?true:u.follow_status===0?false:null;return following===null?'unknown':following===(kind==='follow')?'done':'needed';
   }
   // Recommendation status enums differ by client. Read authoritative own list instead of guessing.
   if(kind==='unrecommend')return (await list(kind)).some(i=>i.id===item.id)?'needed':'done';
   return mediaState(kind,(await request(actionRoutes.detail,{aweme_id:item.id})).aweme_detail,item.id);
  },write:async(kind,item,guard)=>{
   await assert();if(kind==='follow'||kind==='unfollow')await request(actionRoutes.follow,{}, {user_id:item.id,type:kind==='follow'?'1':'0'},true,guard);
   else if(kind==='unlike')await request(actionRoutes.digg,{}, {aweme_id:item.id,type:'0',item_type:'0'},true,guard);
   else if(kind==='uncollect'){if(!Number.isSafeInteger(item.aweme_type))throw new CollectError('SCHEMA','作品类型缺失，未提交取消收藏');await request(actionRoutes.collect,{}, {aweme_id:item.id,action:'0',aweme_type:String(item.aweme_type)},true,guard)}
   else if(kind==='unrecommend')await request(actionRoutes.recommend,{device_platform:'',app_name:'douyin_web'}, {type:'2',item_id:item.id,source:'0'},true,guard);
   else throw Error('不支持的批量操作');
  }};
 }
}
