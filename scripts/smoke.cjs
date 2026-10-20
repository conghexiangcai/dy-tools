const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output','playwright');fs.mkdirSync(out,{recursive:true});
const profile=path.join(out,'smoke-'+Date.now());
const packaged=process.argv.includes('--packaged')?JSON.parse(fs.readFileSync(path.join(root,'release','latest.json'),'utf8')):null;
let app;
async function launch(){
 app=await _electron.launch({executablePath:packaged?.executable||require('electron'),args:[...(packaged?[]:[root]),'--data-dir='+profile],timeout:45000});
 let p;for(let i=0;i<100;i++){p=app.windows().find(p=>p.url()==='app://local/index.html');if(p)break;await new Promise(r=>setTimeout(r,100))}
 assert.ok(p);await p.waitForFunction(()=>document.getElementById('total')?.textContent==='4,278');return p;
}
(async()=>{
 let p=await launch(),errors=[];p.on('pageerror',e=>errors.push(e.message));
 console.log((await p.locator('body').innerText()).slice(0,600));
 assert.equal(await p.locator('#fans').inputValue(),'10000');assert.equal(await p.locator('#works-limit').inputValue(),'20');
 await p.locator('#fans').fill('');await p.locator('#works-limit').fill('');
 await p.locator('#fans-min').fill('10000');await p.locator('#works-min').fill('20');await p.locator('#logic').selectOption('and');
 const counts=await p.locator('#rows tr').evaluateAll(trs=>trs.map(tr=>[tr.children[2]?.textContent,tr.children[5]?.textContent]));
 assert.ok(counts.length);assert.ok(counts.every(([fans,works])=>Number(fans.replace(/,/g,''))>10000&&Number(works.replace(/,/g,''))>20));
 await p.locator('#select-page').click();assert.equal(await p.locator('#selected-count').textContent(),'50');
 await p.locator('#next').click();await p.locator('#rows input[type=checkbox]').first().check();
 assert.equal(await p.locator('#selected-count').textContent(),'51');
 await p.screenshot({path:path.join(out,packaged?'packaged.png':'desktop.png'),fullPage:true});
 const before=await p.evaluate(()=>window.desktop.call('snapshot'));assert.equal(before.rows.length,4278);assert.equal(before.review.selected.length,51);
 // The only mutation below is a local opened record in the isolated test profile.
 await p.evaluate(({owner,id})=>window.desktop.call('review',{owner_uid:owner,delta:{opened:[id]}}),{owner:before.summary.account_uid,id:before.review.selected[0]});
 await app.close();p=await launch();p.on('pageerror',e=>errors.push(e.message));
 assert.equal(await p.locator('#selected-count').textContent(),'51');assert.equal(await p.locator('#fans-min').inputValue(),'10000');assert.equal(await p.locator('#logic').inputValue(),'and');
 await p.locator('#opened-state').selectOption('opened');assert.equal(await p.locator('#match-count').textContent(),'1');
 await p.locator('#opened-state').selectOption('unopened');assert.ok(Number((await p.locator('#match-count').textContent()).replace(/,/g,''))>0);
 await p.locator('#search').fill('不存在的账号搜索条件_smoke');assert.equal(await p.locator('#match-count').textContent(),'0');assert.equal(await p.locator('#selected-count').textContent(),'51');
 const after=await p.evaluate(()=>window.desktop.call('snapshot'));assert.deepEqual(after.review.opened,[before.review.selected[0]]);
 // A remote view has no bridge, Node or local filesystem access; native IPC rejects non-shell senders.
 const prefs=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().map(w=>w.webContents.getLastWebPreferences()).map(p=>({node:p.nodeIntegration,sandbox:p.sandbox,isolation:p.contextIsolation})));
 assert.ok(prefs.every(p=>!p.node&&p.sandbox&&p.isolation));assert.deepEqual(errors,[]);
 await app.close();app=null;console.log('PASS: 快照、严格上下限、跨页勾选、重启恢复、是否打开、搜索和窗口隔离。');
})().catch(async e=>{console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1});
