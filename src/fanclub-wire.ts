import {Session} from 'electron';
import {DouyinTransport} from './browser';
import {CollectError} from './transport';
import {losslessJSON} from './groups';
import {FanUser,fanInput,fanLink,fanParams,FAN_USER,fanUser,fanWebUser} from './fanclub';
import {FanConnection,FanWire} from './fanclub-service';
export class DouyinFanWire implements FanWire {
  private last=0;
  private verified:{owner:string;identity:string;at:number}|null=null;
  constructor(private session:Session,private transport:DouyinTransport){}
  challenge(target?:FanUser,navigate=false){return this.transport.challenge(target,navigate)}
  show(){this.transport.show()}
  async connect(owner:string):Promise<FanConnection>{
    const cookies=()=>this.session.cookies.get({url:'https://www.douyin.com'});
    const key=(items:Awaited<ReturnType<typeof cookies>>)=>items.filter(c=>/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)$/.test(c.name)).map(c=>c.name+'='+c.value).sort().join(';');
    const initial=await cookies(),identity=key(initial);if(!identity)throw new CollectError('LOGIN','请先在抖音窗口登录');
    if(!this.verified||this.verified.owner!==owner||this.verified.identity!==identity||Date.now()-this.verified.at>60000){try{if((await this.transport.owner()).uid!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已更换，请连接对应账号')}catch(e:any){throw new CollectError(e.code||'NETWORK','登录身份确认失败：'+e.message)}this.verified={owner,identity,at:Date.now()}}
    const assert=async()=>{if(key(await cookies())!==identity)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化，本次查询已暂停')};
    const read=async(params:Record<string,string>)=>this.transport.exclusive(async()=>{
      await assert();await new Promise(r=>setTimeout(r,Math.max(0,1000-(Date.now()-this.last))));await assert();this.last=Date.now();
      const url=new URL(FAN_USER,'https://webcast.amemv.com');url.search=new URLSearchParams({...fanParams,...params}).toString();
      let response:Response,raw:string;
      try{response=await this.session.fetch(url.href,{method:'GET',credentials:'omit',redirect:'error',cache:'no-store',headers:{Cookie:(await cookies()).map(c=>c.name+'='+c.value).join('; ')},signal:AbortSignal.timeout(12000)});raw=await response.text()}
      catch{throw new CollectError('NETWORK','粉丝团接口网络请求失败')}
      await assert();if(response.status===429)throw new CollectError('RATE_LIMIT','粉丝团服务限制请求频率，请稍后继续');if(!response.ok)throw new CollectError(response.status===401?'LOGIN':'HTTP','粉丝团接口连接失败（HTTP '+response.status+'）');
      let d:any;try{d=losslessJSON(raw)}catch{throw new CollectError(raw.trim()?'NON_JSON':'EMPTY',raw.trim()?'粉丝团服务未返回数据，请稍后重试':'粉丝团服务返回空内容（HTTP '+response.status+'），已保留当前账号，可重试')}
      if(d.verify_type||d.verify_center_decision_conf||d.verify_detail)throw new CollectError('CAPTCHA','请手动完成抖音验证');
      if(d.status_code!==0)throw new CollectError(d.status_code===20003?'LOGIN':'API','粉丝团接口未接受请求（'+String(d.status_code)+'）');
      return d;
    });
    const resolve=async(raw:string)=>{
      let input=fanInput(raw);
      if(input.kind==='url'){
        for(let i=0;i<6&&input.kind==='url';i++){
          await assert();const u=fanLink(input.value);let response:Response;
          try{response=await this.session.fetch(u.href,{method:'GET',redirect:'manual',credentials:'omit',signal:AbortSignal.timeout(20000)})}catch{throw new CollectError('NETWORK','分享链接暂时无法解析')}
          const location=response.headers.get('location');void response.body?.cancel().catch(()=>{});
          if(!location||response.status<300||response.status>=400)throw new CollectError('INPUT','分享链接没有指向用户主页，请粘贴完整主页地址或 sec_uid');
          input=fanInput(fanLink(new URL(location,u).href).href);
        }
      }
      if(input.kind==='url')throw new CollectError('INPUT','分享链接跳转次数过多');
      if(input.kind==='sec'){const user=fanWebUser(await this.transport.resolveSec(input.value));await assert();return {user,data:null}}
      const data=await read({target_uid:input.value}),user=fanUser(data,{uid:input.value});const profile=await this.transport.resolveSec(user.sec_uid);if(profile.uid!==user.uid)throw new CollectError('IDENTITY','主页身份与内部 UID 不一致');await assert();return {user:fanWebUser(profile),data};
    };
    return {resolve,read,assert,search:async(keyword,cursor,searchId)=>{await assert();const result=await this.transport.searchUsers(keyword,cursor,searchId);await assert();return result}};
  }
}
