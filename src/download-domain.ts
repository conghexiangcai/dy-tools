import {fanInput,normalizeShare} from './fanclub';
import {CollectError} from './transport';
export type Watermark='none'|'yes'|'unknown';
export type MediaAsset={key:string;kind:'video'|'image';index:number;width:number;height:number;bitrate:number;codec:string;watermark:Watermark;label:string};
export type MediaWork={id:string;title:string;author:{uid:string;name:string};kind:'video'|'images';cover:string;assets:MediaAsset[];checked_at:string};
export type ResolvedWork=MediaWork&{resources:Record<string,string[]>};
export type DownloadFile={key:string;work_id:string;asset:MediaAsset;path:string;bytes:number;sha256:string;completed_at:string};
export type DownloadItem={work:MediaWork;asset:MediaAsset;state:'pending'|'downloading'|'done'|'failed';message:string;file?:DownloadFile};
export type DownloadRun={id:string;owner:string;directory:string;items:DownloadItem[];status:'ready'|'running'|'paused'|'waiting_login'|'waiting_verification'|'cooldown'|'completed'|'error';message:string;created_at:string;updated_at:string};
export function downloadLinks(raw:unknown):string[]{
 if(typeof raw!=='string'||!raw.trim()||raw.length>100_000)throw Error('请粘贴作品分享文案，最多 10 万字');
 const links=[...new Set((normalizeShare(raw).match(/https:\/\/[^\s<>"“”‘’\u3000]+/gi)||[]).map(x=>x.replace(/[，。；：）)\]】》！!、]+$/,'')))];
 if(!links.length)throw Error('没有找到抖音作品链接');if(links.length>100)throw Error('每次最多解析 100 条不同链接');return links;
}
export function workInput(raw:string){const i=fanInput(raw);if(i.kind!=='work'&&i.kind!=='url')throw new CollectError('INPUT','请提供作品链接；本功能不下载整个主页');return i}
// Extend only after inspecting an actual official response. No arbitrary URLs from IPC.
export const mediaDomains=['douyinvod.com','douyinpic.com'];
export function mediaURL(raw:unknown):string{
 if(typeof raw!=='string'||raw.length>16000)throw new CollectError('MEDIA_HOST','媒体地址格式异常');let u:URL;try{u=new URL(raw)}catch{throw new CollectError('MEDIA_HOST','媒体地址无效')}
 if(u.protocol!=='https:'||u.username||u.password||u.port&&!['443'].includes(u.port)||!mediaDomains.some(h=>u.hostname===h||u.hostname.endsWith('.'+h)))throw new CollectError('MEDIA_HOST','作品返回了尚未核验的媒体域名，已停止下载');
 return u.href;
}
const num=(n:any)=>Number.isSafeInteger(n)&&n>=0?n:0;
const id=(v:any)=>typeof v==='string'&&/^[1-9]\d{0,31}$/.test(v)?v:typeof v==='number'&&Number.isSafeInteger(v)&&v>0?String(v):null;
export function parseMedia(data:any,expected:string):ResolvedWork{
 if(data?.status_code!==undefined&&data.status_code!==0)throw new CollectError('API','作品接口未接受请求');const a=data?.aweme_detail;
 if(!a||id(a.aweme_id)!==expected)throw new CollectError('IDENTITY','作品已失效、无权查看或返回了其他作品');
 const author=id(a.author?.uid);if(!author)throw new CollectError('SCHEMA','作品作者身份缺失');
 const assets:MediaAsset[]=[],resources:Record<string,string[]>={};
 const add=(key:string,kind:'video'|'image',index:number,addr:any,info:any={},watermark:Watermark='unknown')=>{
  if(!addr||!Array.isArray(addr.url_list)||!addr.url_list.length)return;
  if(kind==='video'&&(addr.is_dash===1||info.is_dash===1||info.is_bytevc1===1||info.format&&info.format!=='mp4'))return;
  const urls=[...new Set<string>(addr.url_list.flatMap((u:unknown)=>{try{return [mediaURL(u)]}catch{return []}}))];if(!urls.length)throw new CollectError('MEDIA_HOST','作品没有已核验域名的媒体地址，已停止下载');
  const width=num(addr.width)||num(info.width),height=num(addr.height)||num(info.height),bitrate=num(info.bit_rate),codec=typeof info.codec_type==='string'?info.codec_type.slice(0,32):info.is_h265===1?'H.265':info.is_h265===0?'H.264':'';
  resources[key]=urls;assets.push({key,kind,index,width,height,bitrate,codec,watermark,label:kind==='image'?`图片 ${index}`:`${width&&height?width+' × '+height:'分辨率未知'}${bitrate?' · '+Math.round(bitrate/1000)+' kbps':''}${codec?' · '+codec:''}`});
 };
 if(Array.isArray(a.images)&&a.images.length){
  a.images.forEach((image:any,i:number)=>{if(image?.video)throw new CollectError('UNSUPPORTED','含动态照片的图集尚未验证支持');add('image-'+(i+1),'image',i+1,image,image,'unknown')});
  if(assets.length!==a.images.length)throw new CollectError('SCHEMA','图集有图片地址缺失，不能当作完整图集下载');
 }else{
  if(a.aweme_type===68)throw new CollectError('SCHEMA','图文作品的图片列表缺失，不能用背景音乐代替');
  const v=a.video;if(!v)throw new CollectError('UNSUPPORTED','当前作品没有可支持的视频或图集资源');
  // Watermark facts are scoped to the address, not inferred from a download flag.
  const water=(addr:any):Watermark=>{const urls=(addr?.url_list||[]).flatMap((s:unknown)=>{try{if(typeof s!=='string')return [];return [new URL(s)]}catch{return []}}) as URL[];
   if(urls.some(u=>mediaDomains.some(h=>u.hostname===h||u.hostname.endsWith('.'+h))&&(u.searchParams.get('logo_type')==='aweme_search_suffix'||u.searchParams.get('watermark')==='1')))return 'yes';
   return addr?.has_watermark===false||addr?.has_watermark===0?'none':addr?.has_watermark===true||addr?.has_watermark===1?'yes':'unknown'};
  if(Array.isArray(v.bit_rate))v.bit_rate.forEach((b:any,i:number)=>{if(b?.is_dash===1||b?.play_addr?.is_dash===1)return;add('rate-'+i,'video',1,b.play_addr,b,water(b.play_addr))});
  add('play','video',1,v.play_addr,v,water(v.play_addr));add('download','video',1,v.download_addr,v,water(v.download_addr));
 }
 if(!assets.length)throw new CollectError('UNSUPPORTED','作品未提供可直接下载的完整媒体文件');
 let cover='';for(const u of a.video?.cover?.url_list||a.images?.[0]?.url_list||[]){try{cover=mediaURL(u);break}catch{}}
 return {id:expected,title:typeof a.desc==='string'?a.desc.slice(0,2000):'',author:{uid:author,name:String(a.author.nickname||'').slice(0,120)},kind:assets[0].kind==='image'?'images':'video',cover,assets,resources,checked_at:new Date().toISOString()};
}
export function publicWork(w:MediaWork):MediaWork{return {id:w.id,title:w.title,author:{...w.author},kind:w.kind,cover:w.cover,assets:w.assets.map(a=>({...a})),checked_at:w.checked_at}}
export function storedWork(w:MediaWork):MediaWork{return {...publicWork(w),cover:''}}
export function preferredAssets(w:MediaWork):string[]{
 if(w.kind==='images')return w.assets.map(a=>a.key);
 const rank=(a:MediaAsset)=>a.watermark==='none'?0:a.watermark==='unknown'?1:2;
 const best=[...w.assets].sort((a,b)=>rank(a)-rank(b)||b.width*b.height-a.width*a.height||b.bitrate-a.bitrate||a.key.localeCompare(b.key))[0];
 return best&&best.watermark!=='yes'?[best.key]:[];
}
export function safeStem(s:string,max=42){return s.replace(/[<>:"/\\|?*\u0000-\u001f]/g,'_').replace(/[. ]+$/,'').trim().slice(0,max).replace(/[. ]+$/,'')||'未命名作品'}
export function fileKey(workId:string,a:MediaAsset){return `${workId}:${a.key}:${a.width}x${a.height}:${a.bitrate}:${a.codec}`}
export function mediaSignature(b:Buffer,kind:'video'|'image'):{extension:string;mime:string}|null{
 if(kind==='image'){
  if(b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff)return {extension:'jpg',mime:'image/jpeg'};
  if(b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {extension:'png',mime:'image/png'};
  if(b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP')return {extension:'webp',mime:'image/webp'};
  if(/^GIF8[79]a/.test(b.toString('ascii',0,6)))return {extension:'gif',mime:'image/gif'};
  if(b.toString('ascii',4,8)==='ftyp'&&['avif','avis'].includes(b.toString('ascii',8,12)))return {extension:'avif',mime:'image/avif'};
 }else if(b.toString('ascii',4,8)==='ftyp'&&['isom','iso2','iso5','iso6','mp41','mp42','avc1','M4V ','dash'].includes(b.toString('ascii',8,12)))return {extension:'mp4',mime:'video/mp4'};
 return null;
}
export function downloadMessage(e:any){const code=String(e?.code||'ERROR');const fixed:Record<string,string>={ENOSPC:'磁盘空间不足，请清理空间或选择其他目录',EACCES:'没有写入目录的权限',EPERM:'文件被占用或无写入权限',NETWORK:'网络连接失败，请重试',TIMEOUT:'媒体请求超时，请重试',EMPTY:'作品接口返回空内容，请稍后重试',LOGIN:'登录已失效，请重新登录',CAPTCHA:'请在抖音窗口完成验证码',ACCOUNT_CHANGED:'登录账号已变化，任务已暂停',RATE_LIMIT:'接口限制请求频率，请稍后继续',PAUSED:'已暂停，可继续下载',RESOURCE_EXPIRED:'资源地址已失效，请重新解析后重试'};return fixed[code]||(typeof e?.message==='string'?e.message.replace(/https?:\/\/\S+/g,'[媒体地址]').replace(/(?:cookie|token|authorization)\s*[:=]\s*\S+/gi,'[认证已隐藏]').slice(0,200):'下载失败，请重试')}
