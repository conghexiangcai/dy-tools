import {Session} from 'electron';
import {DouyinTransport} from './browser';
import {CollectError} from './transport';
import {losslessJSON} from './groups';
import {FanUser,fanInput,fanLink,fanParams,FAN_USER,fanUser} from './fanclub';
import {FanConnection,FanWire} from './fanclub-service';
export class DouyinFanWire implements FanWire {
  private last=0;
  constructor(private session:Session,private transport:DouyinTransport){}
  challenge(target?:FanUser,navigate=false){return this.transport.challenge(target,navigate)}
  show(){this.transport.show()}
  async connect(owner:string):Promise<FanConnection>{
    if((await this.transport.owner()).uid!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已更换，请连接对应账号');
    const cookies=()=>this.session.cookies.get({url:'https://www.douyin.com'});
    const key=(items:Awaited<ReturnType<typeof cookies>>)=>items.filter(c=>/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)$/.test(c.name)).map(c=>c.name+'='+c.value).sort().join(';');
    const initial=await cookies(),identity=key(initial);if(!identity)throw new CollectError('LOGIN','请先在抖音窗口登录');
    const assert=async()=>{if(key(await cookies())!==identity)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化，本次查询已暂停')};
    const read=async(params:Record<string,string>)=>this.transport.exclusive(async()=>{
      await assert();await new Promise(r=>setTimeout(r,Math.max(0,1000-(Date.now()-this.last))));await assert();this.last=Date.now();
      const url=new URL(FAN_USER,'https://webcast.amemv.com');url.search=new URLSearchParams({...fanParams,...params}).toString();
      let response:Response,raw:string;
      try{response=await this.session.fetch(url.href,{method:'GET',credentials:'omit',redirect:'error',headers:{Cookie:(await cookies()).map(c=>c.name+'='+c.value).join('; ')},signal:AbortSignal.timeout(20000)});raw=await response.text()}
      catch{throw new CollectError('NETWORK','粉丝团接口网络请求失败')}
      await assert();if(!response.ok)throw new CollectError(response.status===401?'LOGIN':'HTTP','粉丝团接口连接失败（HTTP '+response.status+'）');
      let d:any;try{d=losslessJSON(raw)}catch{throw new CollectError('EMPTY','接口返回空响应，结果未知')}
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
      const expected=input.kind==='uid'?{uid:input.value}:await this.transport.resolveSec(input.value);
      const data=await read('sec_uid' in expected?{target_uid:expected.uid,sec_target_uid:expected.sec_uid}:{target_uid:expected.uid});return {user:fanUser(data,expected),data};
    };
    return {resolve,read,assert};
  }
}
