// Offline Electron regression. Protocol sinks ensure even a failed assertion cannot launch an OS app.
const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'output/playwright/navigation-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const pkg=process.argv.includes('--packaged')?JSON.parse(fs.readFileSync(path.join(root,'release/latest.json'))):null;let app;
(async()=>{
 app=await _electron.launch({executablePath:pkg?.executable||require('electron'),args:[...(pkg?[]:[root]),'--data-dir='+profile,'--no-auto-login','--no-auto-groups'],timeout:120000});await app.firstWindow();
 const results=await app.evaluate(async({BrowserWindow,session})=>{
  const results=[],wait=ms=>new Promise(r=>setTimeout(r,ms));
  for(const ses of [session.defaultSession,session.fromPartition('persist:douyin-login'),session.fromPartition('guard-new-probe')]){
   let sink=0,blocked=0,popups=0;const clients=['bytedance','snssdk1128','douyin','unknown-client'];
   for(const scheme of clients)ses.protocol.handle(scheme,()=>{sink++;return new Response(null,{status:204})});
   ses.protocol.handle('https',req=>new URL(req.url).pathname==='/redirect'?new Response(null,{status:302,headers:{Location:'bytedance://fixture'}}):new Response('<!doctype html><html><body><h1>Offline fixture</h1></body></html>',{headers:{'Content-Type':'text/html'}}));
   const win=new BrowserWindow({show:false,webPreferences:{session:ses,sandbox:true,contextIsolation:true,nodeIntegration:false}}),wc=win.webContents;
   wc.setWindowOpenHandler(()=>{popups++;return {action:'deny'}});
   for(const event of ['will-navigate','will-frame-navigate','will-redirect'])wc.on(event,e=>{if(e.defaultPrevented)blocked++});
   await wc.loadURL('https://www.douyin.com/guard-fixture');
   const cases=[];
   for(const action of [
    "const a=document.createElement('a');a.href='bytedance://fixture';document.body.append(a);a.click()",
    "location.href='snssdk1128://fixture'",
    "const a=document.createElement('a');a.href='douyin://fixture';a.target='_blank';document.body.append(a);a.click()",
    "const f=document.createElement('iframe');f.src='bytedance://fixture';document.body.append(f)",
    "const f=document.createElement('iframe');f.srcdoc='<meta http-equiv=refresh content=\"0;url=unknown-client://fixture\">';document.body.append(f)",
    "const f=document.createElement('iframe');f.src='https://www.douyin.com/redirect';document.body.append(f)",
    "location.href='https://www.douyin.com/redirect'"
   ]){const before=blocked+popups;await wc.executeJavaScript('(()=>{'+action+'})()',true);await wait(250);cases.push(blocked+popups>before)}
   await wc.executeJavaScript("location.href='https://www.douyin.com/user/fixture'",true);for(let n=0;n<30&&!wc.getURL().endsWith('/user/fixture');n++)await wait(100);
   results.push({sink,cases,webNavigation:wc.getURL().endsWith('/user/fixture')});win.destroy();for(const scheme of [...clients,'https'])ses.protocol.unhandle(scheme);
  }
  return results;
 });
 for(const result of results){assert.equal(result.sink,0,'客户端协议不应到达处理器');assert.ok(result.cases.every(Boolean),'每种跳转均应被拦截');assert.equal(result.webNavigation,true)}
 await app.close();app=null;console.log('PASS: three sessions, 21 main-frame/subframe/redirect/popup client launches blocked; HTTPS navigation preserved; zero OS launches or network calls.');
})().catch(async e=>{console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1});
