import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Collector,emptyRetrySeconds} from '../collector';
import {Store} from '../store';
import {User,makeRow} from '../domain';
import {CollectError,Transport,pageRequest,checkPageResult,parseFollowing,parseVideos} from '../transport';

const user=(uid:string):User=>({uid,sec_uid:'MS4wLjABAAAA'+uid,nickname:'合成账号 '+uid,secret:0});
const emptyVideo={videos:[],more:false,cursor:0,valid:true};
const fake=(overrides:Partial<Transport>={}):Transport=>({owner:async()=>({...user('100'),following_count:2}),following:async()=>({users:[user('1'),user('2')],more:false,min_time:0}),profile:async u=>({...u,aweme_count:0}),videos:async()=>emptyVideo,challenge:async()=>false,show:()=>{},...overrides});
function fixture(t:any){const dir=mkdtempSync(path.join(os.tmpdir(),'dy-retry-'));let s=new Store(path.join(dir,'db.sqlite'));s.activate('100');t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true})});return {get s(){return s},reopen(){s.close();s=new Store(path.join(dir,'db.sqlite'));return s}}}
async function idle(c:Collector){for(let i=0;i<1000&&c.busy;i++)await new Promise(r=>setTimeout(r,1));assert.equal(c.busy,false)}
function baseline(s:Store){const r=s.createRun('100',1);s.addPage(r.id,[user('9')],{offset:1,max_time:0,pages:1},true);s.saveRow(r.id,makeRow(user('9'),{...user('9'),aweme_count:0}));s.saveVideos(r.id,'9',[],'empty');s.update(r.id,{status:'completed'});s.reviewDelta('100',{select:{ids:['9'],value:true},opened:['9'],settings:{fans:'88'}});return r}

test('退避从三十秒递增至五分钟；持续空响应不会因次数用完而停止',async t=>{
 const {s}=fixture(t);let calls=0,owners=0;const rounds:number[]=[],ticks:number[]=[];
 assert.deepEqual([1,2,3,4,5,6].map(emptyRetrySeconds),[30,60,120,300,300,300]);
 const c=new Collector(s,fake({owner:async()=>{owners++;return {...user('100'),following_count:2}},following:async()=>{if(++calls<=6)throw new CollectError('EMPTY','空响应');return {users:[user('1'),user('2')],more:false,min_time:0}}}),()=>{},async ms=>{const retry=c.state().retry;if(retry){if(c.countdown===retry.seconds)rounds.push(retry.seconds);ticks.push(ms)}});
 await c.start();await idle(c);assert.equal(calls,7);assert.equal(owners,7);assert.deepEqual(rounds,[30,60,120,300,300,300]);assert.equal(ticks.reduce((a,b)=>a+b,0),1110000);assert.equal(s.latest()?.status,'completed');assert.equal(c.state().retry,null);assert.equal(c.countdown,0);
});

test('空末页与人数冲突时重试同一分页；保留上次完整名单和并发使用记录',async t=>{
 const {s}=fixture(t);baseline(s);let empty=true,paused=false;const cursors:number[][]=[];
 const c=new Collector(s,fake({following:async(_owner,offset,time)=>{cursors.push([offset,time]);return offset===0?{users:[user('1')],more:true,min_time:55}:empty?{users:[],more:false,min_time:0}:{users:[user('2')],more:false,min_time:0}}}),()=>{if(!paused&&c.state().retry){paused=true;assert.deepEqual(s.snapshot().rows.map(r=>r.uid),['9']);s.reviewDelta('100',{select:{ids:['1'],value:true}});c.pause()}},async()=>{});
 await c.start();await idle(c);assert.equal(s.latest()?.offset,1);assert.equal(s.latest()?.max_time,55);assert.equal(s.latest()?.pages,1);assert.deepEqual(cursors,[[0,0],[1,55]]);assert.equal(s.latest()?.status,'paused');
 empty=false;await c.resume();await idle(c);assert.deepEqual(cursors,[[0,0],[1,55],[1,55]]);assert.deepEqual(s.snapshot().rows.map(r=>r.uid),['1','2']);assert.deepEqual(s.getReview().opened,['9']);assert.deepEqual(s.getReview().selected,['1','9']);assert.equal(s.getReview().settings.fans,'88');
});

test('新的空末页重新核验关注总数，真实零关注允许结束',async t=>{
 const {s}=fixture(t);let owners=0,calls=0;
 const c=new Collector(s,fake({owner:async()=>({...user('100'),following_count:++owners===1?2:0}),following:async()=>{calls++;return {users:[],more:false,min_time:0}}}),()=>{},async()=>{});
 await c.start();await idle(c);assert.equal(calls,2);assert.equal(owners,2);assert.equal(s.latest()?.status,'completed');assert.equal(s.snapshot().rows.length,0);
});

test('详情恢复后继续原账号，每个请求独立计算等待次数，不写零占位',async t=>{
 const {s}=fixture(t);const calls:string[]=[],rounds:number[]=[];const seen=new Set<string>();
 const c=new Collector(s,fake({profile:async u=>{calls.push(u.uid);if(!seen.has(u.uid)){seen.add(u.uid);throw new CollectError('EMPTY','空响应')}return {...u,aweme_count:7}}}),()=>{},async()=>{const retry=c.state().retry;if(retry&&c.countdown===retry.seconds){rounds.push(retry.attempt);assert.equal(s.snapshot().rows.find(r=>r.uid===s.latest()?.error_uid)?.works_count,null)}});
 await c.start();await idle(c);assert.deepEqual(calls,['1','1','2','2']);assert.deepEqual(rounds,[1,1]);assert.ok(s.snapshot().rows.every(r=>r.works_count===7));
});

test('HTTP 429 遵守服务端更长的 Retry-After，普通结构错误不自动循环',async t=>{
 const {s}=fixture(t);let calls=0,ticks=0;const navigated:boolean[]=[];
 const c=new Collector(s,fake({following:async()=>{if(++calls===1)throw new CollectError('HTTP_429','稍后重试',450);throw new CollectError('SCHEMA','分页字段变化')},challenge:async(_target,navigate)=>{navigated.push(!!navigate);return false}}),()=>{},async()=>{if(c.state().retry)ticks++});
 await c.start();await idle(c);assert.equal(ticks,450);assert.equal(calls,2);assert.ok(navigated.every(v=>!v));assert.equal(s.latest()?.status,'error');assert.equal(s.latest()?.message,'分页字段变化');
});

test('等待期间账号切换或登录失效后不重发原请求',async t=>{
 for(const mode of ['store-switch','identity-switch','expired']){const f=fixture(t),s=f.s;let changed=false,calls=0,owners=0;const c=new Collector(s,fake({owner:async()=>{owners++;if(owners===1)return {...user('100'),following_count:2};if(mode==='expired')throw new CollectError('LOGIN','登录失效');return user('200')},following:async()=>{calls++;throw new CollectError('EMPTY','空响应')}}),()=>{if(mode==='store-switch'&&!changed&&c.state().retry){changed=true;s.activate('200')}},async()=>{});
  await c.start();const original=s.owner()==='100'?s.latest()?.id:(s.db.prepare("SELECT id FROM runs WHERE owner_uid='100' ORDER BY started_at DESC LIMIT 1").get() as any)?.id;await idle(c);const r=s.run(original!)!;assert.equal(calls,1);assert.equal(r.status,mode==='expired'?'waiting_login':'error');assert.equal(r.offset,0);if(mode==='store-switch'){assert.equal(s.latest(),null);assert.equal(s.snapshot().rows.length,0)}
 }
});

test('倒计时结束发现验证码，等待人工确认且确认后仍等五秒',async t=>{
 const {s}=fixture(t);let captcha=false,calls=0,shown=0;const delays:number[]=[];
 const c=new Collector(s,fake({following:async()=>{if(++calls===1)throw new CollectError('EMPTY','空响应');return {users:[user('1'),user('2')],more:false,min_time:0}},challenge:async()=>captcha,show:()=>{shown++}}),()=>{},async ms=>{delays.push(ms);if(c.state().retry&&c.countdown===1)captcha=true});
 await c.start();await idle(c);assert.equal(s.latest()?.status,'waiting_verification');assert.equal(calls,1);assert.equal(shown,1);captcha=false;delays.length=0;await c.resume(true);await idle(c);assert.deepEqual(delays.slice(0,5),[1000,1000,1000,1000,1000]);assert.equal(calls,2);assert.equal(s.latest()?.status,'completed');
});

test('等待自动重试时关闭，重启只暂停恢复，不清空数据或自动执行',t=>{
 const f=fixture(t),s=f.s;baseline(s);const r=s.createRun('100',2);s.addPage(r.id,[user('1')],{offset:1,max_time:55,pages:1},false);s.update(r.id,{status:'retry_wait',message:'等待自动重试'});
 const reopened=f.reopen();assert.equal(reopened.latest()?.status,'paused');assert.equal(reopened.latest()?.offset,1);assert.equal(reopened.latest()?.max_time,55);assert.deepEqual(reopened.snapshot().rows.map(r=>r.uid),['9']);assert.deepEqual(reopened.getReview().opened,['9']);assert.deepEqual(reopened.getReview().selected,['9']);
});

test('首次本人请求也可自动重试或手动暂停，不提前创建或覆盖快照',async t=>{
 const {s}=fixture(t);baseline(s);let calls=0,paused=false;
 const c=new Collector(s,fake({owner:async()=>{if(++calls<3)throw new CollectError('EMPTY','空响应');return {...user('100'),following_count:2}}}),()=>{if(!paused&&c.state().retry){paused=true;c.pause()}},async()=>{});
 await c.start();assert.equal(c.state().run?.status,'paused');assert.equal(calls,1);assert.equal(s.latest()?.status,'completed');assert.deepEqual(s.snapshot().rows.map(r=>r.uid),['9']);await c.resume();await idle(c);assert.equal(calls,3);assert.equal(s.latest()?.status,'completed');
});

test('已核实的账号不可用作品列表仍保留未知，不陷入整批无限等待',()=>{
 assert.deepEqual(parseVideos({aweme_list:null},user('1')),{videos:[],more:false,cursor:0,valid:false});
 assert.throws(()=>parseFollowing(null),(e:any)=>e.code==='SCHEMA');assert.throws(()=>parseFollowing({followings:null,has_more:0}),(e:any)=>e.code==='EMPTY');
});

test('网页请求识别空数据与验证响应，保留 null 分页和 Retry-After',async()=>{
 const run=async(body:any,status=200,after:string|null=null)=>vm.runInNewContext('('+pageRequest.toString()+')("/test",{})',{AbortController,setTimeout,clearTimeout,URL,URLSearchParams,location:{origin:'https://www.douyin.com'},fetch:async()=>({ok:status===200,status,headers:{get:()=>after},text:async()=>typeof body==='string'?body:JSON.stringify(body)})});
 for(const body of ['',null,{},[],'<html>请稍后</html>'])assert.equal((await run(body)).error,'EMPTY');
 assert.equal((await run({status_code:0,verify_type:1})).error,'CAPTCHA');assert.equal((await run({status_code:0,followings:null,has_more:0})).followings,null);
 assert.throws(()=>checkPageResult({error:'HTTP_429',retryAfterSeconds:450}),(e:any)=>e.code==='HTTP_429'&&e.retryAfterSeconds===450);
 assert.equal((await run('',429,'450')).retryAfterSeconds,450);assert.equal((await run('',429,'invalid')).retryAfterSeconds,undefined);
});
