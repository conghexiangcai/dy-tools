// Real Electron window/menu lifecycle, synthetic account and blocked external network.
const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../dist/store'),{makeRow}=require('../dist/domain');
const root=path.resolve(__dirname,'..'),profile=path.join(root,'output/playwright/browser-tabs-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const db=new Store(path.join(profile,'review.sqlite'));db.activate('100','标签测试账号');const r=db.createRun('100',5);
const people=Array.from({length:5},(_,i)=>({uid:String(i+1),sec_uid:'MS4wLjABAAAA_tab_fixture_'+i,nickname:'长标题仍能关闭的测试标签 '+(i+1),unique_id:'fixture-'+i,secret:0}));
db.addPage(r.id,people,{offset:5,max_time:0,pages:1},true);for(const p of people)db.saveRow(r.id,makeRow(p,p));db.update(r.id,{status:'completed'});db.reviewDelta('100',{select:{ids:['1','3'],value:true},opened:['99']});db.close();
const pkg=process.argv.includes('--packaged')?JSON.parse(fs.readFileSync(path.join(root,'release/latest.json'))):null;
let app,page,browser;const errors=[],openTimes=[];
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await pause(50)}throw Error('Timed out checking lifecycle')}
async function open(ids=['1','2','3','4','5']){
 const recreated=await app.evaluate(()=>!!global.review?.window.isDestroyed()),started=Date.now();
 await page.evaluate(ids=>desktop.call('openProfiles',{owner_uid:'100',ids}),ids);
 const accepted=Date.now()-started;
 await until(async()=>{browser=app.windows().find(p=>p.url().includes('mode=review'));return !!browser});await browser.waitForSelector('.tab');
 const count=await app.evaluate(()=>global.review.tabs.length);await browser.waitForFunction(count=>document.querySelectorAll('.tab').length===count,count);
 openTimes.push({recreated,tabs:count,accepted_ms:accepted,tabs_ready_ms:Date.now()-started});
}
async function menu(id){
 const index=await app.evaluate((_e,id)=>global.review.tabs.findIndex(t=>t.id===id),id);assert.ok(index>=0);
 await app.evaluate(()=>{global.menu=null});await browser.locator('.tab .select').nth(index).click({button:'right'});
 await until(()=>app.evaluate(()=>!!global.menu));return app.evaluate(()=>global.menu.items.filter(t=>t.type!=='separator').map(t=>({label:t.label,enabled:t.enabled})));
}
async function click(label){await app.evaluate((_e,label)=>{const m=global.menu.items.find(m=>m.label===label);if(!m||!m.enabled)throw Error('Missing or disabled '+label);m.click(m,global.review.window,{})},label)}
const tabs=()=>app.evaluate(()=>({ids:global.review.tabs.map(t=>t.id),active:global.review.active}));
async function remember(){await app.evaluate(()=>{global.previous=global.review;global.destroyCheck=[global.review.window.webContents,...global.review.window.contentView.children.map(v=>v.webContents).filter(Boolean)];global.oldMenu=global.menu});assert.ok(await app.evaluate(()=>global.destroyCheck.length>=4))}
async function destroyed(){await until(()=>app.evaluate(()=>global.previous.window.isDestroyed()&&global.destroyCheck.every(w=>w.isDestroyed())));assert.equal(await app.evaluate(()=>global.previous.tabs.length),0);assert.equal(await app.evaluate(()=>global.collector.isDestroyed()),false);assert.equal(page.isClosed(),false)}
(async()=>{
 app=await _electron.launch({executablePath:pkg?.executable||require('electron'),args:[...(pkg?[]:[root]),'--data-dir='+profile,'--no-auto-login','--no-auto-groups'],timeout:120000});await app.firstWindow({timeout:20000});
 await until(async()=>{page=app.windows().find(p=>p.url().includes('toolbox.html'));return !!page});page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({app,session,BrowserWindow,Menu,clipboard,dialog})=>{
   const req=process.mainModule.require.bind(process.mainModule),base=req('node:path').join(app.getAppPath(),'dist');global.loads=[];global.remote=[];global.copied=[];global.fatals=[];
   global.collector=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('mode=collector'));
   dialog.showErrorBox=(...args)=>global.fatals.push(args);
   for(const s of [session.defaultSession,session.fromPartition('persist:douyin-login')])s.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(d,cb)=>{global.remote.push(d.url);cb({cancel:true})});
   const Host=req(base+'/browser').BrowserHost,add=Host.prototype.add;Host.prototype.add=function(...args){if(this.mode==='review')global.review=this;return add.apply(this,args)};
   let p=Object.getPrototypeOf(global.collector.webContents);while(p&&!Object.hasOwn(p,'loadURL'))p=Object.getPrototypeOf(p);const load=p.loadURL;
   p.loadURL=function(url,...args){if(url.startsWith('https:')){global.loads.push({id:this.id,url});return new Promise(()=>{})}return load.call(this,url,...args)};
   // Exercise actual native Menu construction and handlers without taking over the user's mouse/clipboard.
   Menu.prototype.popup=function(){global.menu=this};clipboard.writeText=value=>global.copied.push(value);
 });
 await open();browser.on('pageerror',e=>errors.push(e.message));assert.equal((await app.evaluate(()=>global.loads)).length,1);
 assert.deepEqual(await tabs(),{ids:['1','2','3','4','5'],active:'1'});
 let m=await menu('1');assert.equal(m.find(t=>t.label==='关闭左侧标签').enabled,false);assert.equal(m.length,8);
 m=await menu('5');assert.equal(m.find(t=>t.label==='关闭右侧标签').enabled,false);
 await click('复制页面链接');assert.equal(await app.evaluate(()=>global.copied[0]),'https://www.douyin.com/user/'+people[4].sec_uid);assert.equal((await app.evaluate(()=>global.loads)).length,1);
 await menu('3');assert.equal((await tabs()).active,'1');await click('关闭右侧标签');assert.deepEqual(await tabs(),{ids:['1','2','3'],active:'1'});assert.equal((await app.evaluate(()=>global.loads)).length,1);
 await menu('3');await click('关闭左侧标签');assert.deepEqual(await tabs(),{ids:['3'],active:'3'});assert.equal((await app.evaluate(()=>global.loads)).length,2);
 m=await menu('3');for(const label of ['关闭其他标签','关闭左侧标签','关闭右侧标签'])assert.equal(m.find(t=>t.label===label).enabled,false);
 await click('重新加载');assert.equal((await app.evaluate(()=>global.loads)).length,3);
 await open();assert.deepEqual((await tabs()).ids,['3','1','2','4','5']);await menu('4');await click('关闭其他标签');assert.deepEqual(await tabs(),{ids:['4'],active:'4'});
 await menu('4');await remember();await click('关闭当前标签');await destroyed();console.log('PASS menu scopes, disabled edges, lazy copy/reload, last-tab disposal');
 await open(['1','2']);assert.equal(await app.evaluate(()=>global.review!==global.previous),true);assert.equal(await app.evaluate(()=>global.review.window.contentView.children.filter(v=>v.webContents&&!v.webContents.isDestroyed()).length>=4),true);
 // A callback kept from a destroyed host must not affect the recreated window.
 await app.evaluate(()=>{const m=global.oldMenu.items.find(m=>m.label==='关闭全部标签');m.click(m,global.review.window,{})});assert.equal((await tabs()).ids.length,2);
 await app.evaluate(()=>{global.menu=null});await page.evaluate(()=>desktop.call('browserMenu',{id:'1'}));assert.equal(await app.evaluate(()=>global.menu),null);
 await browser.evaluate(()=>desktop.call('browserMenu',{id:'not-a-tab'}));assert.equal(await app.evaluate(()=>global.menu),null);
 await browser.locator('.select').nth(1).click();assert.deepEqual(await app.evaluate(()=>global.review.tabs.map(t=>t.view.webContents.isAudioMuted())),[true,false]);
 await app.evaluate(()=>{global.closed=global.review.tabs[1].view.webContents});await browser.locator('.close').nth(1).click();await until(()=>app.evaluate(()=>global.closed.isDestroyed()));assert.deepEqual(await tabs(),{ids:['1'],active:'1'});
 await menu('1');await remember();await click('关闭全部标签');await destroyed();
 await open(['1']);await remember();await app.evaluate(()=>global.review.window.close());await destroyed();
 // Close immediately while local overlay documents may still be loading.
 await page.evaluate(async()=>{await desktop.call('openProfiles',{owner_uid:'100',ids:['2']})});await remember();await app.evaluate(()=>global.review.destroy());await destroyed();
 await open(['3']);await browser.locator('.close').click();await until(()=>app.evaluate(()=>global.review.window.isDestroyed()));await page.evaluate(()=>desktop.call('state'));
 await open(['4']);assert.equal(await app.evaluate(()=>global.review.profileMeta('MS4wLjABAAAA_tab_fixture_3').nickname),people[3].nickname);
 await menu('4');await click('复制标签页');await until(async()=>{const s=await tabs();return s.ids.length===2&&s.active!==s.ids[0]});
 assert.equal(await app.evaluate(()=>global.review.tabs[0].url===global.review.tabs[1].url),true);
 assert.deepEqual(await app.evaluate(()=>global.review.tabs.map(t=>t.view.webContents.isAudioMuted())),[true,false]);
 assert.deepEqual(await app.evaluate(()=>global.remote),[]);assert.deepEqual(await app.evaluate(()=>global.fatals),[]);assert.deepEqual(errors,[]);
 await browser.screenshot({path:path.join(profile,'browser-tabs.png')});await app.close();app=null;
 const saved=new Store(path.join(profile,'review.sqlite'));assert.deepEqual(saved.getReview().selected,['1','3']);assert.ok(saved.getReview().opened.includes('99'));assert.equal(saved.snapshot().rows.length,5);saved.close();
 fs.writeFileSync(path.join(profile,'timings.json'),JSON.stringify(openTimes,null,2));console.log('Local shell timings (mocked remote pages): '+JSON.stringify(openTimes));
 console.log('PASS review window, shell, tabs and overlays destroyed; main/collector survive; repeated reopen; stale IPC/menu safety; profile metadata; selection/open history retained; zero remote requests. '+(pkg?'Packaged':'Source'));
})().catch(async e=>{console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1});
