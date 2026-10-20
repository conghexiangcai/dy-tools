import {ActionItem,ActionKind,ActionRun,ToolStore} from './tool-store';
import {CollectError} from './transport';
export interface ActionConnection {assert():Promise<void>;inspect(kind:ActionKind,item:ActionItem):Promise<'done'|'needed'|'unknown'>;write(kind:ActionKind,item:ActionItem,guard?:()=>void):Promise<void>}
export interface ActionWire {connect(owner:string):Promise<ActionConnection>;challenge():Promise<boolean>;show():void}
export class ActionService {
 busy=false;countdown=0;activeId='';private stopped=false;
 constructor(public store:ToolStore,private wire:ActionWire,private owner:()=>string,private changed:()=>void,private delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
 private check(owner:string){if(this.owner()!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已切换，任务已暂停');if(this.stopped)throw new CollectError('PAUSED','已暂停，进度已保存')}
 state(){return {busy:this.busy,countdown:this.countdown,active_id:this.activeId,runs:this.store.runs(this.owner())}}
 pause(){this.stopped=true}
 async execute(id:string,nonce:string,verified=false){if(this.busy)throw Error('已有批量任务正在执行');const r=this.store.run(this.owner(),id);if(!r||r.nonce!==nonce)throw Error('预览已变化，请重新打开');if(r.status==='completed')throw Error('任务已完成');if(r.status==='waiting_verification'&&!verified)throw Error('请完成验证码并点击已完成验证');this.busy=true;this.stopped=false;this.activeId=r.id;this.changed();void this.work(r,verified)}
 private save(r:ActionRun){this.store.save(r);this.changed()}
 private async work(r:ActionRun,verified:boolean){try{
  if(verified){for(let n=5;n>0;n--){this.countdown=n;this.changed();await this.delay(1000);this.check(r.owner_uid)}this.countdown=0;if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证尚未解除')}
  this.check(r.owner_uid);const cx=await this.wire.connect(r.owner_uid);this.check(r.owner_uid);r.status='running';r.message='正在核对登录账号和项目状态';this.save(r);
  for(const item of r.items){this.check(r.owner_uid);if(['done','skipped'].includes(item.state))continue;
   await cx.assert();this.check(r.owner_uid);
   if(r.kind==='unfollow'&&this.store.ignored(r.owner_uid).some(u=>u.uid===item.id)){item.state='skipped';item.message='已加入忽视名单，跳过';this.save(r);continue}
   r.message='正在核对 '+item.label;this.save(r);const before=await cx.inspect(r.kind,item);await cx.assert();this.check(r.owner_uid);
   if(before==='done'){item.state='skipped';item.message='已是目标状态，无需重复操作'}
   else if(before==='unknown'){item.state='unknown';item.message='无法确认当前状态，尚未提交操作';throw new CollectError('UNCONFIRMED',item.message)}
   else {
    item.state='sending';item.message='请求正在提交';this.save(r);await cx.assert();this.check(r.owner_uid);let writeError:any;
    try{await cx.write(r.kind,item,()=>this.check(r.owner_uid))}catch(e){writeError=e}
    // A timed-out write may have succeeded. Read first; never blindly replay it.
    await cx.assert();this.check(r.owner_uid);let after:'done'|'needed'|'unknown'='unknown';try{after=await cx.inspect(r.kind,item)}catch{}
    await cx.assert();this.check(r.owner_uid);
    if(after==='done'){item.state='done';item.message='已回读确认'}else{item.state='unknown';item.message=writeError?.code==='CAPTCHA'?'请完成验证码后核对结果':'结果未确认，已停止；继续时先回读';if(writeError)throw writeError;throw new CollectError('UNCONFIRMED',item.message)}
   }
   item.checked_at=new Date().toISOString();if((item.state==='done'||before==='done')&&['follow','unfollow'].includes(r.kind))this.store.effect(r.owner_uid,item.id,r.kind==='follow');this.save(r);
   if(r.items.some(i=>!['done','skipped'].includes(i.state)))await this.delay(1500);
  }
  r.status='completed';r.message='全部项目已处理；详见逐项执行记录';this.save(r);
 }catch(e:any){for(const i of r.items)if(i.state==='sending'){i.state='unknown';i.message='请求结果待核对'}r.status=e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':'paused';r.message=e.message||'操作暂停，进度已保存';this.save(r);if(['CAPTCHA','LOGIN'].includes(e.code))this.wire.show()}
 finally{this.busy=false;this.countdown=0;this.changed()}}
}
