const {_electron}=require('playwright-core'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output/playwright');fs.mkdirSync(out,{recursive:true});let app;
(async()=>{
 app=await _electron.launch({executablePath:require('electron'),args:[path.join(__dirname,'fanclub-fixture.cjs'),'--data-dir='+path.join(out,'fanclub-'+Date.now())],timeout:120000});
 const p=await app.firstWindow();await p.waitForSelector('#add');const errors=[];p.on('pageerror',e=>errors.push(e.message));
 assert.equal(await p.locator('#anchor-count').textContent(),'0');assert.equal(await p.locator('#start').isDisabled(),true);
 for(const uid of ['7','8','9','7']){await p.locator('#anchor-input').fill(uid);await p.locator('#add').click();await p.waitForFunction(()=>document.getElementById('anchor-input').value==='')}
 assert.equal(await p.locator('.anchor').count(),3);await p.locator('[data-remark="7"]').fill('常看主播');await p.locator('[data-remark="7"]').blur();await p.waitForFunction(()=>document.getElementById('add').disabled===false);
 await p.locator('#target-input').fill('1');await p.locator('#resolve').click();await p.waitForSelector('#target:not([hidden])');assert.ok((await p.locator('#target').textContent()).includes('合成目标用户'));
 await p.locator('#start').click();await p.waitForFunction(()=>document.getElementById('status').textContent.includes('查询完成'));
 assert.equal(await p.locator('#results tr').count(),3);assert.ok((await p.locator('#result-user').textContent()).includes('34,000'));assert.ok((await p.locator('#results').textContent()).includes('未知'));assert.ok((await p.locator('#results').textContent()).includes('未点亮'));
 await p.locator('#search').fill('常看');assert.equal(await p.locator('#results tr').count(),1);await p.locator('#search').fill('');
 await p.screenshot({path:path.join(out,'fanclub-toolbox.png'),fullPage:true});
 await p.locator('[data-select="8"]').uncheck();await p.waitForFunction(()=>document.getElementById('add').disabled===false);await p.locator('#start').click();await p.waitForFunction(()=>document.getElementById('status').textContent.includes('2 / 2'));
 const usage=await app.evaluate(()=>testFans.store.getReview());assert.deepEqual(usage.selected,['7']);assert.deepEqual(usage.opened,['8']);assert.equal(usage.settings.fans,'99');
 const denied=await p.evaluate(()=>desktop.call('review',{owner_uid:'100',delta:{clearSelected:true}}).then(()=>false,()=>true));assert.equal(denied,true);
 await p.locator('#target-input').fill('2');await app.evaluate(()=>testFans.ui.notify());await p.waitForTimeout(100);assert.equal(await p.locator('#target').isHidden(),true);assert.equal(await p.locator('#start').isDisabled(),true);
 await p.locator('#resolve').click();await p.waitForSelector('#target:not([hidden])');assert.ok((await p.locator('#target').textContent()).includes('test_2'));
 await app.evaluate(()=>{testFans.store.activate('200');testFans.ui.notify()});await p.waitForFunction(()=>document.getElementById('anchor-count').textContent==='0');assert.equal(await p.locator('#result-panel').isHidden(),true);
 assert.deepEqual(errors,[]);await app.close();app=null;console.log('PASS: empty catalog, dedupe, remarks, target preview, selected scope, badge/range/unknown display, result search, account isolation, preserved review, and restricted IPC. Synthetic data only.');
})().catch(async e=>{console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1});
