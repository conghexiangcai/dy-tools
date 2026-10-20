import type {WebContents} from 'electron';
import {CollectError} from './transport';import {losslessJSON} from './groups';
// The current official detail endpoint requires a page-generated signature. Observe
// only that endpoint while the official work page generates its normal read request.
// Signed URLs and response bodies remain in the main process and are never logged.
export async function captureWorkDetail(wc:WebContents,id:string,timeoutMs=30000,signal?:AbortSignal):Promise<any>{
 if(!/^[1-9]\d{0,31}$/.test(id))throw new CollectError('INPUT','作品 ID 无效');
 if(signal?.aborted)throw new CollectError('PAUSED','任务已暂停');const debug=wc.debugger;if(debug.isAttached())throw new CollectError('SESSION_CONTEXT','采集窗口正在被调试，请关闭开发者工具后重试');
 debug.attach('1.3');
 try{
  await debug.sendCommand('Network.enable');
  return await new Promise((resolve,reject)=>{
   let finished=false;const pending=new Set<string>();
   const finish=(error:Error|null,value?:any)=>{if(finished)return;finished=true;clearTimeout(timer);debug.removeListener('message',message);wc.removeListener('destroyed',destroyed);signal?.removeEventListener('abort',aborted);error?reject(error):resolve(value)};
   const destroyed=()=>finish(new CollectError('NETWORK','作品页面已关闭'));
   const aborted=()=>finish(new CollectError('PAUSED','任务已暂停'));
   const timer=setTimeout(()=>finish(new CollectError('TIMEOUT','官方作品页未返回详情，请检查作品是否失效或需要验证')),timeoutMs);
   const message=async(_event:any,method:string,p:any)=>{
    if(finished)return;
    if(method==='Network.responseReceived'){
     let u:URL;try{u=new URL(p.response.url)}catch{return}
     if(u.origin!=='https://www.douyin.com'||u.pathname!=='/aweme/v1/web/aweme/detail/'||u.searchParams.get('aweme_id')!==id)return;
     if(p.response.status!==200){finish(new CollectError(p.response.status===429?'RATE_LIMIT':p.response.status===401?'LOGIN':'SESSION_CONTEXT','官方作品详情请求失败（'+p.response.status+'）'));return}
     pending.add(p.requestId);
    }
    if(method==='Network.loadingFailed'&&pending.delete(p.requestId))finish(new CollectError('NETWORK','作品详情请求中断'));
    if(method==='Network.loadingFinished'&&pending.delete(p.requestId)){
     try{if(p.encodedDataLength>30_000_000)throw new CollectError('SCHEMA','作品详情响应过大');
      const b=await debug.sendCommand('Network.getResponseBody',{requestId:p.requestId});if(finished)return;
      const raw=b.base64Encoded?Buffer.from(b.body,'base64').toString('utf8'):b.body;
      if(!raw)throw new CollectError('EMPTY','作品详情返回空内容');let d:any;try{d=losslessJSON(raw)}catch{throw new CollectError('EMPTY','作品详情没有返回有效数据')}
      if(d.verify_type||d.verify_center_decision_conf||d.verify_detail)throw new CollectError('CAPTCHA','请完成作品页面验证');
      if([8,20003].includes(d.status_code))throw new CollectError('LOGIN','登录已失效');
      if(d.status_code!==0)throw new CollectError('API','作品接口未接受请求（'+String(d.status_code).slice(0,16)+'）');
      if(String(d.aweme_detail?.aweme_id)!==id)throw new CollectError('IDENTITY','作品失效、无权查看或返回作品不符');
      finish(null,d);
     }catch(e){finish(e instanceof Error?e:new CollectError('NETWORK','作品详情读取失败'))}
    }
   };
   debug.on('message',message);wc.once('destroyed',destroyed);signal?.addEventListener('abort',aborted,{once:true});if(signal?.aborted){aborted();return}
   // Image albums redirect /video/ to /note/ and report ERR_ABORTED on the first load.
   void wc.loadURL('https://www.douyin.com/video/'+id).catch(e=>{if(e.code!=='ERR_ABORTED'&&e.errno!==-3)finish(new CollectError('NETWORK','作品页面加载失败'))});
  });
 }finally{if(debug.isAttached())debug.detach()}
}
