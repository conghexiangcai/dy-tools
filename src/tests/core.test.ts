import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../store';
import {Collector} from '../collector';
import {CollectError,Transport,parseFollowing,parseOwner,parseVideos,newestThree} from '../transport';
import {User,makeRow,classify,settingsDefaults,latestAge,matchesAge,accountPrivacy} from '../domain';
import {exportText} from '../export';

const user=(id:string):User=>({uid:id,sec_uid:'MS4wLjABAAAA'+id,nickname:'账号 '+id,follower_count:10000,follow_status:1,secret:0});
const profile=(u:User,works:number|null=20)=>({...u,following_count:10000,aweme_count:works});
const config=(extra:any={})=>({...settingsDefaults,...extra});
function fixture(t:any){const dir=mkdtempSync(path.join(os.tmpdir(),'dy-review-'));let store=new Store(path.join(dir,'db.sqlite'));store.activate('100','本人');t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true})});return {dir,get store(){return store},reopen(){store.close();store=new Store(path.join(dir,'db.sqlite'));return store}}}
async function idle(c:Collector){for(let i=0;i<300&&c.busy;i++)await new Promise(r=>setTimeout(r,1));assert.equal(c.busy,false,'采集任务应已退出');}
function fake(extra:Partial<Transport>={}):Transport{return {owner:async()=>({...user('100'),following_count:2}),following:async()=>({users:[user('1'),user('2')],more:false,min_time:0}),profile:async u=>profile(u),videos:async()=>({videos:[],more:false,cursor:0,valid:true}),challenge:async()=>false,show:()=>{},...extra}}

test('严格上下边界、或/且以及未知值三态判断',()=>{
  const r=makeRow(user('1'),profile(user('1')));
  assert.equal(classify(r,config()).state,'excluded');
  assert.equal(classify({...r,follower_count:9999},config()).state,'match');
  assert.equal(classify({...r,works_count:19},config()).state,'match');
  assert.equal(classify({...r,works_count:null},config()).state,'pending');
  assert.equal(classify({...r,works_count:null,follower_count:9999},config()).state,'match');
  assert.equal(classify({...r,works_count:null,follower_count:9999},config({logic:'and'})).state,'pending');
  assert.equal(classify({...r,works_count:null},config({logic:'and'})).state,'excluded');
  assert.equal(classify(r,config({fans:'','works-limit':'','following-greater':true})).state,'excluded');
  assert.equal(classify({...r,following_count:10001},config({fans:'','works-limit':'','following-greater':true})).state,'match');
  const greater=config({fans:'','works-limit':'','fans-min':'10000','works-min':'20'});
  assert.equal(classify(r,greater).state,'excluded');
  assert.equal(classify({...r,works_count:21},greater).state,'match');
  assert.equal(classify({...r,works_count:21}, {...greater,logic:'and'}).state,'excluded');
  assert.throws(()=>classify(r,config({fans:'-1'})));
  assert.equal(classify({...r,works_count:null},config({fans:'','works-limit':''})).state,'match');
});
test('作品来源、私密/缺失数据未知、互关映射以及账号身份',()=>{
  const u={...user('1'),aweme_count:0};
  assert.equal(makeRow(u).works_count,null);
  assert.equal(makeRow(u,profile(u,6)).works_count,6);
  assert.equal(makeRow(u,{...profile(u,0),secret:1}).works_count,null);
  assert.equal(makeRow(u,{...profile(u),aweme_count:undefined}).works_count,null);
  assert.equal(makeRow(u,{...profile(u),follow_status:2}).mutual_follow,true);
  assert.equal(makeRow(u,{...profile(u),follow_status:1}).mutual_follow,false);
  assert.equal(makeRow(u,{...profile(u),follow_status:0}).mutual_follow,null);
  assert.throws(()=>makeRow(u,profile(user('2'))));
});
test('隐私状态独立于作品数，旧数据兼容不会覆盖使用记录',t=>{
  const {store:s}=fixture(t),u=user('1'),r=s.createRun('100',1);
  assert.equal(makeRow({...u,secret:1}).is_private,true);
  assert.equal(makeRow({...u,secret:1},{...profile(u),secret:0}).is_private,false);
  assert.equal(makeRow({...u,secret:undefined}).is_private,null);
  assert.equal(accountPrivacy({is_private:true,works_status:'verified',works_count:20}),true);
  assert.equal(accountPrivacy({is_private:null,works_status:'private'}),null);
  assert.equal(accountPrivacy({works_status:'request_failed'}),null);
  s.addPage(r.id,[{...u,secret:1}],{offset:1,max_time:0,pages:1},true);
  const legacy={...makeRow(u),works_status:'not_checked'};delete legacy.is_private;s.saveRow(r.id,legacy);
  s.reviewDelta('100',{opened:['1'],select:{ids:['1'],value:true},settings:{search:'保留筛选'}});
  const before=s.getReview();assert.equal(s.snapshot().rows[0].is_private,true);
  assert.deepEqual(s.getReview(),before);
  assert.equal(JSON.parse((s.db.prepare('SELECT data FROM profiles WHERE run_id=? AND uid=?').get(r.id,u.uid) as any).data).is_private,undefined);
});
test('接口结构和分页游标校验',()=>{
  assert.throws(()=>parseOwner({user:{uid:'0'}}),/登录/);
  assert.throws(()=>parseFollowing({followings:[],has_more:1,min_time:2}),(e:any)=>e.code==='EMPTY');
  assert.throws(()=>parseFollowing({followers:[user('1')],has_more:0}),/格式/);
  assert.deepEqual(parseFollowing({followings:[user('1')],has_more:1,min_time:123}).min_time,123);
});
test('完整分页后才替换名单，去重、历史和记录独立保存，账号隔离',t=>{
  const f=fixture(t),s=f.store,first=s.createRun('100',1);
  s.addPage(first.id,[user('1')],{offset:1,max_time:0,pages:1},true);s.saveRow(first.id,makeRow(user('1'),profile(user('1'))));
  s.reviewDelta('100',{select:{ids:['1'],value:true},opened:['1'],lastBatch:['1'],settings:{'fans-min':'99'}});
  const next=s.createRun('100',2);s.addPage(next.id,[user('2')],{offset:1,max_time:55,pages:1},false);
  assert.deepEqual(s.snapshot().rows.map(r=>r.uid),['1']);
  s.reviewDelta('100',{select:{ids:['3'],value:true}});
  s.addPage(next.id,[user('2'),user('3')],{offset:3,max_time:0,pages:2},true);
  assert.deepEqual(s.snapshot().rows.map(r=>r.uid),['2','3']);
  assert.equal(s.snapshot().rows[0].works_count,null);
  assert.deepEqual(s.getReview().opened,['1']);assert.deepEqual(s.getReview().selected,['1','3']);
  assert.equal(s.members(first.id).length,1);
  s.activate('200');assert.equal(s.snapshot().rows.length,0);assert.deepEqual(s.getReview().opened,[]);
  s.reviewDelta('200',{opened:['2']});s.activate('100');assert.deepEqual(s.getReview().opened,['1']);
  f.reopen();assert.equal(f.store.latest()!.status,'paused');assert.deepEqual(f.store.getReview().opened,['1']);assert.equal(f.store.latest()!.offset,3);
});
test('新任务重新采集，断点仅跳过本任务成功项，记录导入合并',t=>{
  const {store:s}=fixture(t),r=s.createRun('100',2);s.addPage(r.id,[user('1'),user('2')],{offset:2,max_time:0,pages:1},true);
  s.saveRow(r.id,makeRow(user('1'),profile(user('1'))));assert.equal(s.nextUser(r.id)?.uid,'2');
  const n=s.createRun('100',2);s.addPage(n.id,[user('1')],{offset:1,max_time:0,pages:1},true);assert.equal(s.nextUser(n.id)?.uid,'1');
  s.reviewDelta('100',{opened:['1'],select:{ids:['1'],value:true},settings:{fans:'123'}});
  s.importReview('100',{account_uid:'100',review:{selected:['2'],opened:['2'],settings:{fans:'999'}}});
  assert.deepEqual(s.getReview().selected,['1','2']);assert.deepEqual(s.getReview().opened,['1','2']);assert.equal(s.getReview().settings.fans,'123');
  assert.throws(()=>s.importReview('100',{account_uid:'200'}),/另一个/);
});
test('已完成的旧任务升级后只补视频时间，不丢详情或使用记录',t=>{
 const f=fixture(t),s=f.store,r=s.createRun('100',1);s.addPage(r.id,[user('1')],{offset:1,max_time:0,pages:1},true);s.saveRow(r.id,makeRow(user('1'),profile(user('1'),7)));s.update(r.id,{status:'completed'});s.reviewDelta('100',{opened:['1'],select:{ids:['1'],value:true}});
 const upgraded=f.reopen();assert.equal(upgraded.latest()!.phase,'videos');assert.equal(upgraded.latest()!.status,'paused');assert.equal(upgraded.nextUser(r.id),null);assert.equal(upgraded.nextVideos(r.id)?.row.works_count,7);assert.deepEqual(upgraded.getReview().opened,['1']);assert.deepEqual(upgraded.getReview().selected,['1']);
});
test('只有筛选编辑或曾取消勾选也算已有使用记录，导入不覆盖设置',t=>{
 const {store:s}=fixture(t);s.reviewDelta('100',{settings:{fans:'123'}});
 s.importReview('100',{account_uid:'100',review:{selected:['1'],settings:{fans:'999'}}});assert.equal(s.getReview().settings.fans,'123');assert.deepEqual(s.getReview().selected,['1']);
 s.activate('200');s.reviewDelta('200',{select:{ids:['2'],value:false}});
 s.importReview('200',{account_uid:'200',review:{settings:{fans:'999'}}});assert.equal(s.getReview().settings.fans,settingsDefaults.fans);
 s.activate('300');s.importReview('300',{account_uid:'300',review:{settings:{fans:'999'},lastBatch:['3']}});assert.equal(s.getReview().settings.fans,'999');assert.deepEqual(s.getReview().lastBatch,['3']);
});
test('真实分页协议、重复账号去重和正常完成',async t=>{
  const {store:s}=fixture(t),calls:any[]=[];
  const c=new Collector(s,fake({following:async(_owner,offset,time)=>{calls.push([offset,time]);return offset===0?{users:[user('1')],more:true,min_time:123}:{users:[user('1'),user('2')],more:false,min_time:0}}}),()=>{},async()=>{});
  await c.start();await idle(c);assert.deepEqual(calls,[[0,0],[1,123]]);assert.equal(s.latest()?.status,'completed');assert.deepEqual(s.progress(s.latest()!.id),{total:2,completed:2,videos:2});
});
test('最新三条按发布时间排序，处理置顶及重复；缺失/错作者明确区分',()=>{
 const data={has_more:0,max_cursor:0,aweme_list:[{aweme_id:'1',create_time:1000,is_top:1,author_uid:'1'},{aweme_id:'2',create_time:4000,is_top:0,author_uid:'1'},{aweme_id:'3',create_time:3000,is_top:0,author_uid:'1'},{aweme_id:'4',create_time:2000,is_top:0,author_uid:'1'},{aweme_id:'2',create_time:4000,is_top:0,author_uid:'1'}]};
 assert.deepEqual(newestThree(parseVideos(data,user('1')).videos),[4000,3000,2000].map(v=>new Date(v*1000).toISOString()));
 assert.throws(()=>parseVideos(data,user('2')),/身份/);
 assert.equal(parseVideos({...data,aweme_list:[{aweme_id:'1'}]},user('1')).valid,false);
});
test('实际空作品响应省略分页字段时记未知，仍拒绝其他异常结构',()=>{
 const observed={status_code:0,aweme_list:null,time_list:null,log_pb:{}};
 assert.deepEqual(parseVideos(observed,user('1')),{videos:[],more:false,cursor:0,valid:false});
 assert.throws(()=>parseVideos({aweme_list:[]},user('1')),/结构/);
 assert.throws(()=>parseVideos({aweme_list:{},has_more:0},user('1')),/结构/);
 assert.throws(()=>parseVideos(null,user('1')),/结构/);
 assert.throws(()=>parseVideos({aweme_list:null,has_more:1},user('1')),/游标/);
});
test('缺少分页的空作品账号不会阻塞队列或把未知作品数变成零',async t=>{
 const {store:s}=fixture(t),calls:string[]=[];s.reviewDelta('100',{opened:['1'],select:{ids:['2'],value:true}});
 const c=new Collector(s,fake({profile:async u=>profile(u,u.uid==='1'?null:20),videos:async u=>{calls.push(u.uid);return u.uid==='1'?parseVideos({status_code:0,aweme_list:null},u):{videos:[{id:'50',time:1780000000,pinned:false}],more:false,cursor:0,valid:true}}}),()=>{},async()=>{});
 await c.start();await idle(c);assert.equal(s.latest()!.status,'completed');assert.deepEqual(calls,['1','2']);assert.equal(s.progress(s.latest()!.id).videos,2);
 const rows=s.snapshot().rows;assert.equal(rows[0].works_count,null);assert.equal(rows[0].recent_videos_status,'unknown');assert.deepEqual(rows[0].recent_video_times,[]);assert.equal(rows[1].recent_video_times?.length,1);assert.deepEqual(s.getReview().opened,['1']);assert.deepEqual(s.getReview().selected,['2']);
});
test('结构错误优先辨别实际验证码，真实结构变化依然暂停',async t=>{
 const {store:s}=fixture(t);let captcha=true;
 const c=new Collector(s,fake({videos:async()=>{throw new CollectError('SCHEMA','作品列表接口结构发生变化')},challenge:async()=>captcha}),()=>{},async()=>{});
 await c.start();await idle(c);assert.equal(s.latest()!.status,'waiting_verification');assert.equal(s.progress(s.latest()!.id).videos,0);
 captcha=false;await c.resume(true);await idle(c);assert.equal(s.latest()!.status,'error');assert.match(s.latest()!.message,/结构/);assert.equal(s.progress(s.latest()!.id).videos,0);
});
test('最新距今天数、时区跨日、严格上下限、未知和未来日期',()=>{
 const now=Date.parse('2026-10-01T00:01:00+08:00');
 assert.equal(latestAge({recent_video_times:['2026-09-30T23:59:00+08:00']},now),1);
 assert.equal(latestAge({recent_video_times:['2026-10-01T00:00:00+08:00']},now),0);
 assert.equal(latestAge({recent_video_times:[]},now),null);
 assert.equal(latestAge({recent_video_times:['2026-10-02T00:00:00+08:00']},now),null);
 assert.equal(matchesAge(null,config()),true);assert.equal(matchesAge(null,config({'days-min':'10'})),false);
 assert.equal(matchesAge(10,config({'days-min':'10'})),false);assert.equal(matchesAge(11,config({'days-min':'10'})),true);
 assert.equal(matchesAge(10,config({'days-max':'10'})),false);assert.equal(matchesAge(9,config({'days-max':'10'})),true);
 assert.equal(matchesAge(10,config({'days-min':'5','days-max':'11'})),true);
 assert.throws(()=>matchesAge(10,config({'days-min':'-2'})));
});
test('视频阶段单独断点，旧详情不重取，私密/零作品不请求视频接口',async t=>{
 const {store:s}=fixture(t);const r=s.createRun('100',3);s.addPage(r.id,[user('1'),user('2'),user('3')],{offset:3,max_time:0,pages:1},true);
 s.saveRow(r.id,makeRow(user('1'),profile(user('1'),0)));s.saveRow(r.id,makeRow(user('2'),{...profile(user('2')),secret:1}));s.saveRow(r.id,makeRow(user('3'),profile(user('3'),9)));
 let calls=0,fail=true;const c=new Collector(s,fake({profile:async()=>{throw Error('不能重新读取已有详情')},videos:async()=>{calls++;if(fail)throw new CollectError('TIMEOUT','超时');return {videos:[{id:'4',time:1780000000,pinned:false}],more:false,cursor:0,valid:true}}}),()=>{},async()=>{});
 await c.resume();await idle(c);assert.equal(s.latest()!.phase,'videos');assert.equal(s.latest()!.status,'error');assert.equal(calls,3);assert.equal(s.progress(r.id).videos,2);
 fail=false;await c.resume();await idle(c);assert.equal(calls,4);assert.equal(s.progress(r.id).videos,3);assert.equal(s.snapshot().rows[0].recent_videos_status,'empty');assert.equal(s.snapshot().rows[1].recent_videos_status,'private');assert.equal(s.snapshot().rows[2].recent_video_times?.length,1);
});
test('单个账号作品游标不前进时保存未知并继续其他账号',async t=>{
 const {store:s}=fixture(t);const c=new Collector(s,fake({videos:async()=>({videos:[],more:true,cursor:0,valid:true})}),()=>{},async()=>{});
 await c.start();await idle(c);assert.equal(s.latest()?.status,'completed');assert.equal(s.progress(s.latest()!.id).videos,2);assert.ok(s.snapshot().rows.every(r=>r.recent_videos_status==='conflict'&&r.recent_video_times?.length===0));
});
test('网络错误最多重试两次，不将失败写成零，继续可恢复',async t=>{
  const {store:s}=fixture(t);let attempts=0,fail=true;
  const c=new Collector(s,fake({profile:async u=>{attempts++;if(fail)throw new CollectError('TIMEOUT','请求超时');return profile(u)}}),()=>{},async()=>{});
  await c.start();await idle(c);assert.equal(attempts,3);assert.equal(s.latest()?.status,'error');assert.equal(s.snapshot().rows[0].works_count,null);assert.equal(s.latest()?.error_uid,'1');
  fail=false;await c.resume();await idle(c);assert.equal(attempts,5);assert.equal(s.latest()?.status,'completed');
});
test('验证码暂停、确认后恰好五秒检查，保留已成功账号及并发勾选',async t=>{
  const {store:s}=fixture(t);let captcha=false;const calls:string[]=[],delays:number[]=[];
  const c=new Collector(s,fake({profile:async u=>{calls.push(u.uid);if(u.uid==='2'&&calls.length===2){captcha=true;throw new CollectError('EMPTY','空响应')}return profile(u)},challenge:async()=>captcha}),()=>{},async ms=>{delays.push(ms)});
  await c.start();await idle(c);assert.equal(s.latest()?.status,'waiting_verification');assert.equal(s.progress(s.latest()!.id).completed,1);
  s.reviewDelta('100',{opened:['1'],select:{ids:['2'],value:true}});
  delays.length=0;await c.resume(true);await idle(c);assert.deepEqual(delays,[1000,1000,1000,1000,1000]);assert.equal(s.latest()?.status,'waiting_verification');
  captcha=false;delays.length=0;await c.resume(true);await idle(c);assert.deepEqual(delays.slice(0,5),[1000,1000,1000,1000,1000]);assert.deepEqual(calls,['1','2','2']);assert.equal(s.latest()?.status,'completed');assert.deepEqual(s.getReview().opened,['1']);assert.deepEqual(s.getReview().selected,['2']);
});
test('空响应检查验证码，等待三十和六十秒后自动继续成功请求',async t=>{
  const {store:s}=fixture(t);let calls=0,checks=0;const delays:number[]=[];
  const c=new Collector(s,fake({videos:async()=>{calls++;if(calls<3)throw new CollectError('EMPTY','空响应');return {videos:[{id:'50',time:1780000000,pinned:false}],more:false,cursor:0,valid:true}},challenge:async()=>{checks++;return false}}),()=>{},async ms=>{if(c.state().retry)delays.push(ms)});
  await c.start();await idle(c);assert.equal(s.latest()!.status,'completed');assert.equal(calls,4);assert.equal(checks,4);assert.equal(delays.length,90);assert.ok(delays.every(ms=>ms===1000));assert.equal(s.progress(s.latest()!.id).videos,2);
});
test('持续空响应不跳过账号，等待期间可暂停并保留视频断点',async t=>{
  const {store:s}=fixture(t);let calls=0,shown=0,fail=true,paused=false;
  const c=new Collector(s,fake({videos:async()=>{calls++;if(fail)throw new CollectError('EMPTY','空响应');return {videos:[{id:'50',time:1780000000,pinned:false}],more:false,cursor:0,valid:true}},show:()=>{shown++}}),()=>{if(!paused&&c.state().retry?.attempt===3){paused=true;c.pause()}},async()=>{});
  await c.start();await idle(c);const id=s.latest()!.id;assert.equal(calls,3);assert.equal(shown,0);assert.equal(s.latest()!.status,'paused');assert.equal(s.latest()!.error_uid,'1');assert.equal(s.progress(id).videos,0);assert.equal(s.nextVideos(id)?.user.uid,'1');assert.equal(s.snapshot().rows[0].works_count,20);assert.equal(c.countdown,0);
  s.reviewDelta('100',{opened:['1'],select:{ids:['2'],value:true}});fail=false;await c.resume();await idle(c);assert.equal(calls,5);assert.equal(s.latest()!.status,'completed');assert.deepEqual(s.getReview().opened,['1']);assert.deepEqual(s.getReview().selected,['2']);
});
test('首次请求遇验证码也能等待五秒后继续',async t=>{
  const {store:s}=fixture(t);let captcha=true;const delays:number[]=[];
  const c=new Collector(s,fake({owner:async()=>{if(captcha)throw new CollectError('CAPTCHA','验证');return user('100')},challenge:async()=>captcha}),()=>{},async ms=>{delays.push(ms)});
  await c.start();assert.equal(c.state().run?.status,'waiting_verification');assert.equal(s.latest(),null);
  captcha=false;await c.resume(true);await idle(c);assert.deepEqual(delays.slice(0,5),[1000,1000,1000,1000,1000]);assert.equal(s.latest()?.status,'completed');
});
test('暂停和重启断点、切换账号拒绝继续原任务',async t=>{
  const f=fixture(t);let c:Collector;let owner=user('100'),calls:string[]=[],paused=false;
  const transport=fake({owner:async()=>owner,profile:async u=>{calls.push(u.uid);return profile(u)}});
  c=new Collector(f.store,transport,()=>{const r=f.store.latest();if(!paused&&r&&f.store.progress(r.id).completed===1&&c.busy){paused=true;c.pause()}},async()=>{});
  await c.start();await idle(c);assert.equal(f.store.latest()?.status,'paused');assert.deepEqual(calls,['1']);
  f.reopen();c=new Collector(f.store,transport,()=>{},async()=>{});owner=user('200');await c.resume();assert.match(f.store.latest()!.message,/更换/);assert.deepEqual(calls,['1']);
  owner=user('100');await c.resume();await idle(c);assert.deepEqual(calls,['1','2']);assert.equal(f.store.latest()?.status,'completed');
});
test('导出 HTML 安全嵌入、JSON 不含使用凭据及未知值仍为空',t=>{
  const {dir}=fixture(t),r=makeRow({...user('1'),nickname:'</script><script>alert(1)</script>'}),p=path.join(dir,'template.html');writeFileSync(p,'<script id="data" type="application/json">__DATA__</script>');
  const snap={summary:{account_uid:'100'},rows:[r]};const html=exportText(snap,'html',p);assert.equal(html.includes('<script>alert'),false);assert.ok(html.includes('\\u003c'));
  assert.equal(JSON.parse(exportText(snap,'json',p)).rows[0].works_count,null);
  assert.ok(exportText(snap,'md',p).includes('未知'));
});
test('暂停或补视频时间不会冒充指标刚更新',t=>{
 const {store:s}=fixture(t),r=s.createRun('100',1);s.addPage(r.id,[user('1')],{offset:1,max_time:0,pages:1},true);
 assert.equal(s.snapshot().summary.profiles_updated_at,null);
 s.saveRow(r.id,{...makeRow(user('1'),profile(user('1'))),checked_at:'2026-09-01T00:00:00.000Z'});s.saveVideos(r.id,'1',[],'unknown');s.update(r.id,{status:'paused'});
 const snap=s.snapshot();assert.equal(snap.summary.profiles_updated_at,'2026-09-01T00:00:00.000Z');assert.ok(snap.summary.videos_updated_at);
});
