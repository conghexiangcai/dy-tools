import {app,BrowserWindow,dialog,Session,safeStorage} from 'electron';
import {readFileSync,writeFileSync,existsSync,renameSync,mkdirSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {CheckinAuth,CheckinHTTP,parseCheckinAuth} from './checkin-wire';
import {CheckinService} from './checkin-service';
import {CheckinStore} from './checkin-store';
import {CheckinSchedule,normalizeSchedule,scheduleTimes,windowsTaskXML,chinaDate,chinaTime} from './checkin-schedule';
import {checkinExport,decimal} from './checkin-domain';
import {CheckinAlerts,CheckinMailStore,mailSettings,mailAuth,MailAuth,MailError} from './checkin-mail';
const exec=promisify(execFile);
export class CheckinUI {
 readonly store:CheckinStore;readonly service:CheckinService;readonly mailStore:CheckinMailStore;readonly alerts:CheckinAlerts;notice='';private configBusy=false;
 constructor(private directory:string,private session:Session,private owner:()=>string,private window:()=>BrowserWindow,private idle:()=>Promise<void>,private notify:()=>void,blocked?:(code:string)=>Promise<void>){
  this.store=new CheckinStore(path.join(directory,'checkin.sqlite'));
  this.mailStore=new CheckinMailStore(this.store.db);this.alerts=new CheckinAlerts(this.mailStore,o=>this.mailStore.settings(o),(o,from)=>this.mailAuth(o,from),undefined,notify);
  const wire=new CheckinHTTP(()=>this.auth(this.owner()),(u,p)=>this.session.fetch(u,p),{assertOwner:async()=>this.owner()});
  this.service=new CheckinService(this.store,wire,owner,notify,{blocked,finished:r=>this.alerts.report(r)});
 }
 get busy(){return this.service.busy||this.configBusy}
 pause(){this.service.pause()}
 private authPath(owner:string){decimal(owner);return path.join(this.directory,'checkin-auth-'+owner+'.bin')}
 async auth(owner:string):Promise<CheckinAuth>{
  const file=this.authPath(owner);if(existsSync(file)){if(!safeStorage.isEncryptionAvailable())throw Error('本机加密凭据暂不可解密，请重新登录');return parseCheckinAuth(JSON.parse(safeStorage.decryptString(readFileSync(file))))}
  const cookies=await this.session.cookies.get({url:'https://www.douyin.com'});return parseCheckinAuth({version:1,owner_uid:owner,douyin_cookie:cookies.map(c=>c.name+'='+c.value).join('; ')});
 }
 private mailPath(owner:string){decimal(owner);return path.join(this.directory,'checkin-mail-'+owner+'.bin')}
 private async mailAuth(owner:string,from:string):Promise<MailAuth>{try{if(!safeStorage.isEncryptionAvailable())throw Error();return mailAuth(JSON.parse(safeStorage.decryptString(readFileSync(this.mailPath(owner)))),from)}catch{throw new MailError('AUTH_CONFIG','邮箱授权码未保存、无法解密或发件人已变化，请重新填写并保存')}}
 state(){const s=this.service.state();return {...s,busy:this.busy,notice:this.notice,mail:{settings:this.mailStore.settings(s.owner),has_auth:!!s.owner&&existsSync(this.mailPath(s.owner)),last:this.mailStore.latest(s.owner)},auth_source:s.owner&&existsSync(this.authPath(s.owner))?'导入认证（本机加密保存）':'软件抖音登录',times:scheduleTimes(s.schedule),verification:'粉丝团名单、日历与无圈子普通签到已实测；需加入圈子的项目跳过。'}}
 private assert(p:any){const owner=this.owner();if(!owner||p?.owner!==owner)throw Error('请先连接当前账号，再重新操作');return owner}
 private async savedAuth(owner:string,auth:CheckinAuth){if(this.owner()!==owner)throw Error('账号已切换，未保存认证');if(!safeStorage.isEncryptionAvailable())throw Error('本机加密服务不可用，未保存凭据');const file=this.authPath(owner),temp=file+'.tmp';writeFileSync(temp,safeStorage.encryptString(JSON.stringify(auth)));renameSync(temp,file)}
 async command(method:string,p:any){
  if(method==='checkinState')return this.state();if(method==='checkinPreviewSchedule')return scheduleTimes(normalizeSchedule(p.schedule));const owner=this.assert(p);if(this.configBusy&&method!=='checkinPause')throw Error('正在检查或保存认证、定时配置，请稍后重试');
  switch(method){
   case 'checkinSaveMail':{if(this.busy)throw Error('请等待当前任务完成或暂停后保存邮箱设置');const settings=mailSettings(p.settings);const code=typeof p.auth_code==='string'?p.auth_code.trim():'';
    if(code){const auth=mailAuth({version:1,from:settings.from,auth_code:code},settings.from);if(!safeStorage.isEncryptionAvailable())throw Error('本机加密服务不可用，未保存邮箱授权码');const file=this.mailPath(owner),tmp=file+'.tmp';writeFileSync(tmp,safeStorage.encryptString(JSON.stringify({version:1,...auth})));renameSync(tmp,file)}else if(settings.enabled)await this.mailAuth(owner,settings.from);
    this.assert(p);this.mailStore.saveSettings(owner,settings);this.notice=settings.enabled?'失败邮件告警已启用；每轮汇总、同类问题按间隔提醒':'邮件设置已保存，自动告警关闭';this.notify();return true;
   }
   case 'checkinTestMail':{if(this.busy)throw Error('请等待当前任务完成或暂停后测试邮件');this.configBusy=true;this.notify();try{await this.alerts.test(owner);this.notice='QQ 邮箱已接受测试邮件，请检查收件箱及垃圾箱'}finally{this.configBusy=false;this.notify()}return true}
   case 'checkinPause':this.pause();return true;
   case 'checkinPreviewSchedule':return scheduleTimes(normalizeSchedule(p.schedule));
   case 'checkinInspect':case 'checkinStart':case 'checkinResume':case 'checkinVerified':
    await this.idle();this.assert(p);if(method==='checkinResume'||method==='checkinVerified')await this.service.resume(method==='checkinVerified');else await this.service.start(method==='checkinInspect'?'inspect':'sign');return true;
   case 'checkinCheckAuth':{if(this.busy)throw Error('请先暂停打卡任务');this.configBusy=true;this.notify();try{await this.idle();await new CheckinHTTP(()=>this.auth(owner),(u,p)=>this.session.fetch(u,p)).connect(owner);this.assert(p);this.notice='认证有效，账号身份已匹配'}finally{this.configBusy=false;this.notify()}return true}
   case 'checkinUseLogin':{if(this.busy)throw Error('请先暂停任务并等待当前请求完成');const file=this.authPath(owner);if(existsSync(file))unlinkSync(file);this.notice='已改用软件抖音窗口登录；请点击检查认证';this.notify();return true}
   case 'checkinImportAuth':{
    if(this.busy)throw Error('请先暂停任务并等待当前请求完成');this.configBusy=true;this.notify();try{const pick=await dialog.showOpenDialog(this.window(),{properties:['openFile'],filters:[{name:'认证 JSON',extensions:['json']}]});if(pick.canceled)return false;this.assert(p);
    const text=readFileSync(pick.filePaths[0],'utf8');if(text.length>150000)throw Error('认证文件过大');const auth=parseCheckinAuth(JSON.parse(text));if(auth.owner_uid!==owner)throw Error('认证文件属于其他账号');await this.idle();
    await new CheckinHTTP(async()=>auth,(u,p)=>this.session.fetch(u,p)).connect(owner);await this.savedAuth(owner,auth);this.notice='新认证通过身份检查，已加密替换；原打卡记录保留'}finally{this.configBusy=false;this.notify()}return true;
   }
   case 'checkinExportAuth':{
    if(this.busy)throw Error('请先暂停任务');this.configBusy=true;this.notify();try{await this.idle();const auth=await this.auth(owner);await new CheckinHTTP(async()=>auth,(u,p)=>this.session.fetch(u,p)).connect(owner);this.assert(p);
    const pick=await dialog.showSaveDialog(this.window(),{title:'导出服务器认证（含登录凭据，请仅保存到本人服务器）',defaultPath:path.join(app.getPath('documents'),'credentials.json'),filters:[{name:'认证 JSON',extensions:['json']}]});if(pick.canceled||!pick.filePath)return false;this.assert(p);writeFileSync(pick.filePath,JSON.stringify({...auth,updated_at:new Date().toISOString()},null,2),{mode:0o600});this.notice='已导出服务器认证。到期后重新登录并导出，替换服务器 credentials.json';return true}finally{this.configBusy=false;this.notify()}
   }
   case 'checkinExport':{const r=this.store.latest(owner);if(!r)throw Error('尚无打卡记录');const pick=await dialog.showSaveDialog(this.window(),{defaultPath:path.join(app.getPath('documents'),'粉丝团打卡-'+chinaDate()+'.json'),filters:[{name:'JSON',extensions:['json']}]});if(pick.canceled||!pick.filePath)return false;writeFileSync(pick.filePath,JSON.stringify(checkinExport(r),null,2));return true}
   case 'checkinSaveSchedule':{if(this.configBusy)throw Error('正在保存配置');const s=normalizeSchedule(p.schedule);this.configBusy=true;try{await this.installSchedule(owner,s);this.assert(p);this.store.saveSchedule(owner,s);this.notice=s.enabled?'Windows 定时任务已更新（电脑开机并登录 Windows 时执行）':'定时已关闭，配置已保存'}finally{this.configBusy=false;this.notify()}return true}
   default:throw Error('不支持的打卡操作');
  }
 }
 private async installSchedule(owner:string,s:CheckinSchedule){
  if(process.platform!=='win32')throw Error('桌面定时目前支持 Windows；服务器请使用独立脚本');
  const name='DouyinToolboxCheckin-'+decimal(owner),executable=process.execPath;
  if(!s.enabled){try{await exec('schtasks.exe',['/Query','/TN',name],{windowsHide:true})}catch{return}try{await exec('schtasks.exe',['/Delete','/TN',name,'/F'],{windowsHide:true})}catch{throw Error('Windows 未允许关闭定时任务，请在任务计划程序中检查 '+name)}return}
  const userResult=await exec('whoami.exe',[],{windowsHide:true});const user=userResult.stdout.trim();
  const quote=(x:string)=>'"'+x.replace(/"/g,'')+'"';const args=[...app.isPackaged?[]:[quote(app.getAppPath())],quote('--data-dir='+this.directory),'--no-auto-groups','--checkin-due='+owner].join(' ');
  const file=path.join(this.directory,'checkin-task-'+owner+'.xml');mkdirSync(this.directory,{recursive:true});writeFileSync(file,'\uFEFF'+windowsTaskXML(s,executable,args,path.dirname(executable),user),'utf16le');
  try{await exec('schtasks.exe',['/Create','/TN',name,'/XML',file,'/F'],{windowsHide:true})}catch{throw Error('Windows 未允许创建定时任务，配置未启用；可使用服务器脚本')}finally{if(existsSync(file))unlinkSync(file)}
 }
 async scheduled(owner:string){
  if(owner!==this.owner()||this.busy)return false;const schedule=this.store.schedule(owner);if(!schedule.enabled)return false;const last=this.store.latest(owner);if(last&&last.status!=='completed'){this.configBusy=true;try{await this.alerts.report(last)}finally{this.configBusy=false}this.notice='上次打卡尚待处理，请手动继续；定时保持等待';this.notify();return false}
  const eligible=scheduleTimes(schedule).filter(t=>t<=chinaTime());if(!eligible.length)return false;const slot=chinaDate()+'T'+eligible.at(-1);if(!this.store.claimSlot(owner,slot))return false;
  try{await this.idle();if(owner!==this.owner())throw Error('账号已切换');await this.service.start('sign');await this.service.wait();return true}catch{this.store.releaseSlot(owner,slot);this.notice='本次定时未启动：账号变化或其他任务正在执行，下个时间点重试';this.notify();return false}
 }
 close(){this.pause();this.store.close()}
}
