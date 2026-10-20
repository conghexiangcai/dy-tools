import {randomUUID} from 'node:crypto';
import {ChatGroup,ChatMember,ChatSnapshot,distinctMembers} from './chat-domain';
import {ChatStore,ChatRun} from './chat-store';
import {CollectError} from './transport';
export interface ChatConnection{assert():Promise<void>;catalog(cursor:string):Promise<{groups:ChatGroup[];more:boolean;cursor:string}>;members(group:ChatGroup,cursor:string):Promise<{members:ChatMember[];more:boolean;cursor:string}>}
export interface ChatWire{capability:{available:boolean;message:string};connect(owner:string):Promise<ChatConnection>;challenge():Promise<boolean>;show():void}
export class ChatService{
 busy=false;countdown=0;message='';private stopped=false;
 constructor(public store:ChatStore,public wire:ChatWire,private owner:()=>string,private changed:()=>void,private delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
 private check(owner:string){if(this.owner()!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已切换，已暂停旧扫描');if(this.stopped)throw new CollectError('PAUSED','已暂停，断点已保存')}
 private available(){if(!this.wire.capability.available)throw Error(this.wire.capability.message);if(!this.owner())throw Error('请先连接当前账号')}
 private async request<T>(owner:string,fn:()=>Promise<T>):Promise<T>{for(let n=0;;n++){this.check(owner);await this.delay(1000);this.check(owner);try{const value=await fn();this.check(owner);return value}catch(e:any){this.check(owner);if(!['NETWORK','EMPTY','TIMEOUT'].includes(e.code)||n>=2)throw e}}}
 pause(){this.stopped=true;this.changed()}
 async catalog(resume=false,verified=false){this.available();if(this.busy)throw Error('请先暂停当前扫描');this.busy=true;this.stopped=false;const owner=this.owner(),old=resume?this.store.catalog(owner):null,groups=new Map<string,ChatGroup>((old?.groups||[]).map(g=>[g.id,g])),seen=new Set<string>(old?.seen||[]);let cursor=old?.cursor||'0';this.message='正在读取全部已加入群';this.changed();
  try{if(old?.status==='waiting_verification'&&!verified)throw new CollectError('CAPTCHA','请完成验证码后点击已完成验证');if(verified){for(let n=5;n>0;n--){this.countdown=n;this.changed();await this.delay(1000);this.check(owner)}this.countdown=0;if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证尚未解除')}
   const cx=await this.wire.connect(owner);for(let n=0;n<10000;n++){this.check(owner);if(seen.has(cursor))throw new CollectError('SCHEMA','群目录分页重复');const p=await this.request(owner,()=>cx.catalog(cursor));await cx.assert();this.check(owner);for(const g of p.groups)groups.set(g.id,g);this.message='已读取 '+groups.size+' 个群';this.changed();if(!p.more){this.store.saveCatalog(owner,[...groups.values()],true,'已读取全部目录');return}if(!p.groups.length||p.cursor===cursor)throw new CollectError('SCHEMA','群目录分页未前进');seen.add(cursor);cursor=p.cursor;this.store.saveCatalog(owner,[...groups.values()],false,this.message,{cursor,seen:[...seen],status:'running'})}throw Error('群目录超出分页上限')}
  catch(e:any){this.message=e.message;if(this.owner()===owner)this.store.saveCatalog(owner,[...groups.values()],false,e.message,{cursor,seen:[...seen],status:e.code==='CAPTCHA'?'waiting_verification':'paused'});if(['LOGIN','CAPTCHA'].includes(e.code))this.wire.show();throw e}finally{this.countdown=0;this.busy=false;this.changed()}}
 async start(ids:string[]){this.available();if(this.busy)throw Error('已有扫描正在运行');const owner=this.owner(),groups=this.store.catalog(owner)?.groups.filter(g=>ids.includes(g.id))||[];if(!groups.length)throw Error('请手动勾选至少一个群');const r:ChatRun={id:randomUUID(),owner,groups,index:0,snapshot_ids:[],cursor:'0',seen:[],status:'running',message:'准备扫描',updated_at:new Date().toISOString()};
  this.store.transaction(()=>{for(const g of groups){const s:ChatSnapshot={id:randomUUID(),group:g,source:'登录账号 '+owner,origin:'scan',collected_at:null,complete:false,reason:'尚未扫描',members:[]};this.store.put(owner,s);r.snapshot_ids.push(s.id)}this.store.saveRun(r)});this.stopped=false;this.busy=true;this.changed();void this.work(r,false)}
 async resume(verified=false){this.available();if(this.busy)throw Error('扫描正在运行');const catalog=this.store.catalog(this.owner());if(catalog&&!catalog.complete&&catalog.cursor!==undefined)return this.catalog(true,verified);const r=this.store.latest(this.owner());if(!r||r.status==='completed')throw Error('没有可继续的扫描');if(r.status==='waiting_verification'&&!verified)throw Error('请完成验证码后点击“已完成验证”');this.stopped=false;this.busy=true;this.changed();void this.work(r,verified)}
 private async work(r:ChatRun,verified:boolean){
  try{if(verified){for(let n=5;n>0;n--){this.countdown=n;this.changed();await this.delay(1000);this.check(r.owner)}this.countdown=0;if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证尚未解除，请继续完成验证')}
   const cx=await this.wire.connect(r.owner);this.check(r.owner);r.status='running';this.store.saveRun(r);
   while(r.index<r.groups.length){this.check(r.owner);const group=r.groups[r.index];r.message='正在扫描 '+group.name+' · '+(r.index+1)+' / '+r.groups.length;this.store.saveRun(r);this.changed();if(r.seen.includes(r.cursor))throw new CollectError('SCHEMA','成员分页游标重复');
    const p=await this.request(r.owner,()=>cx.members(group,r.cursor));await cx.assert();this.check(r.owner);if(p.more&&(!p.members.length||p.cursor===r.cursor||r.seen.includes(p.cursor))){const s=this.store.get(r.owner,r.snapshot_ids[r.index])!;s.members=distinctMembers([...s.members,...p.members]);s.collected_at=new Date().toISOString();s.complete=false;s.reason='成员分页没有推进，保留已读取成员';this.store.put(r.owner,s);throw new CollectError('SCHEMA','成员分页没有推进，名单不完整')}this.store.page(r,p.members,p.more,p.cursor);this.changed();
   }r.status='completed';r.message='扫描结束；请留意各群完整性';this.store.saveRun(r);
  }catch(e:any){r.status=e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':'paused';r.message=e.message||'扫描中断，已保留读取结果';this.store.saveRun(r);if(['CAPTCHA','LOGIN'].includes(e.code))this.wire.show()}
  finally{this.countdown=0;this.busy=false;this.changed()}
 }
}
