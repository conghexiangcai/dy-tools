import {User} from './domain';
import {CollectError} from './transport';
export type LoginStatus={status:'unverified'|'checking'|'connected'|'expired'|'verification_required';owner:{uid:string;nickname:string}|null;checked_at:string|null;message:string;revision:number};
// Online identity is not inferred from the last account stored in SQLite.
export class LoginState {
 private value:LoginStatus={status:'unverified',owner:null,checked_at:null,message:'尚未核验登录',revision:0};
 private epoch=0;private pending:Promise<User>|null=null;
 constructor(private changed:()=>void,private verified:(user:User)=>void){}
 state(){return {...this.value,owner:this.value.owner?{...this.value.owner}:null}}
 private set(p:Partial<LoginStatus>){this.value={...this.value,...p,revision:this.value.revision+1};this.changed()}
 invalidate(){this.epoch++;this.set({status:'checking',owner:null,checked_at:null,message:'登录会话已变化，正在核验'})}
 failure(e:any){if(e?.code==='LOGIN')this.set({status:'expired',owner:null,message:'登录已失效，请重新登录'});else if(e?.code==='CAPTCHA')this.set({status:'verification_required',message:'等待完成抖音验证'});else if(e?.code==='ACCOUNT_CHANGED')this.set({status:'unverified',owner:null,message:'账号已变化，请重新连接'});}
 check(read:()=>Promise<User>):Promise<User>{
  if(this.pending)return this.pending;const epoch=this.epoch;
  if(this.value.status!=='connected')this.set({status:'checking',message:'正在核验登录'});
  const request=(async()=>{try{
   const user=await read();if(epoch!==this.epoch)throw new CollectError('ACCOUNT_CHANGED','核验期间登录会话变化，请重试');
   this.verified(user);this.set({status:'connected',owner:{uid:user.uid,nickname:user.nickname||''},checked_at:new Date().toISOString(),message:'登录已核实'});return user;
  }catch(e:any){if(epoch===this.epoch){this.failure(e);if(!['LOGIN','CAPTCHA','ACCOUNT_CHANGED'].includes(e?.code))this.set({status:this.value.status==='connected'?'connected':'unverified',message:'暂时无法核验登录，请检查网络后重试'})}throw e}})();
  this.pending=request;void request.finally(()=>{if(this.pending===request)this.pending=null}).catch(()=>{});return request;
 }
}
