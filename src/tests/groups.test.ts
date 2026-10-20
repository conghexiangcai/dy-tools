import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';import path from 'node:path';
import {losslessJSON,readCatalog,readMembers,membershipDelta,deltaConfirmed,Group,GROUP_LIST,GROUP_USERS} from '../groups';
import {Store} from '../store';import {GroupService,GroupWire,GroupConnection} from '../group-service';import {CollectError} from '../transport';import {exportText} from '../export';import {matchesGroup} from '../domain';
const gs:Group[]=[{id:'9223372036854775806',name:'第一组',member_count:1},{id:'9223372036854775805',name:'第二组',member_count:0},{id:'3',name:'手机新加',member_count:0}];
const user={uid:'7',sec_uid:'MS4wLjABAAAA_TEST_7',nickname:'合成账号'};
function fixture(t:any){const dir=mkdtempSync(path.join(os.tmpdir(),'dy-groups-'));const dbfile=path.join(dir,'data.sqlite');let s=new Store(dbfile);s.activate('100');const r=s.createRun('100',2);s.addPage(r.id,[user,{...user,uid:'8',sec_uid:'MS4wLjABAAAA_TEST_8'}],{offset:2,max_time:0,pages:1},true);s.reviewDelta('100',{select:{ids:['7'],value:true},opened:['7'],settings:{fans:'99'}});t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true})});return {get s(){return s},reopen(){s.close();s=new Store(dbfile);return s}}}
function fake(store:Store,options:{timeout?:boolean;partial?:boolean;captcha?:boolean;valid?:()=>boolean}={}){
 let memberships=[gs[0].id],writes=0;const sends:{add:string[];del:string[]}[]=[];
 const cx:GroupConnection={read:async(p,q)=>{if(options.captcha)throw new CollectError('CAPTCHA','验证');if(p===GROUP_LIST)return {groups:gs,belong_groups:memberships,has_more:0,cursor:2,total:3};if(p===GROUP_USERS)return {user_list:q.group_id===gs[0].id?[user]:[],has_more:0,cursor:0,total:q.group_id===gs[0].id?1:0};throw Error('bad path')},write:async(_s,add,del,guard)=>{guard?.();writes++;sends.push({add,del});if(!options.partial)memberships=[...new Set([...memberships.filter(id=>!del.includes(id)),...add])];if(options.timeout)throw new CollectError('NETWORK','timeout')}};
 const wire:GroupWire={connect:async()=>cx,challenge:async()=>!!options.captcha,show:()=>{}};
 const service=new GroupService(store,wire,()=>{},async()=>{});return {service,get writes(){return writes},sends,set(ids:string[]){memberships=ids},options,cx};
}
test('大 ID 无损解析、完整分页、去重和未知结构拒绝',async()=>{
 const data=losslessJSON('{"groups":[{"id":9223372036854775806,"name":"3","member_count":2}],"belong_groups":[9223372036854775806],"total":1,"cursor":0,"has_more":0}');assert.equal(data.groups[0].id,'9223372036854775806');
 const c=await readCatalog(async()=>data,'sec');assert.equal(c.belong[0],c.groups[0].id);
 const pages:any[]=[{user_list:[{uid:'7'}],total:2,has_more:1,cursor:12},{user_list:[{uid:'7'},{uid:'8'}],total:2,has_more:0,cursor:20}];assert.deepEqual(await readMembers(async()=>pages.shift(),c.groups[0]),['7','8']);
 await assert.rejects(readMembers(async()=>({user_list:[user],total:2,has_more:1,cursor:0}),c.groups[0]),/推进/);
 await assert.rejects(readCatalog(async()=>({...data,total:2}),'sec'),/不完整/);
 await assert.rejects(readCatalog(async()=>({...data,belong_groups:null}),'sec'),/缺失/);
 const catPages=[{groups:[gs[0]],belong_groups:[gs[0].id],total:2,has_more:1,cursor:9},{groups:[gs[1]],belong_groups:[],total:2,has_more:0,cursor:10}];assert.equal((await readCatalog(async()=>catPages.shift(),'sec')).groups.length,2);
});
test('差量保护手机端并发新增与删除，不覆盖其他归属',()=>{
 assert.deepEqual(membershipDelta(['1'],['2'],['1','3'],['1','2','3']),{add:['2'],del:['1']});
 assert.deepEqual(membershipDelta(['1'],['1','2'],[],['1','2']),{add:['2'],del:[]});
 assert.deepEqual(membershipDelta(['1'],['1'],['1','3'],['1','3']),{add:[],del:[]});assert.ok(deltaConfirmed({add:['2'],del:['1']},['2','3']));
 assert.throws(()=>membershipDelta([],['99'],[],['1']),/删除/);
});
test('分组筛选按 ID 包含多组成员，未知与未分组不同',()=>{const r={groups:[{id:gs[0].id},{id:gs[1].id}],groups_status:'known'};assert.ok(matchesGroup(r,gs[0].id));assert.ok(matchesGroup(r,gs[1].id));assert.equal(matchesGroup(r,'3'),false);assert.ok(matchesGroup({groups:[],groups_status:'known'},'ungrouped'));assert.equal(matchesGroup({groups:[],groups_status:'unknown'},'ungrouped'),false);assert.ok(matchesGroup({groups:[],groups_status:'unknown'},'unknown'))});
test('分组完整成员包括关注快照之外的账号；移出分组后不残留',t=>{const f=fixture(t),extra={...user,uid:'99',sec_uid:'MS4wLjABAAAA_EXTRA_99'};f.s.groups.complete('100',gs,new Map([['7',[gs[0].id]],['99',[gs[1].id]]]),new Map([['99',extra]]));assert.deepEqual(f.s.snapshot().group_rows.map(r=>r.uid),['99']);assert.ok(f.s.profileTarget(extra.sec_uid));f.s.groups.complete('100',gs,new Map([['7',[gs[0].id]]]));assert.deepEqual(f.s.snapshot().group_rows,[]);assert.equal(f.s.snapshot().rows.length,2)});
test('完整同步、未知与未分组、重启缓存、失败保留、使用记录与导出隔离',async t=>{
 const f=fixture(t),m=fake(f.s);assert.equal(f.s.snapshot().rows[0].groups_status,'unknown');await m.service.refresh();const before=f.s.snapshot();assert.equal(before.rows[0].groups_status,'known');assert.deepEqual(before.rows[1].groups,[]);assert.equal(before.rows[1].groups_status,'known');
 f.s.groups.failed('100','网络中断');assert.equal(f.s.snapshot().rows[0].groups_stale,true);assert.deepEqual(f.s.getReview(),before.review);
 f.reopen();assert.deepEqual(f.s.snapshot().rows[0].groups,before.rows[0].groups);assert.equal(f.s.getReview().settings.fans,'99');
 f.s.importReview('100',{account_uid:'100',review:{selected:['8'],opened:[],groups:[]}});assert.deepEqual(f.s.snapshot().rows[0].groups,before.rows[0].groups);
 const md=exportText(f.s.snapshot(),'md','');assert.ok(md.includes('互关 | 所属分组 | 最新'));assert.ok(md.includes('第一组'));assert.ok(md.includes('未分组'));assert.ok(JSON.parse(exportText(f.s.snapshot(),'json','')).rows[0].groups[0].id===gs[0].id);
 f.s.activate('200');assert.equal(f.s.groups.state('200').checked_at,null);assert.equal(f.s.groups.rows('200').size,0);
});
test('无修改不写、手机同时添加保留、超时先回读不重复提交',async t=>{
 const f=fixture(t),m=fake(f.s,{timeout:true});const d=await m.service.open(user,()=>true);assert.ok(d);await m.service.save(d!.token,[gs[0].id]);assert.equal(m.writes,0);
 m.set([gs[0].id,'3']);const result=await m.service.save(d!.token,[gs[1].id]);assert.equal(result.confirmed,true);assert.equal(m.writes,1);assert.deepEqual(m.sends[0],{add:[gs[1].id],del:[gs[0].id]});assert.deepEqual(result.selected,['3',gs[1].id]);
});
test('部分成功回读实际值，不伪报成功或自动重试',async t=>{const f=fixture(t),m=fake(f.s,{partial:true});const d=await m.service.open(user,()=>true);const r=await m.service.save(d!.token,[gs[1].id]);assert.equal(r.confirmed,false);assert.deepEqual(r.selected,[gs[0].id]);assert.equal(m.writes,1)});
test('导航/切换账号取消旧弹窗，延迟返回不写入新账号',async t=>{const f=fixture(t),m=fake(f.s);let valid=true;const d=await m.service.open(user,()=>valid);valid=false;await assert.rejects(m.service.save(d!.token,[]),/切换/);assert.equal(m.writes,0);valid=true;f.s.activate('200');await assert.rejects(m.service.save(d!.token,[]),/切换/);assert.equal(m.writes,0)});
test('验证码明确确认后等待五秒，只重新读取、不重放写请求',async t=>{
 const f=fixture(t),m=fake(f.s,{captcha:true});await assert.rejects(m.service.open(user,()=>true),/验证/);assert.equal(m.service.waiting,true);m.options.captcha=false;const waits:number[]=[];const service=m.service as any;service.delay=async(ms:number)=>{waits.push(ms)};await m.service.verified();assert.deepEqual(waits,[1000,1000,1000,1000,1000]);assert.equal(m.service.waiting,false);assert.equal(m.writes,0);assert.ok(m.service.dialogState());
});
test('弹窗读取的延迟响应在切换标签后丢弃',async t=>{const f=fixture(t),m=fake(f.s),read=m.cx.read;let release!:()=>void;const wait=new Promise<void>(r=>release=r);m.cx.read=async(p,q)=>{await wait;return read(p,q)};const loading=m.service.open(user,()=>true);m.service.cancel();release();await assert.rejects(loading,/切换/);assert.equal(m.service.dialog,null);assert.equal(f.s.snapshot().rows[0].groups_status,'unknown');assert.equal(m.writes,0)});
test('提交超时且首次回读失败时，下一次保存先读实际归属，不重复写',async t=>{const f=fixture(t),m=fake(f.s,{timeout:true}),read=m.cx.read;const d=await m.service.open(user,()=>true);let fail=true;m.cx.read=async(p,q)=>{if(m.writes&&fail)throw new CollectError('NETWORK','回读失败');return read(p,q)};await assert.rejects(m.service.save(d!.token,[gs[1].id]),/timeout/);assert.equal(m.writes,1);fail=false;const next=await m.service.save(d!.token,[gs[1].id]);assert.equal(next.confirmed,true);assert.equal(m.writes,1)});
