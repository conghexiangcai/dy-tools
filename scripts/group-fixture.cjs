// Isolated synthetic UI harness; no request reaches Douyin and no real login is loaded.
const {app,protocol,net,ipcMain}=require('electron'),path=require('node:path'),{pathToFileURL}=require('node:url');
process.on('uncaughtException',e=>{require('node:fs').writeFileSync(path.resolve(__dirname,'../output/group-fixture-error.txt'),e.stack);app.exit(1)});
const root=path.resolve(__dirname,'..'),{Store}=require('../dist/store'),{BrowserHost}=require('../dist/browser'),{GroupUI}=require('../dist/group-ui'),{GroupService}=require('../dist/group-service');
app.setPath('userData',process.argv.find(s=>s.startsWith('--data-dir=')).slice(11));protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 protocol.handle('app',r=>net.fetch(pathToFileURL(path.join(root,'public',new URL(r.url).pathname.slice(1))).href));
 const store=new Store(path.join(app.getPath('userData'),'test.sqlite'));store.activate('100');const users=[{uid:'1',sec_uid:'MS4wLjABAAAA_SYNTHETIC_1',nickname:'合成账号一'},{uid:'2',sec_uid:'MS4wLjABAAAA_SYNTHETIC_2',nickname:'合成账号二'}];const run=store.createRun('100',2);store.addPage(run.id,users,{offset:2,max_time:0,pages:1},true);
 const catalog=[{id:'9223372036854775806',name:'组一',member_count:1},{id:'9223372036854775805',name:'组二',member_count:0}];let ids=[catalog[0].id],writes=0,ui;const service=new GroupService(store,{connect:async()=>({read:async()=>({groups:catalog,belong_groups:ids,cursor:0,total:2,has_more:0}),write:async(_s,add,del,guard)=>{guard?.();writes++;ids=[...ids.filter(x=>!del.includes(x)),...add]}}),challenge:async()=>false,show:()=>{}},()=>ui?.notify());
 const host=new BrowserHost('review',path.join(root,'dist/preload.js'),h=>h.window.webContents.send('desktop:change',{browser:h.state()}));ui=new GroupUI(host,store,service,path.join(root,'dist/preload.js'));
 const html=url=>`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:1800px"><h1 data-e2e="user-info" style="margin-top:40px">${url.includes('SYNTHETIC_2')?'合成账号二':'合成账号一'}</h1><button data-e2e="user-info-follow-btn" style="margin:70px 0 0 550px;width:100px;height:34px">已关注</button></body></html>`;
 // intercept before any remote view loads; the test session uses its own userData directory.
 host.window.webContents.session.protocol.handle('https',req=>new Response(html(req.url),{headers:{'Content-Type':'text/html'}}));
 require('electron').session.fromPartition('persist:douyin-login').protocol.handle('https',req=>new Response(html(req.url),{headers:{'Content-Type':'text/html'}}));
 ipcMain.handle('desktop:command',async(e,m,p)=>{try{
  if(e.senderFrame!==e.sender.mainFrame||!e.senderFrame.url.startsWith('app://local/'))throw Error('denied');
  if(ui.owns(e.sender.id))return {ok:true,data:await ui.command(m,p,e.sender.id)};
  if(m==='browserState')return {ok:true,data:host.state()};if(m==='state')return {ok:true,data:{}};
  if(m==='browserSelect'){host.select(p.id);return {ok:true,data:true}};
  throw Error('denied');
 }catch(e){return {ok:false,error:e.message}}});
 global.testGroups={host,ui,service,store,inspect:require('../dist/group-ui').inspectFollowAnchor.toString(),get writes(){return writes}};
 await host.add('https://www.douyin.com/user/'+users[0].sec_uid,'测试一','1');await host.add('https://www.douyin.com/user/'+users[1].sec_uid,'测试二','2');host.select('1');host.show();
 let quitting=false;app.on('before-quit',()=>{if(quitting)return;quitting=true;ui.destroy();host.destroy();store.close()});
});
