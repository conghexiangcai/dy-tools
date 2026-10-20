const {_electron}=require('playwright-core'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');const root=path.resolve(__dirname,'..'),out=path.join(root,'output/playwright');fs.mkdirSync(out,{recursive:true});let app;
async function visible(){return app.evaluate(()=>testGroups.ui.overlay.getVisible())}
async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100))}throw Error('UI state timeout')}
(async()=>{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'group-fixture.cjs'),'--data-dir='+path.join(out,'group-ui-'+Date.now())],timeout:120000});
 await until(()=>app.evaluate(()=>!!global.testGroups?.host.current));await until(visible);
 const button=app.windows().find(p=>p.url()==='app://local/group-button.html');assert.ok(button);
 const state=await app.evaluate(()=>{const t=testGroups;return {b:t.ui.overlay.getBounds(),url:t.host.current.getURL()}});assert.equal(state.b.x,550);assert.ok(state.b.y>92);
 const remote=app.windows().find(p=>p.url().includes('SYNTHETIC_1'));assert.ok(remote);assert.deepEqual(await remote.evaluate(()=>({node:typeof require,bridge:typeof desktop})),{node:'undefined',bridge:'undefined'});
 await remote.evaluate(()=>scrollTo(0,500));await until(async()=>!await visible());await remote.evaluate(()=>scrollTo(0,0));await until(visible);
 await button.locator('#group-open').click();await until(()=>app.windows().some(p=>p.url()==='app://local/group-dialog.html'));
 let dialog=app.windows().find(p=>p.url()==='app://local/group-dialog.html');await dialog.waitForSelector('#group-options input');assert.equal(await dialog.locator('#group-options input').count(),2);assert.equal(await dialog.locator('#group-options input').first().isChecked(),true);
 await dialog.screenshot({path:path.join(out,'groups-dialog.png')});
 // No-change save sends zero writes. Actual mutations below touch mock memory only.
 await dialog.locator('#group-save').click();await until(async()=>(await dialog.locator('#group-message').textContent()).includes('没有需要'));
 assert.equal(await app.evaluate(()=>testGroups.writes),0);
 await dialog.locator('#group-options input').first().uncheck();await dialog.locator('#group-options input').nth(1).check();await dialog.locator('#group-save').click();await until(async()=>(await dialog.locator('#group-message').textContent()).includes('回读确认'));assert.equal(await app.evaluate(()=>testGroups.writes),1);
 await app.evaluate(()=>testGroups.host.select('2'));await until(()=>dialog.isClosed());await until(visible);
 await button.locator('#group-open').click();await until(()=>app.windows().some(p=>p.url()==='app://local/group-dialog.html'));dialog=app.windows().find(p=>p.url()==='app://local/group-dialog.html');await dialog.waitForSelector('#group-options input');assert.ok((await dialog.locator('#group-person').textContent()).includes('合成账号二'));
 await app.evaluate(()=>testGroups.host.current.loadURL('https://www.douyin.com/user/UNKNOWN_ACCOUNT'));await until(()=>dialog.isClosed());await until(async()=>!await visible());
 await app.evaluate(async()=>{testGroups.host.select('1');await testGroups.host.current.executeJavaScript("document.body.insertAdjacentHTML('afterbegin','<p>请完成下列验证后继续</p>')")});await until(async()=>!await visible());
 const usage=await app.evaluate(()=>testGroups.store.getReview());assert.deepEqual(usage.opened,[]);assert.deepEqual(usage.selected,[]);
 await app.close();app=null;console.log('PASS: 分组按钮锚定、滚动隐藏、隔离界面、多选与差量保存回读、无修改零写入、切换标签绑定、未知主页与验证码隐藏、使用记录保留。所有写入仅为合成内存。');
})().catch(async e=>{console.error(e);if(app){console.log(await app.evaluate(async()=>{const t=global.testGroups;if(!t)return {missing:true};return {url:t.host.current?.getURL(),visible:t.host.window.isVisible(),loaded:t.ui.loaded,owner:t.store.owner(),anchor:t.ui.anchor,revision:t.host.revision,html:await t.host.current?.executeJavaScript('document.documentElement.outerHTML'),inspect:await t.host.current?.executeJavaScript('('+t.inspect+')()')}}).catch(e=>({error:e.message})));await app.close().catch(()=>{})}process.exitCode=1});
