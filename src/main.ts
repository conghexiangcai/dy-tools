import {app,BrowserWindow,ipcMain,protocol,net,dialog,session} from 'electron';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {Store} from './store';
import {BrowserHost,DouyinTransport,appURL} from './browser';
import {Collector} from './collector';
import {cleanIds,User} from './domain';
import {exportText} from './export';
protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
const customDir=process.argv.find(v=>v.startsWith('--data-dir='))?.slice(11);
app.setName('DouyinFollowingReview');if(customDir)app.setPath('userData',path.resolve(customDir));
let dashboard:BrowserWindow,store:Store,collector:Collector,transport:DouyinTransport,loginHost:BrowserHost,reviewHost:BrowserHost;
let notice='',probeResult:any=null,quitting=false,changeTimer:NodeJS.Timeout|undefined,rowsVersion=0;
const resources=path.join(__dirname,'../resources'),publicDir=path.join(__dirname,'../public');
function send(host:BrowserHost){if(!host.window.isDestroyed())host.window.webContents.send('desktop:change',{browser:host.state(),task:collector?.state()});}
function broadcast(){
  if(changeTimer)return;changeTimer=setTimeout(()=>{changeTimer=undefined;rowsVersion++;const msg={version:rowsVersion,task:collector?.state(),owner:store.owner(),notice,probe:probeResult};if(dashboard&&!dashboard.isDestroyed())dashboard.webContents.send('desktop:change',msg);if(loginHost)send(loginHost);if(reviewHost)send(reviewHost);},250);
}
function safeDashboard(){dashboard.show();dashboard.focus();}
async function probe(){
  const owner=await transport.owner();store.activate(owner.uid,owner.nickname);const snap=store.snapshot();
  const seed=JSON.parse(readFileSync(path.join(resources,'seed.json'),'utf8'));
  const r=seed.rows.find((r:any)=>r.uid==='9007199254740997')||seed.rows.find((r:any)=>r.works_count>0&&r.works_count<50);
  const u:User={uid:r.uid,sec_uid:r.sec_uid,nickname:r.nickname};const p=await transport.profile(u);
  const wc=await reviewHost.add(r.profile_url,r.nickname,'probe-'+r.uid);reviewHost.show();
  let label='';for(let i=0;i<8;i++){await new Promise(r=>setTimeout(r,1000));label=await wc.executeJavaScript("document.getElementById('semiTabpost')?.innerText||''").catch(()=>'');if(/\d/.test(label))break;}
  const m=label.replace(/,/g,'').match(/作品\s*(\d+)\s*$/);const visible=m?Number(m[1]):null;
  probeResult={account_uid:owner.uid,sample_uid:u.uid,nickname:u.nickname,api_works:p.aweme_count,page_works:visible,matched:visible!==null&&visible===p.aweme_count,checked_at:new Date().toISOString()};
  notice=probeResult.matched?'登录连接正常，样本作品数与主页一致':'接口连接成功；主页计数未能精确交叉核对，请查看样本页面';
  broadcast();return probeResult;
}
async function command(method:string,p:any,sender:number){
  const host=loginHost.window.webContents.id===sender?loginHost:reviewHost.window.webContents.id===sender?reviewHost:null;
  const dashboardOnly=['start','login','connect','review','openProfiles','export','importReview','exportReview','probe'];
  if(dashboardOnly.includes(method)&&sender!==dashboard.webContents.id)throw Error('此窗口不支持该操作');
  switch(method){
    case 'snapshot':return store.snapshot();
    case 'state':return {...collector.state(),owner:store.owner(),notice,probe:probeResult};
    case 'login':if(collector.busy)collector.pause();await transport.ensure();transport.show();return true;
    case 'connect':{const owner=await transport.owner();store.activate(owner.uid,owner.nickname);notice='已连接抖音账号 '+(owner.nickname||owner.uid);broadcast();return {uid:owner.uid,nickname:owner.nickname};}
    case 'probe':if(collector.busy)throw Error('请暂停采集后检查连接');return probe();
    case 'start':await collector.start();return true;
    case 'pause':collector.pause();return true;
    case 'resume':await collector.resume(false);return true;
    case 'verified':await collector.resume(true);return true;
    case 'review':store.reviewDelta(p.owner_uid,p.delta);return true;
    case 'openProfiles':{
      if(p.owner_uid!==store.owner())throw Error('页面账号已变更，请稍后重试');const ids=cleanIds(p.ids);if(ids.length>10)throw Error('每批最多打开 10 个主页');
      const rows=store.snapshot().rows;const opened:string[]=[];
      for(const id of ids){const r=rows.find(r=>r.uid===id);if(!r)continue;await reviewHost.add(r.profile_url,r.nickname,id);store.reviewDelta(p.owner_uid,{opened:[id]});opened.push(id);}
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
  app.on('second-instance',()=>{if(dashboard)safeDashboard()});
  app.whenReady().then(async()=>{
    protocol.handle('app',req=>{const url=new URL(req.url);const allowed=new Set(['index.html','style.css','renderer.js','rules.js','browser.html','browser.js']);const name=url.pathname.slice(1);if(url.hostname!=='local'||!allowed.has(name))return new Response('Not found',{status:404});return net.fetch(pathToFileURL(path.join(publicDir,name)).href);});
    const userDir=app.getPath('userData');mkdirSync(userDir,{recursive:true});store=new Store(path.join(userDir,'review.sqlite'));store.seed(path.join(resources,'seed.json'),path.join(resources,'unfollow-history.json'));
    session.fromPartition('persist:douyin-login').setPermissionRequestHandler((_wc,permission,done)=>done(permission==='fullscreen'));
    session.fromPartition('persist:douyin-login').setPermissionCheckHandler((_wc,permission)=>permission==='fullscreen');
    const preload=path.join(__dirname,'preload.js');
    loginHost=new BrowserHost('collector',preload,send);reviewHost=new BrowserHost('review',preload,send);transport=new DouyinTransport(loginHost);collector=new Collector(store,transport,broadcast);
    loginHost.onChange=()=>collector.pause();
    dashboard=new BrowserWindow({width:1500,height:960,minWidth:960,minHeight:640,show:false,title:'抖音关注清单',autoHideMenuBar:true,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    dashboard.webContents.setWindowOpenHandler(()=>({action:'deny'}));dashboard.webContents.on('will-navigate',e=>e.preventDefault());
    ipcMain.handle('desktop:command',async(event,method,p)=>{
      if(![dashboard.webContents.id,loginHost.window.webContents.id,reviewHost.window.webContents.id].includes(event.sender.id)||event.senderFrame!==event.sender.mainFrame||!event.senderFrame.url.startsWith(appURL))return {ok:false,error:'不允许的调用来源'};
      try{return {ok:true,data:await command(method,p,event.sender.id)}}catch(e:any){return {ok:false,error:typeof e?.message==='string'?e.message:'操作失败，请重试'}}
    });
    await dashboard.loadURL(appURL+'index.html');dashboard.show();
    if(process.argv.includes('--login')){await transport.ensure();transport.show();}
    dashboard.on('closed',()=>{if(!quitting)app.quit()});
  }).catch(e=>{dialog.showErrorBox('启动失败',String(e.message));app.quit();});
  app.on('before-quit',()=>{quitting=true;collector?.pause();if(changeTimer)clearTimeout(changeTimer);if(loginHost&&!loginHost.window.isDestroyed())loginHost.destroy();if(reviewHost&&!reviewHost.window.isDestroyed())reviewHost.destroy();});
}
