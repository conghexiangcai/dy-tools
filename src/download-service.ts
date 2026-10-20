import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {CollectError} from './transport';
import {DownloadStore} from './download-store';
import {DownloadConnection,DownloadWire} from './download-wire';
import {DownloadRun,ResolvedWork,MediaWork,DownloadItem,downloadLinks,downloadMessage,publicWork,storedWork,fileKey} from './download-domain';
import {saveMedia,validDownloaded,savedInDirectory} from './download-files';
export class DownloadService{
 busy=false;message='粘贴分享链接，解析后选择作品下载';countdown=0;
 private closed=false;
 private generation=0;private abort=new AbortController();private activeOwner='';private currentRun:DownloadRun|null=null;
 private previews=new Map<string,ResolvedWork>();private parseLinks:string[]=[];private parseIndex=0;private parseErrors:{index:number;message:string}[]=[];private waiting='';private mode:'parse'|'download'|null=null;
 progress:{work_id:string;key:string;bytes:number;total:number|null}|null=null;
 constructor(public store:DownloadStore,private wire:DownloadWire,private owner:()=>string,private changed:()=>void,private sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
 state(){const owner=this.owner();if(this.activeOwner&&this.activeOwner!==owner){this.pause();this.activeOwner=owner;this.previews.clear();this.parseLinks=[];this.parseIndex=0;this.parseErrors=[];this.waiting='';this.currentRun=null;this.mode=null}
  return {owner,busy:this.busy,message:this.message,countdown:this.countdown,waiting:this.waiting,mode:this.mode,parse:{done:this.parseIndex,total:this.parseLinks.length,errors:this.parseErrors},previews:[...this.previews.values()].map(publicWork),run:this.currentRun?.owner===owner?this.store.run(owner,this.currentRun.id):null,runs:this.store.runs(owner).map(r=>({id:r.id,status:r.status,created_at:r.created_at,total:r.items.length,done:r.items.filter(i=>i.state==='done').length,message:r.message})),progress:this.progress};
 }
 pause(){this.generation++;this.abort.abort();if(this.busy){this.message='正在停止请求并保留下载记录';this.changed()}}
 close(){this.closed=true;this.pause()}
 private save(r:DownloadRun){if(!this.closed)this.store.save(r)}
 private assert(owner:string,token:number){if(this.owner()!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已变化');if(token!==this.generation||this.abort.signal.aborted)throw new CollectError('PAUSED','任务已暂停')}
 private async retry<T>(fn:()=>Promise<T>,owner:string,token:number):Promise<T>{for(let n=0;;n++){this.assert(owner,token);try{return await fn()}catch(e:any){if(n>=2||!['EMPTY','NETWORK','TIMEOUT'].includes(e.code))throw e;await this.sleep(1000);this.assert(owner,token)}}}
 private launch(owner:string,mode:'parse'|'download',body:(token:number)=>Promise<void>){
  if(this.busy)throw Error('已有下载任务运行，请先暂停');if(!owner||owner!==this.owner())throw Error('请先连接当前抖音账号');this.activeOwner=owner;this.mode=mode;this.busy=true;this.abort=new AbortController();const token=++this.generation;this.waiting='';this.changed();
  const activeRun=mode==='download'?this.currentRun:null;
  void body(token).catch(e=>{const message=downloadMessage(e);if(this.activeOwner===owner){this.message=message;this.waiting=e.code==='CAPTCHA'?'verification':e.code==='LOGIN'?'login':''}
   if(activeRun){activeRun.status=e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':'paused';activeRun.message=message;for(const i of activeRun.items)if(i.state==='downloading')i.state='pending';this.save(activeRun)}if(!this.closed&&this.activeOwner===owner&&['CAPTCHA','LOGIN'].includes(e.code))this.wire.show();
  }).finally(()=>{this.busy=false;this.countdown=0;this.progress=null;if(!this.closed)this.changed()}).catch(()=>{});
 }
 parse(owner:string,raw:string){const links=downloadLinks(raw);if(this.busy)throw Error('请先暂停当前任务');this.previews.clear();this.parseLinks=links;this.parseIndex=0;this.parseErrors=[];this.currentRun=null;this.launch(owner,'parse',t=>this.parseRest(owner,t));}
 private async parseRest(owner:string,t:number){
  const c=await this.retry(()=>this.wire.connect(owner),owner,t);this.assert(owner,t);
  while(this.parseIndex<this.parseLinks.length){this.message=`正在解析 ${this.parseIndex+1} / ${this.parseLinks.length}`;this.changed();
   try{const id=await this.retry(()=>c.resolve(this.parseLinks[this.parseIndex]),owner,t);this.assert(owner,t);if(!this.previews.has(id)){const w=await this.retry(()=>c.detail(id,this.abort.signal),owner,t);this.assert(owner,t);await c.assert();this.previews.set(id,w)}}catch(e:any){if(['PAUSED','ACCOUNT_CHANGED','CAPTCHA','LOGIN','RATE_LIMIT'].includes(e.code))throw e;this.parseErrors.push({index:this.parseIndex+1,message:downloadMessage(e)})}
   this.parseIndex++;this.changed();
  }
  this.message=`解析完成：${this.previews.size} 篇作品，${this.parseErrors.length} 条失败`;this.changed();
 }
 create(owner:string,directory:string,selections:{id:string;assets:string[];allowWatermarked?:boolean}[]):DownloadRun{
  if(this.busy)throw Error('请等待解析完成或暂停任务');if(owner!==this.activeOwner||owner!==this.owner())throw Error('账号已变化，请重新解析');
  if(!path.isAbsolute(directory)||!Array.isArray(selections)||!selections.length||selections.length>100)throw Error('请选择作品及保存目录');
  const items:DownloadItem[]=[],seen=new Set<string>();
  for(const s of selections){const w=this.previews.get(s.id);if(!w||!Array.isArray(s.assets))throw Error('作品预览已失效，请重新解析');const keys=[...new Set(s.assets)];if(w.kind==='video'&&keys.length!==1)throw Error('每个视频只能选择一种画质');
   for(const key of keys){const asset=w.assets.find(a=>a.key===key);if(!asset)throw Error('所选媒体不存在');if(asset.watermark==='yes'&&!s.allowWatermarked)throw Error('该视频只有带水印版本，请明确选择后下载');const identity=w.id+':'+key;if(seen.has(identity))continue;seen.add(identity);items.push({work:storedWork(w),asset:{...asset},state:'pending',message:''})}
  }
  if(!items.length||items.length>5000)throw Error('请选择 1 至 5000 个媒体文件');const now=new Date().toISOString(),r:DownloadRun={id:randomUUID(),owner,directory,items,status:'ready',message:'等待开始下载',created_at:now,updated_at:now};this.store.save(r);this.currentRun=r;this.changed();return r;
 }
 resume(owner:string,id?:string,retryFailed=false,verified=false){
  if(this.busy)throw Error('请等待当前请求停止');if(verified&&this.waiting!=='verification'&&this.store.run(owner,id||'')?.status!=='waiting_verification')throw Error('当前没有等待验证的下载任务');
  if(this.waiting==='verification'&&!verified)throw Error('请先完成验证码，再点击“已完成验证”等待五秒');
  if(!id&&this.mode==='parse'){this.launch(owner,'parse',async t=>{if(verified)await this.verifyWait(owner,t);await this.parseRest(owner,t)});return}
  const run=this.store.run(owner,id||this.currentRun?.id||'');if(!run)throw Error('找不到当前账号的下载任务');
  if(run.status==='waiting_verification'&&!verified)throw Error('请先完成验证码，再点击“已完成验证”等待五秒');
  if(retryFailed)for(const i of run.items)if(i.state==='failed'){i.state='pending';i.message=''}this.currentRun=run;
  this.launch(owner,'download',async t=>{if(verified)await this.verifyWait(owner,t);await this.download(run,t)});
 }
 private async verifyWait(owner:string,t:number){for(let n=5;n>0;n--){this.assert(owner,t);this.countdown=n;this.message=`验证完成，${n} 秒后检查`;this.changed();await this.sleep(1000)}this.countdown=0;this.assert(owner,t);if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证码尚未解除')}
 private async download(run:DownloadRun,t:number){
  const owner=run.owner,c=await this.retry(()=>this.wire.connect(owner),owner,t);this.assert(owner,t);const check=async()=>{this.assert(owner,t);await c.assert();this.assert(owner,t)};
  run.status='running';run.message='正在下载';this.save(run);const resolved=new Map<string,ResolvedWork>();
  for(const item of run.items){await check();
   if(item.state==='failed')continue;const old=item.file||this.store.file(owner,fileKey(item.work.id,item.asset));
   if(old&&await savedInDirectory(old.path,run.directory)&&await validDownloaded(old)){await check();item.file=old;item.state='done';item.message='已下载，文件校验通过';this.save(run);this.changed();continue}
   item.state='downloading';item.message='准备下载';this.save(run);this.message=`正在下载：${item.work.title||item.work.id} · ${item.asset.label}`;this.changed();
   try{
    let expiredRefresh=false;
    const file=await this.retry(async()=>{
     await check();let w=resolved.get(item.work.id);if(!w){w=await c.detail(item.work.id,this.abort.signal);await check();resolved.set(w.id,w)}
     const a=w.assets.find(a=>a.key===item.asset.key);if(!a||fileKey(w.id,a)!==fileKey(item.work.id,item.asset)||a.watermark!==item.asset.watermark||w.author.uid!==item.work.author.uid)throw new CollectError('VARIANT_CHANGED','作品资源版本已变化，请重新解析选择，避免下载错误版本');
     let last:any;for(const url of w.resources[a.key]){await check();try{
      const deadline=new AbortController(),timer=setTimeout(()=>deadline.abort(),30000),signal=AbortSignal.any([this.abort.signal,deadline.signal]);let r:Response;
      try{r=await c.open(url,signal)}catch(e){if(deadline.signal.aborted&&!this.abort.signal.aborted)throw new CollectError('TIMEOUT','媒体响应超时');throw e}finally{clearTimeout(timer)}await check();
      return await saveMedia(r,run.directory,w,a,this.abort.signal,check,(bytes,total)=>{this.progress={work_id:w!.id,key:a.key,bytes,total};this.changed()});
     }catch(e:any){if(['PAUSED','ACCOUNT_CHANGED','LOGIN','CAPTCHA','RATE_LIMIT','ENOSPC','EACCES','EPERM','PATH','CONTENT'].includes(e.code))throw e;last=e}}
     if(last?.code==='RESOURCE_EXPIRED'&&!expiredRefresh){expiredRefresh=true;resolved.delete(w.id);throw new CollectError('NETWORK','资源过期，正在重新解析')}
     throw last||new CollectError('EMPTY','没有可用的媒体地址');
    },owner,t);
    // The file is retained even if an account switch happens immediately after completion.
    await check();this.store.saveFile(owner,file);item.file=file;item.state='done';item.message='下载完成';
   }catch(e:any){if(['PAUSED','ACCOUNT_CHANGED','LOGIN','CAPTCHA','RATE_LIMIT','ENOSPC','EACCES','EPERM'].includes(e.code))throw e;item.state='failed';item.message=downloadMessage(e)}
   this.progress=null;this.save(run);this.changed();
  }
  run.status='completed';const failed=run.items.filter(i=>i.state==='failed').length;run.message=`已完成 ${run.items.filter(i=>i.state==='done').length} / ${run.items.length} 个文件${failed?'，失败 '+failed+' 个，可重试':''}`;this.message=run.message;this.save(run);this.changed();
 }
 inspect(owner:string,id:string){const r=this.store.run(owner,id);if(!r)throw Error('下载任务不存在');return r}
}

