import {app,BrowserWindow,ipcMain,protocol,net,dialog,session} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Store} from './store';
import {LocalNavigation} from './local-navigation';
import {LoginState} from './login-state';
import {guardExternalLaunches} from './navigation-guard';
import {BrowserHost,DouyinTransport,appURL} from './browser';
import {Collector} from './collector';
import {cleanIds,User,accountPrivacy} from './domain';
import {exportText} from './export';
import {GroupService} from './group-service';
import {DouyinGroupWire} from './group-wire';
import {GroupUI} from './group-ui';
import {FanStore} from './fanclub-store';
import {FanService} from './fanclub-service';
import {DouyinFanWire} from './fanclub-wire';
import {FanUI} from './fanclub-ui';
import {ActionService} from './action-service';
import {DouyinActionWire} from './action-wire';
import {ToolUI} from './tool-ui';
import {ChatStore} from './chat-store';
import {ChatService} from './chat-service';
import {DouyinChatWire} from './chat-wire';
import {ChatUI} from './chat-ui';
import {CheckinUI} from './checkin-ui';
import {ActivityStore} from './activity-store';
import {ActivityService} from './activity-service';
import {GroupManager} from './group-manager';
import {OrganizationUI} from './organization-ui';
import {DownloadStore} from './download-store';
import {DownloadService} from './download-service';
import {DouyinDownloadWire} from './download-wire';
import {DownloadUI} from './download-ui';
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
guardExternalLaunches(app);
const customDir=process.argv.find(v=>v.startsWith('--data-dir='))?.slice(11);
app.setName('DouyinFollowingReview');if(customDir)app.setPath('userData',path.resolve(customDir));
let dashboardNavigation:LocalNavigation;
let dashboard:BrowserWindow,store:Store,collector:Collector,transport:DouyinTransport,loginHost:BrowserHost,reviewHost:BrowserHost;
let notice='',probeResult:any=null,quitting=false,changeTimer:NodeJS.Timeout|undefined,rowsVersion=0;
let groups:GroupService,groupUI:GroupUI,groupSyncQueued=false;
let fans:FanService,fanUI:FanUI,actions:ActionService,toolUI:ToolUI;
let chats:ChatUI;
let checkins:CheckinUI;
let organization:OrganizationUI;
let downloads:DownloadUI;
let loginState:LoginState,loginTimer:NodeJS.Timeout|undefined;
function taskBusy(){return !!(downloads?.busy||collector?.busy||fans?.busy||groups?.busy||organization?.busy||chats?.busy||checkins?.busy||actions?.busy||toolUI?.busy)}
function scheduleLoginCheck(){
 clearTimeout(loginTimer);if(quitting||process.argv.includes('--no-auto-login'))return;loginTimer=setTimeout(()=>{loginTimer=undefined;if(quitting)return;if(taskBusy()){scheduleLoginCheck();return}void transport.owner().catch(()=>{})},1500);
}
function pauseForIdentity(){downloads?.pause();organization?.pause();collector?.pause();fans?.pause();chats?.pause();checkins?.pause();toolUI?.pause();groupUI?.cancel();groupSyncQueued=false;}
const scheduledOwner=process.argv.find(v=>v.startsWith('--checkin-due='))?.slice(14);
const resources=path.join(__dirname,'../resources'),publicDir=path.join(__dirname,'../public');
function fanVerification(){const f=fans?.state(),r=f?.pending||f?.run;return r?{status:r.status,message:r.message,busy:f!.busy,countdown:f!.countdown}:null}
function send(host:BrowserHost){if(!host.window.isDestroyed())host.window.webContents.send('desktop:change',{session:loginState?.state(),browser:host.state(),task:collector?.state(),groups:groups?.state(),fans:fanVerification(),downloads:downloads?.service.state().waiting});}
// Countdown ticks do not change rows: avoid reloading thousands of accounts every second.
function collectorTick(){if(quitting)return;if(dashboard&&!dashboard.isDestroyed())dashboard.webContents.send('desktop:change',{task:collector?.state(),notice,groups:groups?.state()});if(loginHost)send(loginHost);}
function broadcast(){
  fanUI?.notify();
  if(quitting||changeTimer)return;changeTimer=setTimeout(()=>{changeTimer=undefined;rowsVersion++;const msg={version:rowsVersion,session:loginState?.state(),task:collector?.state(),owner:store.owner(),notice,probe:probeResult,groups:groups?.state()};if(dashboard&&!dashboard.isDestroyed())dashboard.webContents.send('desktop:change',msg);if(loginHost)send(loginHost);if(reviewHost)send(reviewHost);groupUI?.notify();if(fanUI?.window&&!fanUI.window.isDestroyed())fanUI.window.webContents.send('desktop:change',{session:loginState?.state()});
    if(groups?.waiting&&collector.busy)collector.pause();
    if(groupSyncQueued&&!downloads?.busy&&!organization?.busy&&!groups?.busy&&!fans?.busy&&!actions?.busy&&!toolUI?.busy&&!chats?.busy&&!checkins?.busy&&store.latest()?.phase!=='following'){groupSyncQueued=false;void groups.refresh().catch(()=>{})}
  },250);
}
function safeDashboard(){dashboard.show();dashboard.focus();}
async function probe(){
  const owner=await transport.owner();store.activate(owner.uid,owner.nickname);broadcast();
  const current=await transport.following(owner,0,0);
  const u:User=current.users.find(u=>u.secret===0)||current.users[0]||owner;const p=await transport.profile(u);
  const wc=await reviewHost.add('https://www.douyin.com/user/'+u.sec_uid,u.nickname||'连接检查','probe-'+u.uid);reviewHost.show();
  let label='';for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,1000));label=await wc.executeJavaScript("document.getElementById('semiTabpost')?.innerText||''").catch(()=>'');if(/\d/.test(label))break;}
  const m=label.replace(/,/g,'').match(/作品\s*(\d+)\s*$/);const visible=m?Number(m[1]):null;
  probeResult={account_uid:owner.uid,sample_uid:u.uid,nickname:u.nickname,api_works:p.aweme_count,page_works:visible,matched:visible!==null&&visible===p.aweme_count,checked_at:new Date().toISOString()};
  notice=probeResult.matched?'登录连接正常，样本作品数与主页一致':'接口连接成功；主页计数未能精确交叉核对，请查看样本页面';
  broadcast();return probeResult;
}
async function command(method:string,p:any,sender:number){
  if(method.startsWith('download')){if(sender!==dashboard.webContents.id)throw Error('请从作品下载页面操作');return downloads.command(method,p)}
  if(downloads?.busy&&['start','resume','probe','connect','groupRefresh','orgRefresh','orgGroupsRefresh','orgResume','orgExecute','orgBatch','chatCatalog','chatScan','chatResume','chatResolve','checkinStart','checkinResume','toolsExecute','toolsMedia','toolsMigration'].includes(method))throw Error('请先暂停作品下载');
  if(method.startsWith('org')){if(sender!==dashboard.webContents.id)throw Error('请从分组管家或动态页面操作');return organization.command(method,p)}
  if(organization?.busy&&['start','resume','probe','connect','groupRefresh','verified'].includes(method))throw Error('请先暂停分组或名单变化任务');
  const host=loginHost.window.webContents.id===sender?loginHost:reviewHost.window.webContents.id===sender?reviewHost:null;
  const dashboardOnly=['start','login','connect','review','openProfiles','export','importReview','exportReview','probe','groupRefresh'];
  if(dashboardOnly.includes(method)&&sender!==dashboard.webContents.id)throw Error('此窗口不支持该操作');
  if(method.startsWith('checkin')){if(sender!==dashboard.webContents.id)throw Error('请从粉丝团打卡操作');return checkins.command(method,p)}
  if(checkins?.busy&&['start','resume','probe','groupRefresh','connect'].includes(method))throw Error('请先暂停粉丝团打卡');
  if(method.startsWith('tools')){if(sender!==dashboard.webContents.id)throw Error('请从工具箱操作');return toolUI.command(method,p)}
  if(method.startsWith('chat')){if(sender!==dashboard.webContents.id)throw Error('请从群成员检索操作');return chats.command(method,p)}
  if(chats?.busy&&['start','resume','probe','groupRefresh','connect'].includes(method))throw Error('请先暂停群成员任务');
  if((actions?.busy||toolUI?.busy)&&['start','resume','probe','groupRefresh'].includes(method))throw Error('请先暂停工具箱任务');
  switch(method){
    case 'navigate':{if(sender!==dashboard.webContents.id)throw Error('请从主界面切换');const page=String(p?.page);if(page==='following')await dashboardNavigation.load(appURL+'index.html');else if(['groups','activity','chat-changes'].includes(page))await dashboardNavigation.load(appURL+'organization.html?tool='+page);else if(page==='duplicates')await dashboardNavigation.load(appURL+'chat.html');else if(page==='checkin')await dashboardNavigation.load(appURL+'checkin.html');else if(page==='downloads')await dashboardNavigation.load(appURL+'download.html');else if(['home','migration','likes','collections','recommendations','ignored','tasks'].includes(page))await dashboardNavigation.load(appURL+'toolbox.html?tool='+page+(p?.run?'&run='+encodeURIComponent(String(p.run)):''));else throw Error('未知页面');return true;}
    case 'fanOpen':if(sender!==dashboard.webContents.id)throw Error('请从关注清单打开工具箱');await fanUI.open();return true;
    case 'snapshot':return store.snapshot();
    case 'state':return {...collector.state(),owner:store.owner(),notice,probe:probeResult,groups:groups.state(),fans:fanVerification(),downloads:downloads?.service.state().waiting};
    case 'login':downloads?.pause();organization?.pause();checkins?.pause();chats?.pause();toolUI.pause();if(fans.busy)fans.pause();if(collector.busy)collector.pause();await transport.ensure();transport.show();return true;
    case 'connect':if(actions.busy||toolUI.busy)throw Error('请先暂停工具箱任务');{const owner=await transport.owner();store.activate(owner.uid,owner.nickname);notice='已连接抖音账号 '+(owner.nickname||owner.uid);broadcast();return {uid:owner.uid,nickname:owner.nickname};}
    case 'probe':if(collector.busy||fans.busy)throw Error('请暂停采集和查询后检查连接');return probe();
    case 'start':if(fans.busy)throw Error('请先暂停粉丝团查询');groupUI.cancel();await collector.start();groupSyncQueued=!!collector.busy;return true;
    case 'pause':collector.pause();return true;
    case 'resume':if(fans.busy)throw Error('请先暂停粉丝团查询');await collector.resume(false);return true;
    case 'verified':if(downloads?.service.state().waiting==='verification'){await downloads.command('downloadVerified',{owner:store.owner()});return true;}if(actions?.busy||toolUI?.busy)throw Error('请在工具箱任务中继续');if(checkins?.state().run?.status==='waiting_verification')await checkins.command('checkinVerified',{owner:store.owner()});else if(['waiting_verification','cooldown'].includes(fanVerification()?.status||''))await fans.resume(true);else if(groups.waiting)await groups.verified();else await collector.resume(true);return true;
    case 'groupRefresh':if(fans.busy)throw Error('请先暂停粉丝团查询');return groups.refresh();
    case 'review':store.reviewDelta(p.owner_uid,p.delta);return true;
    case 'openProfiles':{
      if(p.owner_uid!==store.owner())throw Error('页面账号已变更，请稍后重试');const ids=cleanIds(p.ids);if(ids.length>10)throw Error('每批最多打开 10 个主页');
      const snapshot=store.snapshot(),rows=[...snapshot.rows,...snapshot.group_rows];const opened:string[]=[];
      for(const id of ids){const r=rows.find(r=>r.uid===id);if(!r)continue;await reviewHost.add(r.profile_url,r.nickname,id,{lazy:true,activate:opened.length===0});store.reviewDelta(p.owner_uid,{opened:[id]});opened.push(id);}
      store.reviewDelta(p.owner_uid,{lastBatch:opened});reviewHost.show();return {opened};
    }
    case 'export':{
      const format=p?.format;if(!['html','json','md'].includes(format))throw Error('导出格式无效');
      const save=await dialog.showSaveDialog(dashboard,{defaultPath:path.join(app.getPath('documents'),'抖音关注清单-'+new Date().toISOString().slice(0,10)+'.'+format),filters:[{name:format.toUpperCase(),extensions:[format]}]});
      if(save.canceled||!save.filePath)return null;writeFileSync(save.filePath,exportText(store.snapshot(),format,path.join(resources,'report-template.html')),'utf8');return save.filePath;
    }
    case 'exportReview':{
      const save=await dialog.showSaveDialog(dashboard,{defaultPath:path.join(app.getPath('documents'),'抖音使用记录.json'),filters:[{name:'JSON',extensions:['json']}]});if(save.canceled||!save.filePath)return null;
      writeFileSync(save.filePath,JSON.stringify({version:1,account_uid:store.owner(),exported_at:new Date().toISOString(),review:store.getReview()},null,2));return save.filePath;
    }
    case 'importReview':{
      const open=await dialog.showOpenDialog(dashboard,{properties:['openFile'],filters:[{name:'使用记录 JSON',extensions:['json']}]});if(open.canceled)return null;
      const raw=readFileSync(open.filePaths[0],'utf8');if(raw.length>20_000_000)throw Error('使用记录文件过大');const result=store.importReview(store.owner(),JSON.parse(raw));broadcast();return result;
    }
    case 'browserState':return host?.state();
    case 'browserSelect':host?.select(String(p.id));return true;
    case 'browserClose':host?.closeTab(String(p.id));return true;
    case 'showDashboard':safeDashboard();return true;
    default:throw Error('不支持的操作');
  }
}
if(!app.requestSingleInstanceLock()){app.quit()}else{
  app.on('second-instance',(_e,argv)=>{const due=argv.find(v=>v.startsWith('--checkin-due='))?.slice(14);if(due){void checkins?.scheduled(due)}else if(dashboard)safeDashboard()});
  app.whenReady().then(async()=>{
    protocol.handle('app',req=>{const url=new URL(req.url);const allowed=new Set(['session-status.js','index.html','style.css','renderer.js','rules.js','browser.html','browser.js','group-button.html','profile-private.html','group-dialog.html','group.css','group.js','fanclub.html','fanclub.css','fanclub.js','toolbox.html','toolbox.css','toolbox.js','chat.html','chat.css','chat.js','checkin.html','checkin.css','checkin.js','organization.html','organization.css','organization.js','download.html','download.css','download.js']);const name=url.pathname.slice(1);if(url.hostname!=='local'||!allowed.has(name))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(path.join(publicDir,name)).href);});
    const userDir=app.getPath('userData');mkdirSync(userDir,{recursive:true});store=new Store(path.join(userDir,'review.sqlite'));
    const preload=path.join(__dirname,'preload.js');
    loginHost=new BrowserHost('collector',preload,send);reviewHost=new BrowserHost('review',preload,send);loginState=new LoginState(broadcast,user=>{if(store.owner()&&store.owner()!==user.uid)pauseForIdentity();store.activate(user.uid,user.nickname)});transport=new DouyinTransport(loginHost,loginState);collector=new Collector(store,transport,broadcast,undefined,collectorTick);
    groups=new GroupService(store,new DouyinGroupWire(session.fromPartition('persist:douyin-login'),transport),broadcast);
    groupUI=new GroupUI(reviewHost,store,groups,preload);loginHost.onContextChange=()=>groupUI.cancel();
    fans=new FanService(new FanStore(store.db),new DouyinFanWire(session.fromPartition('persist:douyin-login'),transport),()=>store.owner(),()=>{fanUI?.notify();if(loginHost)send(loginHost);if(reviewHost)send(reviewHost)});
    reviewHost.profileMeta=sec=>{const row=store.profileTarget(sec);if(row)return {nickname:row.nickname,is_private:accountPrivacy(row)};const chat=chats?.profileMeta(sec);if(chat)return chat;const s=fans.state();return [s.anchorPreview?.user,s.target,s.run?.target,...s.anchors,...s.run?.anchors||[]].find(u=>u?.sec_uid===sec)||undefined};
    const stopCollector=async()=>{if(downloads?.busy)throw Error('请先暂停作品下载');if(organization?.busy)throw Error('请先暂停分组或名单变化任务');if(checkins?.busy)throw Error('请先暂停粉丝团打卡');if(chats?.busy)throw Error('请先暂停群成员任务');if(actions?.busy||toolUI?.busy)throw Error('请先暂停工具箱任务');groupSyncQueued=false;if(groups.busy)throw Error('分组同步正在进行，请稍后开始查询');if(collector.busy){collector.pause();for(let i=0;i<300&&collector.busy;i++)await new Promise(r=>setTimeout(r,100));if(collector.busy)throw Error('正在保存采集断点，请稍后重试')}};
    fanUI=new FanUI(fans,preload,stopCollector,async()=>{await transport.ensure();transport.show()},async()=>{const owner=await transport.owner();store.activate(owner.uid,owner.nickname);broadcast()},async(uid,sec,name)=>{await reviewHost.add('https://www.douyin.com/user/'+sec,name,'fan-'+uid);reviewHost.show()},async()=>{await dashboardNavigation.load(appURL+'toolbox.html?tool=home');safeDashboard()});
    loginHost.onChange=()=>{downloads?.pause();organization?.pause();collector.pause();toolUI.pause();chats?.pause();checkins?.pause()};
    const wire=new DouyinActionWire(session.fromPartition('persist:douyin-login'),transport);actions=new ActionService(store.tools,wire,()=>store.owner(),broadcast);
    toolUI=new ToolUI(store,actions,wire,()=>dashboard,async()=>{if(downloads?.busy)throw Error('请先暂停作品下载');if(organization?.busy)throw Error('请先暂停分组或名单变化任务');if(checkins?.busy)throw Error('请先暂停粉丝团打卡');if(chats?.busy)throw Error('请先暂停群成员任务');groupSyncQueued=false;if(groups.busy)throw Error('请等待分组同步完成');if(fans.busy)fans.pause();if(collector.busy)collector.pause();for(let n=0;n<300&&(fans.busy||collector.busy);n++)await new Promise(r=>setTimeout(r,100));if(fans.busy||collector.busy)throw Error('正在保存其他任务断点，请稍后重试')},broadcast);
    chats=new ChatUI(new ChatService(new ChatStore(store.db),new DouyinChatWire(transport),()=>store.owner(),broadcast),store,new DouyinFanWire(session.fromPartition('persist:douyin-login'),transport),()=>dashboard,async()=>{if(downloads?.busy)throw Error('请先暂停作品下载');if(organization?.busy||checkins?.busy||actions.busy||toolUI.busy||groups.busy)throw Error('请先暂停其他工具任务');groupSyncQueued=false;fans.pause();collector.pause();for(let n=0;n<300&&(fans.busy||collector.busy);n++)await new Promise(r=>setTimeout(r,100));if(fans.busy||collector.busy)throw Error('正在保存其他任务断点，请稍后重试')},broadcast,async u=>{await reviewHost.add(u.profile_url,u.nickname,'chat-'+u.uid);reviewHost.show()});
    checkins=new CheckinUI(userDir,session.fromPartition('persist:douyin-login'),()=>store.owner(),()=>dashboard,async()=>{if(downloads?.busy)throw Error('请先暂停作品下载');if(organization?.busy||actions.busy||toolUI.busy||chats.busy||groups.busy)throw Error('请先暂停其他工具任务');groupSyncQueued=false;fans.pause();collector.pause();for(let n=0;n<300&&(fans.busy||collector.busy);n++)await new Promise(r=>setTimeout(r,100));if(fans.busy||collector.busy)throw Error('正在保存其他任务断点，请稍后重试')},broadcast,async code=>{safeDashboard();await transport.ensure();if(code==='CAPTCHA')await transport.challenge(undefined,true);transport.show()});
    const organizationIdle=async()=>{if(downloads?.busy)throw Error('请先暂停作品下载');if(organization?.busy||checkins?.busy||chats.busy||actions.busy||toolUI.busy||groups.busy)throw Error('请先暂停其他任务或等待请求结束');groupSyncQueued=false;collector.pause();fans.pause();for(let n=0;n<300&&(collector.busy||fans.busy);n++)await new Promise(r=>setTimeout(r,100));if(collector.busy||fans.busy)throw Error('正在保存其他任务断点，请稍后重试')};
    organization=new OrganizationUI(store,new ActivityService(new ActivityStore(store),transport,()=>store.owner(),broadcast),new GroupManager(store,new DouyinGroupWire(session.fromPartition('persist:douyin-login'),transport),broadcast),groups,chats,()=>dashboard,organizationIdle,broadcast,async(uid,sec,name)=>{await reviewHost.add('https://www.douyin.com/user/'+sec,name,'org-'+uid);reviewHost.show()});
    downloads=new DownloadUI(new DownloadService(new DownloadStore(store.db),new DouyinDownloadWire(session.fromPartition('persist:douyin-login'),transport),()=>store.owner(),broadcast),()=>store.owner(),()=>dashboard,async()=>{if(organization?.busy||checkins?.busy||chats?.busy||actions?.busy||toolUI?.busy||groups?.busy)throw Error('请先暂停其他任务或等待分组请求完成');groupSyncQueued=false;collector.pause();fans.pause();for(let n=0;n<300&&(collector.busy||fans.busy);n++)await new Promise(r=>setTimeout(r,100));if(collector.busy||fans.busy)throw Error('正在保存采集断点，请稍后重试')},broadcast);
    dashboard=new BrowserWindow({width:1500,height:960,minWidth:960,minHeight:640,show:false,title:'抖音整理箱',autoHideMenuBar:true,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    dashboardNavigation=new LocalNavigation(url=>dashboard.loadURL(url));
    dashboard.webContents.setWindowOpenHandler(()=>({action:'deny'}));dashboard.webContents.on('will-navigate',e=>e.preventDefault());
    ipcMain.handle('desktop:command',async(event,method,p)=>{
      if(![dashboard.webContents.id,loginHost.window.webContents.id,reviewHost.window.webContents.id].includes(event.sender.id)&&!groupUI.owns(event.sender.id)&&!fanUI.owns(event.sender.id)||event.senderFrame!==event.sender.mainFrame||!event.senderFrame.url.startsWith(appURL))return {ok:false,error:'不允许的调用来源'};
      try{if(method==='sessionState')return {ok:true,data:loginState.state()};if((downloads?.busy||organization?.busy||actions?.busy||toolUI?.busy||chats?.busy||checkins?.busy)&&(groupUI.owns(event.sender.id)||fanUI.owns(event.sender.id))&&!['fanState','groupDialogState','groupCancel','fanHome'].includes(method))throw Error('请先暂停批量任务');return {ok:true,data:await (fanUI.owns(event.sender.id)?fanUI.command(method,p):groupUI.owns(event.sender.id)?groupUI.command(method,p,event.sender.id):command(method,p,event.sender.id))}}catch(e:any){return {ok:false,error:typeof e?.message==='string'?e.message:'操作失败，请重试'}}
    });
    session.fromPartition('persist:douyin-login').cookies.on('changed',(_e,cookie)=>{if(/(^|\.)douyin\.com$/.test(cookie.domain||'')&&/^(sessionid|sessionid_ss|sid_tt|uid_tt|uid_tt_ss)$/.test(cookie.name)){downloads?.pause();loginState.invalidate();scheduleLoginCheck()}});
    app.on('browser-window-focus',(_e,win)=>{if(win===dashboard||win===fanUI?.window){const s=loginState.state();if(s.status!=='connected'||!s.checked_at||Date.now()-Date.parse(s.checked_at)>30000)scheduleLoginCheck()}});
    loginHost.window.on('hide',scheduleLoginCheck);
    await dashboardNavigation.load(appURL+(scheduledOwner?'checkin.html':'toolbox.html?tool=home'));if(!scheduledOwner)dashboard.show();
    if(scheduledOwner){void checkins.scheduled(scheduledOwner).finally(()=>{if(!dashboard.isVisible())app.quit()})}
    if(!scheduledOwner&&!process.argv.includes('--no-auto-login'))scheduleLoginCheck();
    if(process.argv.includes('--login')){await transport.ensure();transport.show();}
    if(process.argv.includes('--resume')&&store.latest()&&store.latest()!.status!=='completed')await collector.resume(false);
    if(!scheduledOwner&&store.owner()&&(!store.groups.state(store.owner()).checked_at||store.groups.needsMemberDetails(store.owner()))&&!process.argv.includes('--no-auto-groups'))setTimeout(()=>{if(!quitting&&!downloads.busy&&!organization.busy&&!fans.busy&&!chats.busy&&!checkins.busy)void groups.refresh().catch(()=>{})},2000);
    dashboard.on('closed',()=>{if(!quitting)app.quit()});
  }).catch(e=>{dialog.showErrorBox('启动失败',String(e.message));app.quit();});
  app.on('before-quit',()=>{if(quitting)return;quitting=true;downloads?.service.close();clearTimeout(loginTimer);organization?.pause();checkins?.pause();chats?.pause();toolUI?.pause();collector?.pause();if(changeTimer)clearTimeout(changeTimer);fanUI?.destroy();groupUI?.destroy();if(loginHost&&!loginHost.window.isDestroyed())loginHost.destroy();if(reviewHost&&!reviewHost.window.isDestroyed())reviewHost.destroy();});
  app.on('will-quit',()=>{checkins?.close();store?.close()});
}
