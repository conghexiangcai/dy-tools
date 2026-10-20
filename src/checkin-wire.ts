import {createHash} from 'node:crypto';
import {CHECKIN_ENDPOINTS,checkinParams,checkinSelfParams,CheckinError,Club,Calendar,decimal,lossless,parseCalendar,parseClubs,signArguments} from './checkin-domain';
import {chinaDate} from './checkin-schedule';
export type CheckinAuth={version:1;owner_uid:string;douyin_cookie:string;fandom_cookie?:string;updated_at?:string};
export function parseCheckinAuth(raw:any):CheckinAuth {
 if(raw?.version!==1)throw Error('认证配置应为 version: 1');const owner=decimal(raw.owner_uid);
 const cookie=(v:any,optional=false)=>{if(optional&&(v===undefined||v===''))return undefined;if(typeof v!=='string'||v.length>60000||/[\r\n\x00]/.test(v)||!/(?:^|;\s*)(?:sessionid|sessionid_ss|sid_tt)=[^;]+/.test(v))throw Error('认证文件需要有效 Cookie，不能填写分享链接 token');return v};
 return {version:1,owner_uid:owner,douyin_cookie:cookie(raw.douyin_cookie)!,fandom_cookie:cookie(raw.fandom_cookie,true),updated_at:typeof raw.updated_at==='string'?raw.updated_at:undefined};
}
export function authFingerprint(a:CheckinAuth){const identity=(c:string)=>c.split(';').map(x=>x.trim()).filter(x=>/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)=/.test(x)).sort();return createHash('sha256').update(JSON.stringify([a.owner_uid,identity(a.douyin_cookie),identity(a.fandom_cookie||'')])).digest('hex')}
export interface CheckinConnection {assert():Promise<void>;list(offset:number):Promise<ReturnType<typeof parseClubs>>;calendar(c:Club):Promise<Calendar>;sign(c:Club,calendar:Calendar):Promise<any>}
export interface CheckinWire {connect(owner:string):Promise<CheckinConnection>}
type RequestFetch=(url:string,options:RequestInit)=>Promise<Response>;
export class CheckinHTTP implements CheckinWire {
 private last=0;
 constructor(private auth:()=>Promise<CheckinAuth>,private fetcher:RequestFetch=(u,p)=>fetch(u,p),private options:{sleep?:(ms:number)=>Promise<void>;now?:()=>number;interval?:number;assertOwner?:()=>Promise<string>}={}){}
 async connect(owner:string):Promise<CheckinConnection>{
  const getAuth=async()=>{try{return parseCheckinAuth(await this.auth())}catch{throw new CheckinError('LOGIN','登录凭据缺失或已失效，请重新登录或替换认证文件')}};
  const auth=await getAuth(),fingerprint=authFingerprint(auth);if(auth.owner_uid!==owner)throw new CheckinError('ACCOUNT_CHANGED','认证属于其他账号，请切换到对应账号');
  const now=this.options.now||Date.now,sleep=this.options.sleep||(ms=>new Promise(r=>setTimeout(r,ms)));
  const assert=async()=>{if(authFingerprint(await getAuth())!==fingerprint)throw new CheckinError('ACCOUNT_CHANGED','认证已替换，本轮暂停，请重新开始');if(this.options.assertOwner&&await this.options.assertOwner()!==owner)throw new CheckinError('ACCOUNT_CHANGED','软件已切换账号')};
  const request=async(kind:keyof typeof CHECKIN_ENDPOINTS,params:Record<string,string>,post=false):Promise<any>=>{
   await assert();await sleep(Math.max(0,Math.max(1000,this.options.interval||1000)-(now()-this.last)));await assert();this.last=now();
   const url=new URL(CHECKIN_ENDPOINTS[kind]);url.search=new URLSearchParams({...kind==='self'?checkinSelfParams:checkinParams,...params}).toString();
   let response:Response,text:string;try{response=await this.fetcher(url.href,{method:post?'POST':'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{Cookie:kind==='calendar'||kind==='sign'?auth.fandom_cookie||auth.douyin_cookie:auth.douyin_cookie,'User-Agent':'Mozilla/5.0'},signal:AbortSignal.timeout(15000)});text=await response.text()}catch{throw new CheckinError('NETWORK',post?'签到请求中断，结果待回读':'网络请求中断，请稍后重试')}
   await assert();if(response.status===429)throw new CheckinError('RATE_LIMIT','请求受到限流，本轮已暂停');if(response.status===401||response.status===403)throw new CheckinError('LOGIN','认证已失效或没有访问权限，请更新认证');if(!response.ok)throw new CheckinError('NETWORK','接口连接失败（HTTP '+response.status+'）');
   let data:any;try{data=lossless(text)}catch{throw new CheckinError('EMPTY','接口返回空内容或非 JSON，状态未知')}
   if(data?.verify_type||data?.verify_center_decision_conf||data?.verify_detail)throw new CheckinError('CAPTCHA','请在抖音窗口完成验证后继续');
   if(data?.status_code===20003||data?.status_code===8)throw new CheckinError('LOGIN','登录认证失效，请重新登录或替换凭据');
   if(data?.status_code!==0)throw new CheckinError('API','接口未接受请求（'+String(data?.status_code??'未知')+'），结果未确认');return data;
  };
  // An arbitrary target-profile result is not proof of the logged-in identity.
  const self=await request('self',{});if(decimal(self.user?.uid)!==owner)throw new CheckinError('ACCOUNT_CHANGED','认证的实际登录账号与配置不一致');
  if(this.options.assertOwner&&await this.options.assertOwner()!==owner)throw new CheckinError('ACCOUNT_CHANGED','软件已切换账号');
  const guard=async()=>{await assert();if(this.options.assertOwner&&await this.options.assertOwner()!==owner)throw new CheckinError('ACCOUNT_CHANGED','软件已切换账号')};
  return {assert:guard,list:async offset=>{await guard();return parseClubs(await request('list',{offset:String(offset),count:'50'}))},calendar:async c=>{await guard();return parseCalendar(await request('calendar',{business_id:c.business_id,business_type:'4'}),c,now())},sign:async(c,calendar)=>{await guard();if(Math.abs(now()-calendar.server_now)>120000||chinaDate(now())!==calendar.day)throw new CheckinError('STALE','签到状态已过期或跨日，请重新核对');return request('sign',signArguments(c,calendar),true)}};
 }
}
