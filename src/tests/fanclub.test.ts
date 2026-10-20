import test from 'node:test';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {fanInput,fanHonor,fanRelation,fanUser,fanExport,FanUser,FanAnchor,FanRun} from '../fanclub';
import {FanStore} from '../fanclub-store';import {FanService,FanWire,FanConnection} from '../fanclub-service';import {CollectError} from '../transport';import {losslessJSON} from '../groups';
import {lookupKind,accountKeyword,fanWebUser} from '../fanclub';import {parseAccountSearch} from '../account-search';
import {DouyinFanWire} from '../fanclub-wire';
const target:FanUser={uid:'9007199254740999',sec_uid:'MS4wLjABAAAA_TARGET_1',nickname:'合成用户<script>',account:'synthetic',avatar:'',profile_url:'https://www.douyin.com/user/MS4wLjABAAAA_TARGET_1'};
const anchor=(uid:string):FanAnchor=>({...target,uid,sec_uid:'MS4wLjABAAAA_ANCHOR_'+uid,nickname:'合成主播 '+uid,remark:'备注',selected:true});
const data=(a='7',over:any={})=>({status_code:0,data:{id_str:target.uid,sec_uid:target.sec_uid,nickname:target.nickname,display_id:target.account,pay_grade:{level:17,this_grade_min_diamond:1700,this_grade_max_diamond:2200},fans_club:{data:{anchor_id:a,level:12,user_fans_club_status:2,user_guard_status:1,guard_expired_time:1999999999,...over}}}});
async function idle(s:FanService){for(let n=0;n<200&&s.busy;n++)await new Promise(r=>setImmediate(r));assert.equal(s.busy,false)}
function setup(t:any){const db=new DatabaseSync(':memory:'),store=new FanStore(db);let owner='100',captcha=false;const calls:string[]=[];const cx:FanConnection={resolve:async()=>({user:target,data:data()}),assert:async()=>{},read:async p=>{calls.push(p.anchor_id||'profile');return data(p.anchor_id||'0')}};const wire:FanWire={connect:async o=>{assert.equal(o,'100');return cx},challenge:async()=>captcha,show:()=>{}};const waits:number[]=[];const service=new FanService(store,wire,()=>owner,()=>{},async ms=>{waits.push(ms)});t.after(()=>db.close());return {db,store,cx,wire,service,calls,waits,setOwner:(x:string)=>{owner=x},setCaptcha:(x:boolean)=>{captcha=x}}}
test('主页分享解析、明确内部 UID、大整数、禁止外部协议，支持作品链接',()=>{
 assert.deepEqual(fanInput('9007199254740999'),{kind:'uid',value:'9007199254740999'});assert.equal(fanInput(target.sec_uid).value,target.sec_uid);
 assert.equal(fanInput('看看主页 '+target.profile_url+' 复制打开').kind,'sec');assert.equal(fanInput('https://v.douyin.com/Abc123/').kind,'url');
 assert.equal(fanInput('https://www.iesdouyin.com/share/user/7/?sec_uid='+target.sec_uid).value,target.sec_uid);
 for(const x of ['bytedance://abc','https://evil.example/user/'+target.sec_uid,'https://user:pass@v.douyin.com/abc/','https://www.douyin.com:8443/user/'+target.sec_uid])assert.throws(()=>fanInput(x));
 const u=losslessJSON('{"status_code":0,"data":{"id":9007199254740999,"sec_uid":"'+target.sec_uid+'","nickname":"test"}}');assert.equal(fanUser(u).uid,target.uid);
 assert.throws(()=>fanUser(data(),{uid:'8'}),/目标账号/);
});
test('等级估算严格校验，缺失或占位不能显示消费为零',()=>{
 assert.deepEqual(fanHonor(data()),{level:17,diamond_min:1700,diamond_max:2200});
 for(const p of [null,{}, {level:17,this_grade_min_diamond:0,this_grade_max_diamond:0},{level:17,this_grade_min_diamond:2200,this_grade_max_diamond:1700},{level:17,this_grade_min_diamond:null,this_grade_max_diamond:2200}])assert.equal(fanHonor({data:{pay_grade:p}}).diamond_min,null);
});
test('灯牌与主播匹配，0 是未知，未核验会员不冒充已开通',()=>{
 const r=fanRelation(data(),target,anchor('7'));assert.equal(r.state,'ok');assert.equal(r.level,12);assert.equal(r.badge,'inactive');assert.equal(r.guard,'unknown');assert.equal(r.guard_expires_at,null);
 assert.equal(fanRelation(data('7',{user_fans_club_status:1}),target,anchor('7')).badge,'active');
 assert.equal(fanRelation(data('0',{level:0,user_fans_club_status:0}),target,anchor('7')).state,'unknown');
 assert.equal(fanRelation(data('7',{level:null}),target,anchor('7')).level,null);assert.throws(()=>fanRelation(data('8'),target,anchor('7')),/主播身份/);
});
test('主播去重、备注和选择保留；跨账号与使用记录隔离',t=>{const f=setup(t);f.db.exec("CREATE TABLE review(owner_uid TEXT,selected TEXT,opened TEXT);INSERT INTO review VALUES('100','keep-selected','keep-opened');");f.store.add('100',anchor('7'));f.store.edit('100','7',{selected:false,remark:'新备注'});f.store.add('100',{...anchor('7'),nickname:'改名'});assert.equal(f.store.anchors('100').length,1);assert.equal(f.store.anchors('100')[0].selected,false);assert.equal(f.store.anchors('100')[0].remark,'新备注');assert.deepEqual(f.store.anchors('200'),[]);f.store.remove('200','7');assert.equal(f.store.anchors('100').length,1);assert.equal((f.db.prepare('SELECT opened FROM review').get() as any).opened,'keep-opened')});
test('完整查询、快照固定、导出保护与 HTML 搜索',async t=>{const f=setup(t);f.store.add('100',anchor('7'));await f.service.resolve(target.uid);await f.service.start();await idle(f.service);const r=f.store.latest('100')!;assert.equal(r.status,'completed');assert.equal(r.results.length,1);assert.equal(r.honor.diamond_min,1700);f.store.remove('100','7');assert.equal(f.store.latest('100')!.anchors.length,1);const h=fanExport(r,'html');assert.ok(h.includes('&lt;script&gt;'));assert.ok(!h.includes('合成用户<script>'));assert.ok(h.includes('按等级估算'));assert.ok(h.includes('tbody tr'));assert.equal(JSON.parse(fanExport(r,'json')).results[0].guard,'unknown');assert.ok(fanExport(r,'md').includes('仅查询本次'));r.target.is_private=true;assert.ok(fanExport(r,'html').includes('私密账号'));assert.ok(fanExport(r,'md').includes('私密账号'))});
test('网络两次重试、连续三项失败暂停，继续仅查询未完成项',async t=>{const f=setup(t);for(const id of ['7','8','9','10'])f.store.add('100',anchor(id));await f.service.resolve(target.uid);const read=f.cx.read;f.cx.read=async p=>{if(p.anchor_id){f.calls.push(p.anchor_id);throw new CollectError('EMPTY','空响应')}return read(p)};await f.service.start();await idle(f.service);let r=f.store.latest('100')!;assert.equal(r.status,'paused');assert.equal(r.results.length,3);assert.equal(f.calls.filter(x=>x!=='profile').length,9);assert.ok(r.results.every(x=>x.state==='failed'&&x.level===null));f.cx.read=read;await f.service.resume();await idle(f.service);assert.equal(f.store.latest('100')!.results.length,4);await f.service.resume(false,true);await idle(f.service);r=f.store.latest('100')!;assert.ok(r.results.every(x=>x.state==='ok'));});
test('验证码确认后严格等待五秒，未解除不继续请求',async t=>{const f=setup(t);f.store.add('100',anchor('7'));await f.service.resolve(target.uid);const read=f.cx.read;f.cx.read=async p=>{if(p.anchor_id)throw new CollectError('CAPTCHA','验证');return read(p)};await f.service.start();await idle(f.service);assert.equal(f.store.latest('100')!.status,'waiting_verification');f.setCaptcha(true);let before=f.calls.length;f.waits.length=0;await f.service.resume(true);await idle(f.service);assert.deepEqual(f.waits,[1000,1000,1000,1000,1000]);assert.equal(f.calls.length,before);assert.equal(f.store.latest('100')!.status,'waiting_verification');f.setCaptcha(false);f.cx.read=read;await f.service.resume(true);await idle(f.service);assert.equal(f.store.latest('100')!.status,'completed')});
test('切换账号和暂停丢弃在途响应，重启从未完成项恢复',async t=>{const f=setup(t);f.store.add('100',anchor('7'));await f.service.resolve(target.uid);let release!:()=>void;const pending=new Promise<void>(r=>release=r);const read=f.cx.read;f.cx.read=async p=>{if(p.anchor_id)await pending;return read(p)};await f.service.start();for(let n=0;n<20&&!f.store.latest('100')!.message.includes('合成主播');n++)await new Promise(r=>setImmediate(r));f.setOwner('200');release();await idle(f.service);assert.equal(f.store.latest('100')!.results.length,0);assert.equal(f.store.latest('200'),null);const r=f.store.latest('100')!;r.status='running';f.store.save(r);const reopened=new FanStore(f.db);assert.equal(reopened.latest('100')!.status,'paused');f.setOwner('100');f.cx.read=read;await f.service.resume();await idle(f.service);assert.equal(f.store.latest('100')!.results.length,1)});
test('首次识别账号遇到验证仍能确认后等待五秒重试，失败不复用旧目标',async t=>{
 const f=setup(t);await f.service.resolve(target.uid);const resolve=f.cx.resolve;let calls=0;f.cx.resolve=async()=>{calls++;throw new CollectError('CAPTCHA','需要验证')};
 await assert.rejects(f.service.resolve('8'),/需要验证/);assert.equal(f.service.state().target,null);assert.equal(f.service.state().pending?.status,'waiting_verification');assert.equal(f.service.state().run,null);
 f.setCaptcha(true);f.waits.length=0;await assert.rejects(f.service.resume(true),/验证尚未完成/);assert.equal(calls,1);assert.deepEqual(f.waits,[1000,1000,1000,1000,1000]);
 f.setCaptcha(false);f.cx.resolve=resolve;f.waits.length=0;await f.service.resume(true);assert.equal(f.service.state().target?.uid,target.uid);assert.equal(f.service.state().pending,null);assert.deepEqual(f.waits,[1000,1000,1000,1000,1000]);
});
test('识别中暂停不写入主播列表；验证码续传不能跨登录账号',async t=>{
 const f=setup(t);let release!:()=>void;const blocked=new Promise<void>(r=>release=r);f.cx.resolve=async()=>{await blocked;return {user:target,data:data()}};
 const resolving=f.service.resolve(target.uid,true);await new Promise(r=>setImmediate(r));f.service.pause();release();await assert.rejects(resolving,/已暂停/);assert.equal(f.store.anchors('100').length,0);
 f.cx.resolve=async()=>{throw new CollectError('CAPTCHA','验证')};await assert.rejects(f.service.resolve(target.uid,true),/验证/);f.setOwner('200');assert.equal(f.service.state().pending,null);await assert.rejects(f.service.resume(true),/另一个登录账号/);assert.equal(f.store.anchors('200').length,0);
});
test('抖音号默认包含纯数字，内部 UID 必须明确选择；私密状态不猜测',()=>{
 assert.equal(lookupKind('123456','auto'),'account');assert.equal(lookupKind('123456','uid'),'profile');assert.throws(()=>lookupKind('test','uid'));
 assert.equal(lookupKind(target.sec_uid,'auto'),'profile');assert.equal(lookupKind('主页 '+target.profile_url,'auto'),'profile');
 assert.equal(accountKeyword(' 抖音号：@test_1 '),'test_1');for(const s of ['https://evil.example','a b','',null])assert.throws(()=>accountKeyword(s));
 for(const [secret,value] of [[1,true],[0,false],[undefined,null],[9,null]] as const)assert.equal(fanWebUser({...target,secret}).is_private,value);
});
test('用户搜索大 ID、去重、分页、未知私密状态及错误结构',()=>{
 const u={uid:target.uid,sec_uid:target.sec_uid,nickname:'合成用户',unique_id:'test_1',secret:1};
 const p=parseAccountSearch({user_list:[{user_info:u},{user_info:u}],has_more:1,cursor:10,search_id:'search-page-1'});assert.equal(p.users.length,1);assert.equal(p.users[0].uid,target.uid);assert.equal(p.users[0].is_private,true);assert.equal(p.cursor,10);assert.equal(p.search_id,'search-page-1');
 assert.deepEqual(parseAccountSearch({user_list:[],has_more:0,cursor:10},10),{users:[],cursor:10,more:false});
 for(const d of [{user_list:null},{user_list:[],has_more:1,cursor:0},{user_list:[],has_more:'1'},{user_list:[{user_info:{...u,uid:9007199254740999}}],has_more:0}])assert.throws(()=>parseAccountSearch(d));
});
test('搜索候选必须选择；分页去重、输入绑定和账号切换隔离',async t=>{
 const f=setup(t);f.cx.search=async(_q,c,id)=>{if(c)assert.equal(id,'search-page-1');return {users:c?[target,anchor('2')]:[target],cursor:c?20:10,more:!c,search_id:c?'search-page-2':'search-page-1'}};
 let s=await f.service.search('test_1');assert.equal(f.service.state().target,null);assert.equal(f.store.anchors('100').length,0);await assert.rejects(f.service.start(),/目标账号/);
 await assert.rejects(f.service.choose(s.token,target.uid,'changed'),/搜索条件/);s=await f.service.more(s.token);assert.equal(s.users.length,2);
 await f.service.choose(s.token,target.uid,'test_1');assert.equal(f.service.state().targetInput,'test_1');assert.equal(f.service.state().targetMode,'auto');assert.equal(f.service.state().target?.uid,target.uid);
 s=await f.service.search('1234',true);f.setOwner('200');await assert.rejects(f.service.choose(s.token,target.uid,'1234'),/搜索条件/);assert.equal(f.store.anchors('200').length,0);
});
test('搜索身份不符拒绝落库，验证码搜索五秒后恢复',async t=>{
 const f=setup(t);let fail=true;f.cx.search=async()=>{if(fail)throw new CollectError('CAPTCHA','搜索验证');return {users:[anchor('2')],cursor:1,more:false}};
 await assert.rejects(f.service.search('test_2',true),/验证/);assert.equal(f.service.state().pending?.status,'waiting_verification');fail=false;await f.service.resume(true);assert.deepEqual(f.waits,[1000,1000,1000,1000,1000]);const s=f.service.state().search!;
 await assert.rejects(f.service.choose(s.token,'2','test_2'),/搜索结果与主页/);assert.equal(f.store.anchors('100').length,0);
});
test('每个主播仅一次关系请求；空响应有限重试且不重新导航；限流停止',async t=>{
 const f=setup(t);f.store.add('100',anchor('7'));await f.service.resolve(target.uid);await f.service.start();await idle(f.service);assert.deepEqual(f.calls,['7']);assert.deepEqual(f.waits,[]);
 let n=0;const navigations:(boolean|undefined)[]=[];f.wire.challenge=async(_u,navigate)=>{navigations.push(navigate);return false};f.cx.read=async()=>{n++;throw new CollectError('EMPTY','空内容')};await f.service.start();await idle(f.service);assert.equal(n,3);assert.deepEqual(f.waits,[2000,4000]);assert.ok(navigations.every(x=>x===false));assert.equal(f.store.latest('100')!.results[0].state,'failed');
 f.cx.read=async()=>{throw new CollectError('RATE_LIMIT','限流')};f.waits.length=0;await f.service.start();await idle(f.service);assert.equal(f.store.latest('100')!.status,'error');assert.equal(f.store.latest('100')!.results.length,0);assert.deepEqual(f.waits,[]);
});
test('连接短期复用身份校验，主页识别不请求粉丝团；会话变化拒绝旧连接',async()=>{
 let identity='synthetic-session',ownerCalls=0,apiCalls=0,profileCalls=0;const session={cookies:{get:async()=>[{name:'sessionid',value:identity}]},fetch:async()=>{apiCalls++;return new Response('')}};
 const transport={owner:async()=>{ownerCalls++;return {uid:'100'}},resolveSec:async()=>{profileCalls++;return {...target,secret:1}},exclusive:async(fn:()=>Promise<any>)=>fn()};
 const wire=new DouyinFanWire(session as any,transport as any),cx=await wire.connect('100');await wire.connect('100');assert.equal(ownerCalls,1);
 const u=await cx.resolve(target.sec_uid);assert.equal(u.user.is_private,true);assert.equal(u.data,null);assert.equal(profileCalls,1);assert.equal(apiCalls,0);
 identity='changed-session';await assert.rejects(cx.read({target_uid:target.uid}),/会话已变化/);assert.equal(apiCalls,0);await wire.connect('100');assert.equal(ownerCalls,2);
});
test('主播识别预览不立即写入，确认绑定原输入且保留查询目标',async t=>{const f=setup(t);await f.service.resolve(target.uid);await f.service.resolve('7','preview');assert.equal(f.store.anchors('100').length,0);assert.equal(f.service.state().target?.uid,target.uid);assert.throws(()=>f.service.commitAnchor('8'),/输入或账号/);f.service.commitAnchor('7');assert.equal(f.store.anchors('100').length,1);assert.equal(f.service.state().anchorPreview,null)});
