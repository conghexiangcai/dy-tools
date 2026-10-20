import {Session,session} from 'electron';
import {createHash} from 'node:crypto';
import {DouyinTransport} from './browser';
import {DouyinFanWire} from './fanclub-wire';
import {fanLink} from './fanclub';
import {CollectError} from './transport';
import {mediaURL,parseMedia,ResolvedWork,workInput} from './download-domain';
import {captureWorkDetail} from './download-page';
export interface DownloadConnection{assert():Promise<void>;resolve(link:string):Promise<string>;detail(id:string,signal?:AbortSignal):Promise<ResolvedWork>;open(url:string,signal:AbortSignal):Promise<Response>}
export interface DownloadWire{connect(owner:string):Promise<DownloadConnection>;show():void;challenge():Promise<boolean>}
export class DouyinDownloadWire implements DownloadWire{
 private last=0;private media:Session;
 constructor(private login:Session,private transport:DouyinTransport){
  this.media=session.fromPartition('organizer-download-media');
  // A dedicated cookie-free session lets every redirect be checked without replacing other modules' handlers.
  this.media.webRequest.onBeforeRequest((d,cb)=>{try{mediaURL(d.url);cb({cancel:false})}catch{cb({cancel:true})}});
  this.media.setPermissionRequestHandler((_w,_p,done)=>done(false));this.media.setPermissionCheckHandler(()=>false);
 }
 show(){this.transport.show()}
 challenge(){return this.transport.challenge()}
 async connect(owner:string):Promise<DownloadConnection>{
  const fingerprint=async()=>createHash('sha256').update((await this.login.cookies.get({url:'https://www.douyin.com'})).filter(c=>/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)$/.test(c.name)).map(c=>c.name+'='+c.value).sort().join(';')).digest('hex');
  const before=await fingerprint();if((await this.transport.owner()).uid!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已变化');
  const assert=async()=>{if(await fingerprint()!==before)throw new CollectError('ACCOUNT_CHANGED','登录会话已变化');};await assert();
  const wait=async()=>{await new Promise(r=>setTimeout(r,Math.max(0,1000-(Date.now()-this.last))));await assert();this.last=Date.now()};
  const short=new DouyinFanWire(this.login,this.transport);
  return {assert,resolve:async(link)=>{
   let input=workInput(link);for(let n=0;n<6&&input.kind==='url';n++){await wait();const next=await short.expandLink(input.value);input=workInput(fanLink(new URL(next,input.value).href).href)}
   if(input.kind!=='work')throw new CollectError('INPUT','分享链接跳转次数过多');await assert();return input.value;
  },detail:async(id,signal)=>{
   if(!/^[1-9]\d{0,31}$/.test(id))throw new CollectError('INPUT','作品 ID 无效');
   return this.transport.exclusive(async()=>{await wait();const wc=await this.transport.ensure();if(new URL(wc.getURL()).origin!=='https://www.douyin.com')throw new CollectError('CAPTCHA','请返回抖音完成验证');wc.setAudioMuted(true);
    let d:any;try{d=await captureWorkDetail(wc,id,30000,signal)}catch(e:any){if(['EMPTY','TIMEOUT','SESSION_CONTEXT'].includes(e.code)&&await this.transport.challenge())throw new CollectError('CAPTCHA','请完成验证码');throw e}
    await assert();return parseMedia(d,id);
   });
  },open:async(url,signal)=>{
   await assert();mediaURL(url);try{return await this.media.fetch(url,{method:'GET',credentials:'omit',cache:'no-store',redirect:'follow',headers:{Referer:'https://www.douyin.com/'},signal})}catch(e){if(signal.aborted)throw new CollectError('PAUSED','下载已暂停');throw new CollectError('NETWORK','媒体连接失败')}
  }};
 }
}

