import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {mkdir,realpath,lstat,open,link,unlink,copyFile} from 'node:fs/promises';
import {CollectError} from './transport';
import {DownloadFile,MediaAsset,MediaWork,fileKey,mediaSignature,safeStem} from './download-domain';
export async function validDownloaded(f:DownloadFile):Promise<boolean>{
 try{const s=await lstat(f.path);if(!s.isFile()||s.isSymbolicLink()||s.size!==f.bytes||!s.size)return false;const hash=createHash('sha256');for await(const b of createReadStream(f.path))hash.update(b);return hash.digest('hex')===f.sha256}catch{return false}
}
export async function savedInDirectory(file:string,root:string):Promise<boolean>{try{const base=await realpath(root),actual=await realpath(file);const relative=path.relative(base,actual);return !!relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)}catch{return false}}
export async function targetDirectory(root:string,work:MediaWork){
 await mkdir(root,{recursive:true});const base=await realpath(root),name=work.id+'－'+safeStem(work.title);
 if(base.length+name.length+65>240)throw new CollectError('PATH','保存目录太深，请选择较短的目录');
 const folder=path.join(base,name);await mkdir(folder,{recursive:true});const info=await lstat(folder);if(!info.isDirectory()||info.isSymbolicLink())throw new CollectError('PATH','作品目录不是普通文件夹');
 if(path.dirname(await realpath(folder))!==base)throw new CollectError('PATH','作品目录超出所选保存位置');return folder;
}
export async function saveMedia(response:Response,root:string,work:MediaWork,asset:MediaAsset,signal:AbortSignal,assert:()=>Promise<void>,progress:(bytes:number,total:number|null)=>void):Promise<DownloadFile>{
 if([401,403,404,410].includes(response.status)){await response.body?.cancel();throw new CollectError('RESOURCE_EXPIRED','资源地址已失效')}
 if(response.status===429){await response.body?.cancel();throw new CollectError('RATE_LIMIT','下载服务限制请求频率')}
 if(response.status!==200||!response.body){await response.body?.cancel();throw new CollectError('NETWORK','媒体响应不完整')}
 const contentType=(response.headers.get('content-type')||'').split(';')[0].toLowerCase();
 if(/text\/|json|html|xml/.test(contentType)||contentType&&!(contentType.startsWith(asset.kind+'/')||contentType==='application/octet-stream'||contentType==='binary/octet-stream')){await response.body.cancel();throw new CollectError('CONTENT','返回的内容不是所选媒体文件')}
 const lengthHeader=response.headers.get('content-length'),expected=lengthHeader&&/^\d+$/.test(lengthHeader)?Number(lengthHeader):null;
 if(expected===0||expected!==null&&!Number.isSafeInteger(expected)){await response.body.cancel();throw new CollectError('CONTENT','媒体大小无效')}
 let folder:string,part:string,file:Awaited<ReturnType<typeof open>>;
 try{folder=await targetDirectory(root,work);part=path.join(folder,'.'+randomUUID()+'.part');file=await open(part,'wx')}catch(e){await response.body.cancel().catch(()=>{});throw e}
 const reader=response.body.getReader(),hash=createHash('sha256');let bytes=0,head=Buffer.alloc(0),format:ReturnType<typeof mediaSignature>=null,lastProgress=0;
 const abort=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',abort,{once:true});
 try{
  for(;;){if(signal.aborted)throw new CollectError('PAUSED','下载已暂停');
   let timeout:NodeJS.Timeout|undefined;const next=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>{void reader.cancel().catch(()=>{});reject(new CollectError('TIMEOUT','媒体数据长时间未响应'))},20000)})]).finally(()=>clearTimeout(timeout));
   if(next.done)break;const chunk=Buffer.from(next.value);if(head.length<32){head=Buffer.concat([head,chunk.subarray(0,32-head.length)]);if(head.length>=16){format=mediaSignature(head,asset.kind);if(!format)throw new CollectError('CONTENT','文件内容不符合图片或 MP4 格式')}}
   let offset=0;while(offset<chunk.length){const written=await file.write(chunk,offset,chunk.length-offset);offset+=written.bytesWritten}
   hash.update(chunk);bytes+=chunk.length;if(Date.now()-lastProgress>200){lastProgress=Date.now();progress(bytes,expected);await assert()}
  }
  if(signal.aborted)throw new CollectError('PAUSED','下载已暂停');if(!format||bytes<32||expected!==null&&bytes!==expected)throw new CollectError('CONTENT','文件为空或下载长度不完整');
  await assert();await file.sync();await file.close();let final='';
  const stem=asset.kind==='image'?String(asset.index).padStart(3,'0'):'视频';
  for(let n=0;n<10000;n++){
   const candidate=path.join(folder,stem+(n?' ('+n+')':'')+'.'+format.extension);
   try{await assert();try{await link(part,candidate)}catch(e:any){if(!['EPERM','ENOTSUP','EXDEV','ENOSYS'].includes(e.code))throw e;await copyFile(part,candidate,constants.COPYFILE_EXCL)}final=candidate;break}catch(e:any){if(e.code==='EEXIST')continue;throw e}
  }
  if(!final)throw new CollectError('PATH','同名文件太多，请选择其他保存目录');await unlink(part).catch(()=>{});progress(bytes,expected);
  return {key:fileKey(work.id,asset),work_id:work.id,asset:{...asset},path:final,bytes,sha256:hash.digest('hex'),completed_at:new Date().toISOString()};
 }finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});await file.close().catch(()=>{});await unlink(part).catch(()=>{})}
}
