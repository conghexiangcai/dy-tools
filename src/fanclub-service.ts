import {randomUUID} from 'node:crypto';
import {FanAnchor,FanRun,FanUser,FanSearchPage,accountKeyword,fanFailure,fanHonor,fanInput,fanRelation,fanUser} from './fanclub';
import {FanStore} from './fanclub-store';
import {CollectError} from './transport';
export interface FanConnection {resolve(raw:string):Promise<{user:FanUser;data:any}>;search?(keyword:string,cursor:number,searchId?:string):Promise<FanSearchPage>;read(params:Record<string,string>):Promise<any>;assert():Promise<void>}
export interface FanWire {connect(owner:string):Promise<FanConnection>;challenge(target?:FanUser,navigate?:boolean):Promise<boolean>;show():void}
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export class FanService {
  busy=false;countdown=0;private stopped=false;private resolved:{owner:string;user:FanUser;input:string;mode:string}|null=null;private previewRevision=0;
  private pending:{owner:string;raw:string;anchor:boolean|'preview';kind?:'search';cursor?:number;binding?:{input:string;uid:string};mode?:string;status:'waiting_login'|'waiting_verification';message:string}|null=null;
  private searchResult:{owner:string;token:string;input:string;anchor:boolean;users:FanUser[];cursor:number;more:boolean;search_id?:string}|null=null;
  private anchorPreview:{owner:string;user:FanUser;input:string}|null=null;
  activity:{message:string;started_at:number}|null=null;
  constructor(public store:FanStore,public wire:FanWire,private owner:()=>string,private changed:()=>void,private delay=sleep){}
  state(){const owner=this.owner();return {owner,anchorPreview:this.anchorPreview?.owner===owner?this.anchorPreview:null,anchors:this.store.anchors(owner),run:this.store.latest(owner),target:this.resolved?.owner===owner?this.resolved.user:null,targetInput:this.resolved?.owner===owner?this.resolved.input:null,targetMode:this.resolved?.owner===owner?this.resolved.mode:'auto',search:this.searchResult?.owner===owner?this.searchResult:null,activity:this.busy?this.activity:null,pending:this.pending?.owner===owner?{status:this.pending.status,message:this.pending.message}:null,busy:this.busy,countdown:this.countdown}}
  private progress(message:string){this.activity={message,started_at:Date.now()};this.changed()}
  private requireOwner(){const o=this.owner();if(!o)throw Error('请先登录抖音并连接账号');return o}
  private check(owner:string){if(this.owner()!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已切换，旧查询结果不再写入');if(this.stopped)throw new CollectError('PAUSED','已暂停，可继续查询')}
  async resolve(raw:string,anchor:boolean|'preview'=false,binding?:{input:string;uid:string},mode='auto'){
    if(this.busy)throw Error('请先暂停当前查询');fanInput(raw);const owner=this.requireOwner(),revision=++this.previewRevision;this.pending=null;if(anchor==='preview')this.anchorPreview=null;if(!anchor)this.resolved=null;this.stopped=false;this.busy=true;this.changed();
    try{this.progress('正在确认登录');const cx=await this.request(()=>this.wire.connect(owner),owner);this.progress('正在读取主页资料');const result=await this.request(()=>cx.resolve(raw),owner);this.check(owner);await cx.assert();this.check(owner);if(revision!==this.previewRevision)throw Error('账号解析已被新的操作替代');if(binding&&result.user.uid!==binding.uid)throw new CollectError('IDENTITY','搜索结果与主页账号不一致，请重新搜索');if(anchor==='preview')this.anchorPreview={owner,user:result.user,input:raw.trim()};else if(anchor)this.store.add(owner,result.user);else this.resolved={owner,user:result.user,input:binding?.input||raw.trim(),mode};this.pending=null;this.searchResult=null;return result.user}
    catch(e:any){if(['CAPTCHA','LOGIN'].includes(e.code)){this.pending={owner,raw,anchor,binding,mode,status:e.code==='CAPTCHA'?'waiting_verification':'waiting_login',message:e.message};this.wire.show()}throw e}
    finally{this.busy=false;this.changed()}
  }
  async search(raw:string,anchor=false,cursor=0){
    if(this.busy)throw Error('请先暂停当前查询');const keyword=accountKeyword(raw),owner=this.requireOwner(),previous=this.searchResult;this.pending=null;this.stopped=false;this.busy=true;if(!cursor){this.searchResult=null;if(!anchor)this.resolved=null}this.progress('正在搜索抖音号 '+keyword);
    try{const cx=await this.request(()=>this.wire.connect(owner),owner);if(!cx.search)throw Error('当前连接不支持抖音号检索');const page=await this.request(()=>cx.search!(keyword,cursor,cursor?previous?.search_id:undefined),owner);await cx.assert();this.check(owner);const users=cursor&&previous?.owner===owner&&previous.input===raw.trim()?[...previous.users]:[];for(const u of page.users)if(!users.some(x=>x.uid===u.uid))users.push(u);this.searchResult={owner,token:randomUUID(),input:raw.trim(),anchor,users,cursor:page.cursor,more:page.more,search_id:page.search_id};return this.searchResult}
    catch(e:any){if(['CAPTCHA','LOGIN'].includes(e.code)){this.pending={owner,raw,anchor,kind:'search',cursor,status:e.code==='CAPTCHA'?'waiting_verification':'waiting_login',message:e.message};this.wire.show()}throw e}
    finally{this.busy=false;this.changed()}
  }
  async choose(token:string,uid:string,input:string){const s=this.searchResult;if(!s||s.owner!==this.requireOwner()||s.token!==token||input.trim()!==s.input)throw Error('搜索条件已变化，请重新搜索');const u=s.users.find(x=>x.uid===uid);if(!u)throw Error('搜索结果已变化');return this.resolve(u.sec_uid,s.anchor,{input:s.input,uid:u.uid})}
  async more(token:string){const s=this.searchResult;if(!s||s.owner!==this.requireOwner()||s.token!==token||!s.more)throw Error('没有可加载的搜索结果');return this.search(s.input,s.anchor,s.cursor)}
  commitAnchor(input:string){const p=this.anchorPreview;if(this.busy||!p||p.owner!==this.requireOwner()||p.input!==input.trim())throw Error('主播输入或账号已变化，请重新识别');this.store.add(p.owner,p.user);this.anchorPreview=null;this.changed()}
  edit(uid:string,patch:{remark?:string;selected?:boolean}){this.store.edit(this.requireOwner(),uid,patch);this.changed()}
  remove(uid:string){this.store.remove(this.requireOwner(),uid);this.changed()}
  pause(){this.stopped=true;this.previewRevision++;const r=this.store.latest(this.owner());if(r&&r.status!=='completed'){r.status='paused';r.message='已暂停，可从断点继续';this.store.save(r)}this.changed()}
  async start(){if(this.busy)throw Error('已有查询正在运行');const owner=this.requireOwner();if(this.resolved?.owner!==owner)throw Error('请先解析并确认目标账号');const anchors=this.store.anchors(owner).filter(a=>a.selected);if(!anchors.length)throw Error('请添加并勾选至少一名主播');const at=new Date().toISOString();const r:FanRun={id:randomUUID(),owner_uid:owner,target:{...this.resolved.user},anchors:structuredClone(anchors),honor:{level:null,diamond_min:null,diamond_max:null},results:[],status:'running',message:'正在确认登录与目标账号',started_at:at,updated_at:at};this.store.save(r);this.stopped=false;this.busy=true;this.changed();void this.work(r,false)}
  async resume(verified=false,retry=false){
    if(this.busy)throw Error('已有查询正在运行');const owner=this.requireOwner();
    if(this.pending&&!retry){const p=this.pending;if(p.owner!==owner)throw Error('解析任务属于另一个登录账号，请重新识别账号');this.stopped=false;this.busy=true;
      try{if(verified){for(let i=5;i>0;i--){this.countdown=i;this.changed();await this.delay(1000);this.check(owner)}if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证尚未完成，请继续操作抖音窗口')}}finally{this.countdown=0;this.busy=false;this.changed()}
      if(p.kind==='search')await this.search(p.raw,p.anchor===true,p.cursor);else await this.resolve(p.raw,p.anchor,p.binding,p.mode);return;
    }
    const r=this.store.latest(owner);if(!r)throw Error('没有可继续的查询');if(r.status==='completed'&&!retry)throw Error('查询已结束，可以重试失败项或重新查询');if(retry){r.results=r.results.filter(x=>x.state!=='failed');if(r.results.length===r.anchors.length)throw Error('没有失败项需要重试')}this.stopped=false;this.busy=true;this.changed();void this.work(r,verified)
  }
  private async request<T>(fn:()=>Promise<T>,owner:string,target?:FanUser):Promise<T>{
    for(let attempt=0;;attempt++){
      this.check(owner);try{const value=await fn();this.check(owner);return value}catch(e:any){this.check(owner);if(['LOGIN','ACCOUNT_CHANGED','IDENTITY','SCHEMA','INPUT','CAPTCHA','RATE_LIMIT'].includes(e.code))throw e;
        if(await this.wire.challenge(target,false))throw new CollectError('CAPTCHA','请手动完成验证码，再点击已完成验证');
        if(!['NETWORK','EMPTY','TIMEOUT','HTTP','NON_JSON'].includes(e.code)||attempt>=2)throw e;this.progress(`${e.code==='EMPTY'?'接口返回空内容':'请求未成功'}，${attempt===0?2:4} 秒后重试（${attempt+1}/2）`);await this.delay(attempt===0?2000:4000);this.progress('正在重试请求');
      }
    }
  }
  private save(r:FanRun){this.check(r.owner_uid);this.store.save(r);this.changed()}
  private async work(r:FanRun,verified:boolean){
    try{
      if(verified){r.status='cooldown';r.message='验证后等待 5 秒';this.save(r);for(let i=5;i>0;i--){this.countdown=i;this.changed();await this.delay(1000);this.check(r.owner_uid)}this.countdown=0;if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证尚未完成，请继续操作抖音窗口')}
      this.progress('正在确认登录');const cx=await this.request(()=>this.wire.connect(r.owner_uid),r.owner_uid,r.target);this.check(r.owner_uid);r.status='running';r.message='正在准备主播查询';this.save(r);
      let failures=0,honorConflict=false;
      for(const anchor of r.anchors){
        this.check(r.owner_uid);if(r.results.some(x=>x.anchor.uid===anchor.uid))continue;r.message='正在查询 '+anchor.nickname;this.progress(r.message);this.save(r);
        try{const d=await this.request(()=>cx.read({target_uid:r.target.uid,sec_target_uid:r.target.sec_uid,anchor_id:anchor.uid,sec_anchor_id:anchor.sec_uid}),r.owner_uid,r.target);await cx.assert();this.check(r.owner_uid);const result=fanRelation(d,r.target,anchor);r.results.push(result);failures=0;const h=fanHonor(d);if(!honorConflict){if(r.honor.level===null)r.honor=h;else if(h.level!==r.honor.level||h.diamond_min!==r.honor.diamond_min||h.diamond_max!==r.honor.diamond_max){honorConflict=true;r.honor={level:null,diamond_min:null,diamond_max:null}}}this.save(r)}
        catch(e:any){if(['PAUSED','CAPTCHA','LOGIN','ACCOUNT_CHANGED','IDENTITY','SCHEMA','RATE_LIMIT'].includes(e.code))throw e;this.check(r.owner_uid);r.results.push(fanFailure(anchor,e instanceof CollectError?e.message:'请求失败，结果未知'));this.save(r);failures++;if(failures>=3)throw new CollectError('STOP_FAILURES','连续三个主播请求失败，已暂停；可继续或重试失败项')}
        if(r.results.length<r.anchors.length)await this.delay(1000);
      }
      r.status='completed';r.message='查询完成，仅覆盖本次 '+r.anchors.length+' 名主播；未知不代表未加入';this.save(r);
    }catch(e:any){r.status=e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':e.code==='PAUSED'||e.code==='ACCOUNT_CHANGED'||e.code==='STOP_FAILURES'?'paused':'error';r.message=e instanceof CollectError?e.message:'查询中断，已保存进度';this.store.save(r);if(['CAPTCHA','LOGIN'].includes(e.code))this.wire.show()}
    finally{this.countdown=0;this.busy=false;this.changed()}
  }
}
