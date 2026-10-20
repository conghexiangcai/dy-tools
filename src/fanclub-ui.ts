import {BrowserWindow,dialog} from 'electron';
import {writeFileSync} from 'node:fs';
import path from 'node:path';
import {FanService} from './fanclub-service';
import {fanExport} from './fanclub';
import {appURL} from './browser';
export class FanUI {
  window:BrowserWindow|null=null;
  constructor(public service:FanService,private preload:string,private stopCollector:()=>Promise<void>,private login:()=>Promise<void>,private connect:()=>Promise<void>,private profile:(uid:string,sec:string,nickname:string)=>Promise<void>){}
  owns(id:number){return this.window?.webContents.id===id}
  async open(){if(this.window&&!this.window.isDestroyed()){this.window.show();this.window.focus();return}this.window=new BrowserWindow({width:1350,height:870,minWidth:900,minHeight:650,title:'粉丝团查询 · 抖音工具箱',show:false,autoHideMenuBar:true,webPreferences:{preload:this.preload,contextIsolation:true,nodeIntegration:false,sandbox:true}});this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.window.webContents.on('will-navigate',e=>e.preventDefault());this.window.on('closed',()=>{this.window=null});await this.window.loadURL(appURL+'fanclub.html');this.window.show()}
  notify(){if(this.window&&!this.window.isDestroyed())this.window.webContents.send('desktop:change',{fanclub:true})}
  destroy(){this.service.pause();this.window?.destroy();this.window=null}
  async command(method:string,p:any){
    if(!['fanState','fanLogin','fanConnect'].includes(method)&&p?.owner!==this.service.state().owner)throw Error('页面登录账号已变更，请重新操作');
    switch(method){
      case 'fanState':return this.service.state();
      case 'fanLogin':this.service.pause();await this.stopCollector();await this.login();return true;
      case 'fanConnect':this.service.pause();await this.stopCollector();await this.connect();return true;
      case 'fanResolve':case 'fanAdd':await this.stopCollector();return this.service.resolve(p?.input,method==='fanAdd');
      case 'fanEdit':if(!p||typeof p.uid!=='string')throw Error('主播编号无效');this.service.edit(p.uid,p);return true;
      case 'fanRemove':this.service.remove(String(p?.uid));return true;
      case 'fanStart':await this.stopCollector();await this.service.start();return true;
      case 'fanPause':this.service.pause();return true;
      case 'fanResume':case 'fanRetry':case 'fanVerified':await this.stopCollector();await this.service.resume(method==='fanVerified',method==='fanRetry');return true;
      case 'fanProfile':{const s=this.service.state();const users=[s.target,s.run?.target,...s.anchors,...s.run?.anchors||[]];const u=users.find(u=>u?.uid===p?.uid);if(!u)throw Error('账号已变更');await this.profile(u.uid,u.sec_uid,u.nickname);return true;}
      case 'fanExport':{const r=this.service.state().run;if(!r)throw Error('尚无查询结果');const format=p?.format;if(!['html','json','md'].includes(format))throw Error('导出格式无效');const save=await dialog.showSaveDialog(this.window!,{defaultPath:path.join(process.env.USERPROFILE||'.','Documents','粉丝团查询-'+new Date().toISOString().slice(0,10)+'.'+format),filters:[{name:format.toUpperCase(),extensions:[format]}]});if(save.canceled||!save.filePath)return false;writeFileSync(save.filePath,fanExport(r,format),'utf8');return true}
      default:throw Error('不支持的粉丝团操作');
    }
  }
}
