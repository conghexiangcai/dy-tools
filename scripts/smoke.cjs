const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','playwright');fs.mkdirSync(out,{recursive:true});
const profile=path.join(out,'smoke-'+Date.now());
const packaged=process.argv.includes('--packaged')?JSON.parse(fs.readFileSync(path.join(root,'release','latest.json'),'utf8')):null;
let app;
// All regression data is synthetic and lives only in an isolated test profile.
const {Store}=require('../dist/store'),{exportText}=require('../dist/export'),{makeRow}=require('../dist/domain');
const offline=path.join(out,'offline-review.html');
function createFixture(){
 const store=new Store(path.join(profile,'review.sqlite'));store.activate('100','测试账号');const run=store.createRun('100',120);
 const users=Array.from({length:120},(_,i)=>({uid:String(10000+i),sec_uid:'MS4wLjABAAAA_TEST_'+i,nickname:'测试账号 '+i,unique_id:'test_'+i,secret:0,follow_status:1,follower_count:11000+i,following_count:20000+i,aweme_count:30}));
 store.addPage(run.id,users,{offset:120,max_time:0,pages:1},true);const at=Date.now();
 for(const [i,u] of users.entries()){store.saveRow(run.id,makeRow(u,u));store.saveVideos(run.id,u.uid,i<3?[1,2,3].map(n=>new Date(at-(n+i*10)*86400000).toISOString()):[],i<3?'verified':'unknown')}
 const groupA='9223372036854775806',groupB='9223372036854775805',mapping=new Map(users.map((u,i)=>[u.uid,i<5?[groupA,groupB]:i<20?[groupA]:[]]));const extra={...users[0],uid:'90000',sec_uid:'MS4wLjABAAAA_EXTRA_90000',nickname:'分组补充账号'};mapping.set(extra.uid,[groupA]);store.groups.complete('100',[{id:groupA,name:'合成分组一',member_count:21},{id:groupB,name:'合成分组二',member_count:5}],mapping,new Map([[extra.uid,extra]]));
 store.update(run.id,{status:'completed'});fs.writeFileSync(offline,exportText(store.snapshot(),'html',path.join(root,'resources/report-template.html')));store.close();
}
async function launch(dataDir=profile,expected='120'){
 app=await _electron.launch({executablePath:packaged?.executable||require('electron'),args:[...(packaged?[]:[root]),'--data-dir='+dataDir,'--no-auto-groups'],timeout:120000});
 let p;for(let i=0;i<100;i++){p=app.windows().find(p=>p.url()==='app://local/toolbox.html?tool=home');if(p)break;await new Promise(r=>setTimeout(r,100))}
 assert.ok(p);await p.locator('[data-tool=following]').click();await p.waitForURL('app://local/index.html');await p.waitForFunction(expected=>document.getElementById('total')?.textContent===expected,expected);return p;
}
(async()=>{
 const fresh=path.join(out,'fresh-'+Date.now());let p=await launch(fresh,'0'),errors=[];p.on('pageerror',e=>errors.push(e.message));
 const empty=await p.evaluate(()=>desktop.call('snapshot'));assert.equal(empty.summary.account_uid,'');assert.deepEqual(empty.rows,[]);assert.deepEqual(empty.review.selected,[]);assert.deepEqual(empty.review.opened,[]);assert.equal((await p.evaluate(()=>desktop.call('state'))).run,null);
 assert.ok((await p.locator('#data-status').textContent()).includes('暂无本地名单'));assert.equal(await p.locator('#import-review').isDisabled(),true);assert.equal(await p.locator('#export').isDisabled(),true);
 await p.locator('#fan-open').click();let fan;for(let i=0;i<80;i++){fan=app.windows().find(p=>p.url()==='app://local/fanclub.html');if(fan)break;await new Promise(r=>setTimeout(r,100))}assert.ok(fan);await fan.waitForFunction(()=>document.getElementById('anchor-count').textContent==='0');assert.equal(await fan.locator('#start').isDisabled(),true);assert.equal(await fan.locator('#result-panel').isHidden(),true);assert.equal(await fan.evaluate(()=>desktop.call('review',{owner_uid:'100',delta:{clearSelected:true}}).then(()=>false,()=>true)),true);await fan.close();
 await p.locator('#fans').fill('123');assert.equal(await p.locator('#app-error').isHidden(),true);assert.equal(await p.locator('#total').textContent(),'0');
 await p.screenshot({path:path.join(out,packaged?'fresh-packaged.png':'fresh-desktop.png'),fullPage:true});
 await app.close();p=await launch(fresh,'0');assert.deepEqual((await p.evaluate(()=>desktop.call('snapshot'))).rows,[]);await app.close();
 createFixture();p=await launch();p.on('pageerror',e=>errors.push(e.message));
 console.log((await p.locator('body').innerText()).slice(0,600));
 assert.equal(await p.locator('#fans').inputValue(),'10000');assert.equal(await p.locator('#works-limit').inputValue(),'20');
 await p.locator('#fans').fill('');await p.locator('#works-limit').fill('');
 await p.locator('#fans-min').fill('10000');await p.locator('#works-min').fill('20');await p.locator('#logic').selectOption('and');
 await p.locator('#days-max').fill('10');assert.equal(await p.locator('#match-count').textContent(),'1');
 assert.equal(await p.locator('#rows .video-times div').count(),3);assert.ok((await p.locator('#rows .video-times').innerText()).includes('最新距今 1 天'));
 await p.locator('#days-max').fill('');await p.locator('#days-min').fill('10');assert.equal(await p.locator('#match-count').textContent(),'2');
 await p.locator('#days-min').fill('');await p.locator('#sort').selectOption('recency_desc');
 assert.ok((await p.locator('#rows .video-times').first().innerText()).includes('最新距今 21 天'));
 await p.locator('#sort').selectOption('difference_desc');
 const headers=await p.locator('thead th').allTextContents();assert.ok(!headers.includes('关注状态'));assert.ok(headers.findIndex(x=>x.includes('所属分组'))<headers.indexOf('命中条件'));
 await p.locator('#group-filter').selectOption('9223372036854775806');assert.equal(await p.locator('#match-count').textContent(),'20');
 await p.locator('#group-filter').selectOption('9223372036854775805');assert.equal(await p.locator('#match-count').textContent(),'5');
 await p.locator('#group-filter').selectOption('9223372036854775806');await p.locator('#fans-min').fill('');await p.locator('#works-min').fill('');assert.equal(await p.locator('#match-count').textContent(),'21');
 await p.locator('#group-filter').selectOption('ungrouped');assert.equal(await p.locator('#match-count').textContent(),'100');
 await p.locator('#group-filter').selectOption('');await p.locator('#fans-min').fill('10000');await p.locator('#works-min').fill('20');
 const counts=await p.locator('#rows tr').evaluateAll(trs=>trs.map(tr=>[tr.children[2]?.textContent,tr.children[5]?.textContent]));
 assert.ok(counts.length);assert.ok(counts.every(([fans,works])=>Number(fans.replace(/,/g,''))>10000&&Number(works.replace(/,/g,''))>20));
 // Visibility is independent of a known work count, including offline exports.
 await p.evaluate(()=>{filtered[0].r.is_private=true;render()});
 assert.equal(await p.locator('#rows .person-name .private-badge').count(),1);
 assert.equal(await p.locator('#rows .private-badge').textContent(),'🔒 私密账号');
 await p.screenshot({path:path.join(out,'privacy-badge.png'),fullPage:true});
 await p.evaluate(()=>{filtered[0].r.is_private=null;render()});
 assert.equal(await p.locator('#rows .private-badge').count(),0);
 await p.evaluate(()=>{filtered[0].r.is_private=false;render()});
 await p.locator('#select-page').click();assert.equal(await p.locator('#selected-count').textContent(),'50');
 await p.locator('#next').click();await p.locator('#rows input[type=checkbox]').first().check();
 assert.equal(await p.locator('#selected-count').textContent(),'51');
 await p.screenshot({path:path.join(out,packaged?'packaged.png':'desktop.png'),fullPage:true});
 const before=await p.evaluate(()=>window.desktop.call('snapshot'));assert.equal(before.rows.length,120);assert.equal(before.review.selected.length,51);
 // The only mutation below is a local opened record in the isolated test profile.
 await p.evaluate(({owner,id})=>window.desktop.call('review',{owner_uid:owner,delta:{opened:[id]}}),{owner:before.summary.account_uid,id:before.review.selected[0]});
 await app.close();p=await launch();p.on('pageerror',e=>errors.push(e.message));
 assert.equal(await p.locator('#selected-count').textContent(),'51');assert.equal(await p.locator('#fans-min').inputValue(),'10000');assert.equal(await p.locator('#logic').inputValue(),'and');
 await p.locator('#opened-state').selectOption('opened');assert.equal(await p.locator('#match-count').textContent(),'1');
 await p.locator('#opened-state').selectOption('unopened');assert.ok(Number((await p.locator('#match-count').textContent()).replace(/,/g,''))>0);
 await p.locator('#search').fill('不存在的账号搜索条件_smoke');assert.equal(await p.locator('#match-count').textContent(),'0');assert.equal(await p.locator('#selected-count').textContent(),'51');
 const after=await p.evaluate(()=>window.desktop.call('snapshot'));assert.deepEqual(after.review.opened,[before.review.selected[0]]);
 // Hold the import result after it commits, then edit the UI concurrently.
 const importedId=before.rows.find(r=>!before.review.selected.includes(r.uid)).uid,removedId=before.review.selected[0];
 const importFile=path.join(out,'import-review-smoke.json');fs.writeFileSync(importFile,JSON.stringify({account_uid:before.summary.account_uid,review:{selected:[importedId],opened:[importedId],settings:{fans:'999'}}}));
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]})},importFile);
 await p.evaluate(()=>{const original=act;act=async(...args)=>{const value=await original(...args);if(args[0]==='importReview'&&value){window.importCommitted=true;await new Promise(resolve=>{window.releaseImport=resolve})}return value}});
 await p.locator('#import-review').click();await p.waitForFunction(()=>window.importCommitted);
 await p.locator('#fans-min').fill('12345');
 await p.evaluate(async id=>{selected.delete(id);await write({select:{ids:[id],value:false}});apply(false)},removedId);
 await p.evaluate(()=>window.releaseImport());
 await p.waitForFunction(({added,removed})=>selected.has(added)&&!selected.has(removed),{added:importedId,removed:removedId});
 assert.equal(await p.locator('#fans-min').inputValue(),'12345');assert.equal(await p.locator('#selected-count').textContent(),'51');
 const merged=await p.evaluate(()=>window.desktop.call('snapshot'));assert.ok(!merged.review.selected.includes(removedId));assert.ok(merged.review.selected.includes(importedId));assert.deepEqual(new Set(merged.review.opened),new Set([removedId,importedId]));assert.equal(merged.review.settings['fans-min'],'12345');
 // A remote view has no bridge, Node or local filesystem access; native IPC rejects non-shell senders.
 const prefs=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getLastWebPreferences()).map(p=>({node:p.nodeIntegration,sandbox:p.sandbox,isolation:p.contextIsolation})));
 assert.ok(prefs.every(p=>!p.node&&p.sandbox&&p.isolation));assert.deepEqual(errors,[]);
 // Test standalone HTML in an isolated test window, with no Node bridge.
 const offlinePagePromise=app.waitForEvent('window');await app.evaluate(async({BrowserWindow},file)=>{const win=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});await win.loadFile(file)},offline);
 const exported=await offlinePagePromise;await exported.waitForFunction(()=>document.getElementById('total')?.textContent==='120');
 await exported.locator('#fans').fill('');await exported.locator('#works-limit').fill('');await exported.locator('#days-max').fill('10');assert.equal(await exported.locator('#match-count').textContent(),'1');assert.equal(await exported.locator('#rows .video-times div').count(),3);
 await exported.locator('#days-max').fill('');await exported.locator('#group-filter').selectOption('9223372036854775806');assert.equal(await exported.locator('#match-count').textContent(),'21');
 await exported.evaluate(()=>{filtered[0].r.is_private=true;render()});assert.equal(await exported.locator('#rows .private-badge').count(),1);
 await app.close();app=null;console.log('PASS: 首次及重复启动空名单、未登录筛选无保存错误、合成快照、严格上下限、时间筛选排序及三行展示、跨页勾选、重启恢复、是否打开、搜索、导入时并发编辑、窗口隔离和离线 HTML。');
})().catch(async e=>{console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1});
