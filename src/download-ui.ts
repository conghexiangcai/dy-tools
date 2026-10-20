import {app,BrowserWindow,dialog,shell} from 'electron';
import path from 'node:path';
import {DownloadService} from './download-service';
import {validDownloaded} from './download-files';
export class DownloadUI{
 private preparing=false;private revision=0;
 get busy(){return this.preparing||this.service.busy}
 constructor(public service:DownloadService,private owner:()=>string,private window:()=>BrowserWindow,private idle:()=>Promise<void>,private changed:()=>void){}
 pause(){this.revision++;this.service.pause()}
 private check(p:any){if(!p?.owner||p.owner!==this.owner())throw Error('登录账号已变化，请重新连接');return p.owner as string}
 private directory(owner:string){return this.service.store.directory(owner)||path.join(app.getPath('downloads'),'抖音整理箱')}
 async command(method:string,p:any){
  if(method==='downloadState')return {...this.service.state(),busy:this.busy,directory:this.directory(this.owner())};
  const owner=this.check(p);
  if(method==='downloadPause'){this.pause();return true}
  if(method==='downloadInspect')return this.service.inspect(owner,String(p.id));
  if(method==='downloadOpen'){
   const run=this.service.inspect(owner,String(p.id));const item=run.items.find(i=>i.work.id===p.workId&&i.asset.key===p.assetKey);
   if(!item?.file||item.state!=='done'||!await validDownloaded(item.file))throw Error('已下载文件不存在或已改变');this.check(p);
   if(p.folder){shell.showItemInFolder(item.file.path);return true}if(!/\.(mp4|jpg|png|webp|gif|avif)$/i.test(item.file.path))throw Error('文件类型不支持打开');const error=await shell.openPath(item.file.path);if(error)throw Error('系统无法打开此媒体文件，可从保存目录查看');return true;
  }
  if(this.busy)throw Error('请等待当前操作结束或暂停下载');
  if(method==='downloadDirectory'){
   this.preparing=true;this.changed();try{const chosen=await dialog.showOpenDialog(this.window(),{title:'选择作品保存目录',defaultPath:this.directory(owner),properties:['openDirectory','createDirectory']});this.check(p);if(chosen.canceled)return false;this.service.store.setDirectory(owner,path.resolve(chosen.filePaths[0]));return true}finally{this.preparing=false;this.changed()}
  }
  if(!['downloadParse','downloadStart','downloadResume','downloadRetry','downloadVerified'].includes(method))throw Error('不支持的下载操作');
  const revision=++this.revision;this.preparing=true;this.changed();try{
   await this.idle();this.check(p);if(revision!==this.revision)throw Error('操作已取消');
   if(method==='downloadParse'){this.service.parse(owner,p.text);return true}
   if(method==='downloadStart'){const r=this.service.create(owner,this.directory(owner),p.selections);this.service.resume(owner,r.id);return r.id}
   this.service.resume(owner,p.id,method==='downloadRetry',method==='downloadVerified');return true;
  }finally{this.preparing=false;this.changed()}
 }
}
