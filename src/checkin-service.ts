import {CheckinError,CheckinRun,CheckinItem,signArguments} from './checkin-domain';
import {CheckinStore} from './checkin-store';
import {CheckinWire,CheckinConnection} from './checkin-wire';
import {chinaDate} from './checkin-schedule';
export class CheckinService {
 busy=false;countdown=0;private stopping=false;private task:Promise<void>|null=null;
 constructor(public store:CheckinStore,private wire:CheckinWire,private owner:()=>string,private notify:()=>void,private options:{sleep?:(ms:number)=>Promise<void>;now?:()=>number;blocked?:(code:string)=>Promise<void>;finished?:(r:CheckinRun)=>Promise<void>}={}){}
 private sleep(ms:number){return (this.options.sleep||(n=>new Promise(r=>setTimeout(r,n))))(ms)}
 private now(){return (this.options.now||Date.now)()}
 state(){const owner=this.owner();const r=this.store.latest(owner);if(r?.status==='running'&&!this.busy){r.status='paused';r.message='上次运行已中断；继续时会先核对未确认结果'}return {owner,busy:this.busy,countdown:this.countdown,run:r,schedule:this.store.schedule(owner)}}
 pause(){this.stopping=true;this.notify()}
 async wait(){await this.task}
 async start(mode:'inspect'|'sign'='sign'){if(this.store.latest(this.owner())?.status==='waiting_verification')throw Error('请先完成人工验证，再点击“已完成验证”');return this.launch(undefined,mode,false)}
 async resume(verified=false){const r=this.store.latest(this.owner());if(!r)throw Error('没有可继续的任务');if(r.status==='waiting_verification'&&!verified)throw Error('请先完成人工验证，再点击“已完成验证”');if(r.status==='completed')return this.start(r.mode);if(r.day&&r.day!==chinaDate(this.now()))return this.launch(undefined,r.mode,verified);return this.launch(r,r.mode,verified)}
 private async launch(previous:CheckinRun|undefined,mode:CheckinRun['mode'],verified:boolean){
  if(this.busy)throw Error('已有打卡任务正在运行');const owner=this.owner();if(!owner)throw Error('请连接当前账号');const release=this.store.acquire(owner);this.busy=true;this.stopping=false;
  let r:CheckinRun;try{r=previous||this.store.create(owner,mode)}catch(e){release();this.busy=false;throw e}
  r.status='running';delete r.error_code;this.store.save(r);this.notify();this.task=this.run(r,verified).then(async()=>{try{await this.options.finished?.(r)}catch{/* Alert failure cannot rewrite or discard the check-in result. */}}).finally(()=>{release();this.busy=false;this.countdown=0;this.notify()});return r.id;
 }
 private save(r:CheckinRun){this.store.save(r);this.notify()}
 private check(r:CheckinRun){if(this.owner()!==r.owner)throw new CheckinError('ACCOUNT_CHANGED','登录账号已变化，本轮暂停');if(this.stopping)throw new CheckinError('PAUSED','已暂停，可从断点继续')}
 private async read<T>(r:CheckinRun,fn:()=>Promise<T>):Promise<T>{for(let n=0;;n++){this.check(r);try{return await fn()}catch(e:any){if(!['NETWORK','EMPTY'].includes(e.code)||n>=2)throw e;await this.sleep((n+1)*2000)}}}
 private async run(r:CheckinRun,verified:boolean){
  try{
   if(verified){for(let n=5;n>0;n--){this.check(r);this.countdown=n;r.message='验证完成，等待 '+n+' 秒后重新核对';this.save(r);await this.sleep(1000)}this.countdown=0}
   const connection=await this.read(r,()=>this.wire.connect(r.owner));this.check(r);
   if(r.phase==='list')await this.list(r,connection);
   let consecutive=0;
   for(;r.cursor<r.items.length;r.cursor++){
    this.check(r);const item=r.items[r.cursor];if(item.state==='signed')continue;
    r.message=`正在核对 ${r.cursor+1} / ${r.items.length} · ${item.club.name}`;this.save(r);
    if(item.club.unsupported){item.state='unsupported';item.message=item.club.unsupported;this.save(r);continue}
    try{await this.item(r,item,connection);consecutive=0}catch(e:any){
     item.state=item.state==='sending'?'unknown':'failed';item.message=e instanceof CheckinError?e.message:'请求未完成，状态未知';item.checked_at=new Date(this.now()).toISOString();this.save(r);
     if(['LOGIN','CAPTCHA','RATE_LIMIT','ACCOUNT_CHANGED','PAUSED','CLOCK','STALE','IDENTITY'].includes(e.code))throw e;
     if(++consecutive>=3)throw new CheckinError('RETRY','连续三个粉丝团读取失败，请检查后继续');
    }
    this.save(r);
   }
   r.status='completed';const signed=r.items.filter(i=>i.state==='signed').length,issues=r.items.filter(i=>['unknown','failed','unsupported','needs_join'].includes(i.state)).length;
   r.message=`${r.mode==='inspect'?'状态核查':'本轮打卡'}完成 · 今日已签到 ${signed} / ${r.items.length} · 待处理 ${issues}`;this.save(r);
  }catch(e:any){r.error_code=e instanceof CheckinError?e.code:'INTERNAL';r.status=e.code==='LOGIN'?'waiting_login':e.code==='CAPTCHA'?'waiting_verification':e.code==='RATE_LIMIT'?'rate_limited':'paused';r.message=e instanceof CheckinError?e.message:'任务中断，已保存断点；请检查认证或连接后继续';this.save(r);if(['LOGIN','CAPTCHA'].includes(e.code)&&this.owner()===r.owner)await this.options.blocked?.(e.code).catch(()=>{})}
 }
 private async list(r:CheckinRun,c:CheckinConnection){
  for(let n=0;n<1000;n++){this.check(r);const p=await this.read(r,()=>c.list(r.offset));this.check(r);await c.assert();
   const keys=p.clubs.map(x=>x.key),fingerprint=keys.join('|');if(p.more&&!keys.length||r.page_fingerprints.includes(fingerprint)||keys.some(k=>r.items.some(i=>i.club.key===k)))throw new CheckinError('SCHEMA','粉丝团分页重复或名单发生变化，请重新刷新');
   r.items.push(...p.clubs.map(club=>({club,state:'pending' as const,message:'待核对'})));r.page_fingerprints.push(fingerprint);r.offset+=50;
   if(!p.more){r.phase='check';r.cursor=0;r.message=`名单读取完成，共 ${r.items.length} 个粉丝团`;this.save(r);return}
   r.message=`已读取 ${r.items.length} 个粉丝团，继续分页`;this.save(r);
  }throw new CheckinError('SCHEMA','粉丝团分页超过上限，未开始签到');
 }
 private async item(r:CheckinRun,item:CheckinItem,c:CheckinConnection){
  const wasSending=item.state==='sending';item.state='reading';this.save(r);
  const before=await this.read(r,()=>c.calendar(item.club));this.check(r);await c.assert();
  if(r.day&&r.day!==before.day)throw new CheckinError('CLOCK','已跨到新的一天，请重新开始以核对全部粉丝团');r.day=before.day;item.calendar=before;item.checked_at=before.checked_at;
  if(before.signed){item.state='signed';item.message=wasSending?'上次提交已回读确认':'今日已签到，已跳过';return}
  try{signArguments(item.club,before)}catch(e:any){if(e.code==='NEEDS_JOIN'||e.code==='UNSUPPORTED'){item.state=e.code==='NEEDS_JOIN'?'needs_join':'unsupported';item.message=e.message;return}throw e}
  if(r.mode==='inspect'){item.state='pending';item.message='今日未签到';return}
  this.check(r);item.state='sending';item.attempted_day=before.day;item.message='提交普通签到，等待回读';this.save(r);
  let signError:any;try{await c.sign(item.club,before)}catch(e:any){signError=e}
  // An ambiguous write is never blindly retried, even across restart. Read first.
  if(signError&&['ACCOUNT_CHANGED','LOGIN','CAPTCHA','RATE_LIMIT'].includes(signError.code))throw signError;
  await this.sleep(1200);this.check(r);await c.assert();let after;
  try{after=await this.read(r,()=>c.calendar(item.club))}catch(e){item.state='unknown';throw e}
  this.check(r);await c.assert();if(after.day!==before.day)throw new CheckinError('CLOCK','提交期间跨日，结果待重新核对');item.calendar=after;item.checked_at=after.checked_at;
  if(after.signed){item.state='signed';item.message='签到成功，已回读确认'}else{item.state='unknown';item.message='提交后未确认今日签到；下一轮先回读，不在本轮重复提交'}
 }
}
