// Synthetic UI regression: no real account data, all external requests blocked.
const {_electron}=require('playwright-core'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {Store}=require('../dist/store');const root=path.resolve(__dirname,'..'),out=path.join(root,'output/playwright'),profile=path.join(out,'fixes-'+Date.now());fs.mkdirSync(profile,{recursive:true});
const db=new Store(path.join(profile,'review.sqlite'));db.activate('100','旧缓存昵称');db.reviewDelta('100',{opened:['7'],select:{ids:['7'],value:true},settings:{fans:'99'}});db.close();
let app;const pkg=process.argv.includes('--packaged')?JSON.parse(fs.readFileSync(path.join(root,'release/latest.json'))):null;
(async()=>{
 app=await _electron.launch({executablePath:pkg?.executable||require('electron'),args:[...(pkg?[]:[root]),'--data-dir='+profile,'--no-auto-groups','--no-auto-login'],timeout:120000});
 const p=await app.firstWindow();let page;for(let n=0;n<100;n++){page=app.windows().find(p=>p.url().includes('toolbox.html'));if(page)break;await new Promise(r=>setTimeout(r,100))}assert.ok(page);await page.waitForSelector('#session-status');const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({session,app})=>{
  const require=process.mainModule.require.bind(process.mainModule),path=require('node:path');global.remote=[];session.fromPartition('persist:douyin-login').webRequest.onBeforeRequest((d,cb)=>{global.remote.push(new URL(d.url).origin);cb({cancel:true})});
  const {DouyinTransport}=require(path.join(app.getAppPath(),'dist/browser'));global.testUser={uid:'100',sec_uid:'MS4wLjABAAAA_SELF',nickname:'已核验合成账号'};
  DouyinTransport.prototype.challenge=async()=>false;DouyinTransport.prototype.request=async()=>({user:global.testUser});
  const {DouyinGroupWire}=require(path.join(app.getAppPath(),'dist/group-wire'));global.groupCalls=0;global.groupFail=false;
  DouyinGroupWire.prototype.challenge=async()=>false;DouyinGroupWire.prototype.connect=async()=>({selfSec:'MS4wLjABAAAA_SELF',read:async(p,q)=>{global.groupCalls++;await new Promise(r=>setTimeout(r,300));if(global.groupFail)throw new (require(path.join(app.getAppPath(),'dist/transport')).CollectError)('NETWORK','合成断网');if(p.endsWith('/group/list/')){if(q.sec_user_id!=='MS4wLjABAAAA_SELF')throw Error('目录不是本人上下文');return {groups:[{id:'9223372036854775806',name:'空名单直接刷新组',member_count:1}],total:1,has_more:0,cursor:0}}return {user_list:[{uid:'7',sec_uid:'MS4wLjABAAAA_TARGET',nickname:'组内合成成员'}],total:1,has_more:0,cursor:0}},write:async()=>{throw Error('不允许真实写操作')}});
 });
 assert.match(await page.locator('#session-status').textContent(),/尚未核验/);assert.equal(await page.locator('#login').textContent(),'登录抖音');await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('session-status').textContent.includes('已核验合成账号'));
 for(const tool of ['groups','activity','chat-changes','duplicates','checkin','following']){
  await page.locator('[data-tool="'+tool+'"]').click();await page.waitForSelector('#session-status');await page.waitForFunction(()=>document.getElementById('login').textContent==='查看登录账号');assert.match(await page.locator('#session-status').textContent(),/已核验合成账号/);
  if(tool==='groups'){
   await page.getByRole('button',{name:'刷新全部分组',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#top-actions button')?.disabled);await page.waitForFunction(()=>document.getElementById('progress').textContent.includes('已同步 1'));assert.match(await page.locator('#member-rows').textContent(),/组内合成成员/);
   await app.evaluate(()=>{global.groupFail=true});await page.getByRole('button',{name:'刷新全部分组',exact:true}).click();await page.waitForFunction(()=>document.getElementById('progress').textContent.includes('本次未更新'));assert.match(await page.locator('#member-rows').textContent(),/组内合成成员/);await page.screenshot({path:path.join(out,'fixes-groups.png'),fullPage:true});
  }
  if(tool==='following')break;await page.locator('#home').click();await page.waitForSelector('[data-tool=following]');
 }
 // The owner is logged in, but the first following snapshot is still incomplete.
 await app.evaluate(({app})=>{const require=process.mainModule.require.bind(process.mainModule),path=require('node:path'),{Store}=require(path.join(app.getAppPath(),'dist/store'));const db=new Store(path.join(app.getPath('userData'),'review.sqlite'));const run=db.createRun('100',1000);db.addPage(run.id,Array.from({length:260},(_,i)=>({uid:String(i+10000),sec_uid:'MS4wLjABAAAA_TEST_'+i,nickname:'合成 '+i})),{offset:260,max_time:1,pages:13},false);db.close()});
 await page.reload();await page.waitForFunction(()=>document.getElementById('rows').textContent.includes('已获取 260 人'));assert.match(await page.locator('#data-status').textContent(),/完整后展示/);assert.equal(await page.locator('#total').textContent(),'0');await page.screenshot({path:path.join(out,'fixes-following.png'),fullPage:true});
 // One account switch updates all displays, while the previous owner's records remain untouched.
 await page.locator('#toolbox-home').click();await app.evaluate(()=>{global.testUser={uid:'200',sec_uid:'MS4wLjABAAAA_OTHER',nickname:'第二合成账号'}});await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('session-status').textContent.includes('第二合成账号'));
 await app.evaluate(()=>{global.testUser={uid:'0'}});await page.locator('#connect').click();await page.waitForFunction(()=>document.getElementById('login').textContent==='重新登录抖音');assert.match(await page.locator('#session-status').textContent(),/失效/);
 assert.deepEqual(errors,[]);assert.deepEqual(await app.evaluate(()=>global.remote),[]);await app.close();app=null;
 const saved=new Store(path.join(profile,'review.sqlite'));assert.deepEqual(saved.getReview('100').opened,['7']);assert.deepEqual(saved.getReview('100').selected,['7']);assert.equal(saved.getReview('100').settings.fans,'99');saved.close();console.log('PASS: shared login / account switch / expiry, first 260 rows pending, group refresh without following data, failed refresh preserves members, usage unchanged, zero remote requests.');
})().catch(async e=>{console.error(e);if(app)await app.close().catch(()=>{});process.exitCode=1});
