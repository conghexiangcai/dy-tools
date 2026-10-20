import {Session} from 'electron';
import {DouyinTransport} from './browser';
import {CollectError,baseParams} from './transport';
import {GroupConnection,GroupWire} from './group-service';
import {User} from './domain';
import {GROUP_LIST,GROUP_USERS,GROUP_SETTINGS,losslessJSON} from './groups';
export class DouyinGroupWire implements GroupWire {
  constructor(private session:Session,private transport:DouyinTransport){}
  challenge(target?:User,navigate=false){return this.transport.challenge(target,navigate)}
  show(){this.transport.show()}
  async connect(owner:string):Promise<GroupConnection>{
    const self=await this.transport.owner();if(self.uid!==owner)throw new CollectError('ACCOUNT_CHANGED','当前登录账号与名单不符，请连接正确账号');
    // Domain is verified through the APK Retrofit factory. Cookie values stay in memory only.
    const cookies=()=>this.session.cookies.get({url:'https://www.douyin.com'});
    const initial=await cookies(),auth=initial.map(c=>c.name+'='+c.value).join('; ');
    const identity=(items:typeof initial)=>items.filter(c=>/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)$/.test(c.name)).map(c=>c.name+'='+c.value).sort().join(';');
    const identityKey=identity(initial);if(!identityKey)throw new CollectError('LOGIN','当前网页登录会话无法用于分组，请重新登录');let last=0;
    const request=async(path:string,params:Record<string,string>,post=false,guard?:()=>void):Promise<any>=>this.transport.exclusive(async()=>{
      if(post?path!==GROUP_SETTINGS:![GROUP_LIST,GROUP_USERS].includes(path))throw Error('不支持的分组接口');
      if(identity(await cookies())!==identityKey)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化，请重新打开分组设置');
      await new Promise(r=>setTimeout(r,Math.max(0,1000-(Date.now()-last))));last=Date.now();
      if(identity(await cookies())!==identityKey)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化，请重新打开分组设置');guard?.();
      const url=new URL(path,'https://aweme.snssdk.com');url.search=new URLSearchParams({...baseParams,...(post?{}:params)}).toString();
      let response:Response,raw:string;
      try{response=await this.session.fetch(url.href,{method:post?'POST':'GET',credentials:'omit',redirect:'error',headers:{Cookie:auth,...(post?{'Content-Type':'application/x-www-form-urlencoded'}:{})},...(post?{body:new URLSearchParams(params).toString()}:{}),signal:AbortSignal.timeout(20000)});raw=await response.text()}
      catch{throw new CollectError('NETWORK',post?'提交结果尚未确认，将查询实际归属':'分组接口网络请求失败')}
      if(!response.ok)throw new CollectError(response.status===401?'LOGIN':'HTTP','分组服务连接失败（HTTP '+response.status+'）');
      let d:any;try{d=losslessJSON(raw)}catch{throw new CollectError('SCHEMA','分组服务返回非数据内容，请查看登录或验证窗口')}
      if(d.status_code!==0){if(d.verify_type||d.verify_center_decision_conf||d.verify_detail)throw new CollectError('CAPTCHA','分组服务需要人工验证');throw new CollectError('GROUP_API','分组接口未接受当前请求（'+String(d.status_code)+'）：'+String(d.status_msg||'连接受限').slice(0,150))}
      return d;
    });
    return {selfSec:self.sec_uid,read:async(path,params)=>{for(let attempt=0;;attempt++){try{return await request(path,params)}catch(e:any){if(e.code!=='NETWORK'||attempt>=2)throw e;if(await this.challenge())throw new CollectError('CAPTCHA','请完成抖音验证');await new Promise(r=>setTimeout(r,1000))}}},write:async(sec,add,del,guard)=>{await request(GROUP_SETTINGS,{sec_user_id:sec,add_group_ids:add.join(','),del_group_ids:del.join(',')},true,guard)}};
  }
}
