import {ChatWire,ChatConnection} from './chat-service';
import {DouyinTransport} from './browser';
import {session} from 'electron';
import {CollectError} from './transport';
import {ChatGroup,member,safeGroupID} from './chat-domain';
// Executed only in the isolated Douyin page. Return a strict data projection, never SDK objects,
// auth material, conversation settings, last messages or message bodies.
export async function chatPageRead(owner:string,kind:string,cursor:string,group?:ChatGroup):Promise<any>{
 try{
  const root:any=globalThis;let sdk:any;
  for(const key of Object.keys(root).filter(k=>k.startsWith('@pc-im/im:'))){const chunks=root[key];if(!Array.isArray(chunks))continue;let req:any;chunks.push([['dy-chat-read-'+Date.now()],{},(r:any)=>{req=r}]);if(!req?.m)continue;
   const id=Object.keys(req.m).find(id=>{const s=String(req.m[id]);return s.includes('getImSdkInstance')&&/ImSdkInstance\s*:\s*null/.test(s)});if(!id)continue;const exports=req(id);if(typeof exports.o==='function'){sdk=exports.o();if(sdk)break}}
  if(!sdk)return {error:'IM_NOT_READY'};
  const identity=()=>String(sdk.option?.userId||sdk.ctx?.option?.userId||'');if(identity()!==owner)return {error:'ACCOUNT_CHANGED'};
  if(kind==='ready')return {ready:true};
  if(kind==='catalog'){
   const p=await sdk.getUserConversationList({type:2,inboxType:0,limit:50,sortType:1,cursor,withCold:true,notStoreToLocal:true});
   if(identity()!==owner)return {error:'ACCOUNT_CHANGED'};
   return {groups:(p.conversation||[]).map((c:any)=>({id:String(c.id),short_id:String(c.shortId),conversation_type:c.type,inbox_type:c.inboxType,name:c.coreInfo?.name||'',expected:c.participantCount,kind:'未知'})),more:p.hasMore,cursor:p.cursor?.toString()};
  }
  if(kind==='members'&&group){
   // The participant method consumes only these metadata fields. No message retrieval is used.
   const conversation={id:group.id,shortId:group.short_id,type:group.conversation_type,inboxType:group.inbox_type};
   const p=await sdk.getConversationParticipantsByPage({conversation,cursor,limit:50});if(identity()!==owner)return {error:'ACCOUNT_CHANGED'};
   return {members:(p.participants||[]).map((m:any)=>({uid:m.userId?.toString(),sec_uid:m.secUid||'',nickname:'',alias:m.alias||'',group_id:m.conversationId})),more:p.hasMore,cursor:p.cursor?.toString()};
  }return {error:'INPUT'};
 }catch(e:any){return {error:'IM_READ_FAILED',type:String(e?.type||e?.code||''),message:typeof e?.msg==='string'?e.msg.slice(0,200):'群接口未返回可用数据'}}
}
export class DouyinChatWire implements ChatWire{
 capability={available:true,message:'读取当前账号全部已加入群，手动勾选后扫描成员。只读取群资料与成员身份；接口无法确认的群类型显示“未知”。'};
 private last=0;private pending=false;
 constructor(private transport:DouyinTransport){}
 async connect(owner:string):Promise<ChatConnection>{
  if((await this.transport.owner()).uid!==owner)throw new CollectError('ACCOUNT_CHANGED','请重新连接当前登录账号');
  const s=session.fromPartition('persist:douyin-login');const identity=async()=>(await s.cookies.get({url:'https://www.douyin.com'})).filter(c=>/^(sessionid|sid_tt|uid_tt)$/.test(c.name)).map(c=>c.name+'='+c.value).sort().join(';');const initial=await identity();
  const assert=async()=>{if(!initial||await identity()!==initial)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化，群扫描已暂停')};
  const read=async(kind:string,cursor='0',group?:ChatGroup)=>this.transport.exclusive(async()=>{
   if(this.pending)throw new CollectError('IN_FLIGHT','上次群请求仍在等待服务响应，请稍后继续');await assert();await new Promise(r=>setTimeout(r,Math.max(0,1000-(Date.now()-this.last))));await assert();this.last=Date.now();const wc=await this.transport.ensure();let timeout:NodeJS.Timeout|undefined,result:any;
   this.pending=true;const request=wc.executeJavaScript('('+chatPageRead.toString()+')('+JSON.stringify(owner)+','+JSON.stringify(kind)+','+JSON.stringify(cursor)+','+JSON.stringify(group||null)+')').finally(()=>{this.pending=false});try{result=await Promise.race([request,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new CollectError('IN_FLIGHT','群接口响应超时，断点已保存；等待上次请求结束后再继续')),25000)})])}finally{clearTimeout(timeout)}
   await assert();if(result.error){if(await this.transport.challenge())throw new CollectError('CAPTCHA','请手动完成抖音验证码后点击已完成验证');if(result.error==='IM_NOT_READY'){this.show();throw new CollectError('IM_NOT_READY','请在抖音窗口点击顶部“消息”，待群聊组件加载后重试读取群；不必进入具体聊天')};if(result.error==='ACCOUNT_CHANGED')throw new CollectError('ACCOUNT_CHANGED','网页 IM 账号与当前账号不一致');if(result.type==='1008')throw new CollectError('NETWORK','群接口网络连接失败');if(result.type==='100')throw new CollectError('LOGIN','群聊登录状态失效，请重新登录');throw new CollectError('IM_READ_FAILED','群接口读取失败（'+result.error+' '+String(result.type||'')+'），已保留已读结果')};return result;
  });
  await read('ready');
  const page=(r:any)=>{if(typeof r.more!=='boolean'||typeof r.cursor!=='string'||!/^\-?\d{1,25}$/.test(r.cursor))throw new CollectError('SCHEMA','群分页结构发生变化');return {more:r.more,cursor:r.cursor}};
  return {assert,catalog:async cursor=>{const r=await read('catalog',cursor);if(!Array.isArray(r.groups))throw new CollectError('SCHEMA','群目录缺失');for(const g of r.groups)if(!safeGroupID(g.id)||!safeGroupID(g.short_id)||g.conversation_type!==2||g.inbox_type!==0||!Number.isSafeInteger(g.expected)||g.expected<0)throw new CollectError('SCHEMA','群身份或人数缺失');return {...page(r),groups:r.groups}},members:async(group,cursor)=>{const r=await read('members',cursor,group);if(!Array.isArray(r.members))throw new CollectError('SCHEMA','群成员列表缺失');const members=r.members.map((v:any)=>{const m=member(v);if(!m||v.group_id!==group.id)throw new CollectError('IDENTITY','成员身份或群归属不匹配');return m});return {...page(r),members}}};
 }
 challenge(){return this.transport.challenge()}
 show(){this.transport.show()}
}
