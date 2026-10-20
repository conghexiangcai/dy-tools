// Synthetic-only UI fixture; never connects to Douyin.
const {app,BrowserWindow,protocol,net,ipcMain}=require('electron'),path=require('node:path'),{pathToFileURL}=require('node:url');
const {Store}=require('../dist/store'),{FanStore}=require('../dist/fanclub-store'),{FanService}=require('../dist/fanclub-service'),{FanUI}=require('../dist/fanclub-ui');
app.setPath('userData',process.argv.find(x=>x.startsWith('--data-dir=')).slice(11));protocol.registerSchemesAsPrivileged([{scheme:'app',privileges:{standard:true,secure:true,supportFetchAPI:true}}]);
app.whenReady().then(async()=>{
 const root=path.resolve(__dirname,'..');protocol.handle('app',req=>net.fetch(pathToFileURL(path.join(root,'public',new URL(req.url).pathname.slice(1))).href));
 const store=new Store(path.join(app.getPath('userData'),'review.sqlite'));store.activate('100','合成登录账号');store.reviewDelta('100',{select:{ids:['7'],value:true},opened:['8'],settings:{fans:'99'}});
 const user=id=>({uid:id,sec_uid:'MS4wLjABAAAA_SYNTHETIC_'+id,nickname:id==='1'?'合成目标用户':'合成主播 '+id,account:'test_'+id,is_private:id==='1',avatar:'',profile_url:'https://www.douyin.com/user/MS4wLjABAAAA_SYNTHETIC_'+id});
 const data=(id,a='0')=>({status_code:0,data:{id_str:id,sec_uid:user(id).sec_uid,nickname:user(id).nickname,display_id:user(id).account,pay_grade:{level:28,this_grade_min_diamond:34000,this_grade_max_diamond:44000},fans_club:{data:{anchor_id:a,level:a==='7'?15:a==='8'?7:0,user_fans_club_status:a==='7'?1:a==='8'?2:0,user_guard_status:0}}}});
 let ui;const wire={connect:async()=>({assert:async()=>{},resolve:async raw=>({user:user(/^\d+$/.test(raw)?raw:raw.split('_').at(-1)),data:data('1')}),search:async(_q,cursor)=>({users:cursor?[user('2')]:[user('1')],cursor:cursor?2:1,more:!cursor}),read:async p=>data(p.target_uid,p.anchor_id)}),challenge:async()=>false,show:()=>{}};
 const service=new FanService(new FanStore(store.db),wire,()=>store.owner(),()=>ui?.notify(),async()=>{});
 ui=new FanUI(service,path.join(root,'dist/preload.js'),async()=>{},async()=>{},async()=>{},async()=>{});
 ipcMain.handle('desktop:command',async(e,m,p)=>{if(!ui.owns(e.sender.id)||e.senderFrame!==e.sender.mainFrame||e.senderFrame.url!=='app://local/fanclub.html')return {ok:false,error:'禁止'};try{return {ok:true,data:await ui.command(m,p)}}catch(x){return {ok:false,error:x.message}}});
 global.testFans={store,service,ui};await ui.open();
});
app.on('window-all-closed',()=>app.quit());
