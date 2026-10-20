import test from 'node:test';import assert from 'node:assert/strict';
import {LoginState} from '../login-state';import {CollectError} from '../transport';
const user={uid:'100',sec_uid:'MS4wLjABAAAA_TEST',nickname:'合成账号'};
test('在线状态独立于缓存；登录核验合并，账号与显示同时更新',async()=>{
 let calls=0,activated:string[]=[];const s=new LoginState(()=>{},u=>activated.push(u.uid));assert.equal(s.state().status,'unverified');
 const read=async()=>{calls++;return user};await Promise.all([s.check(read),s.check(read)]);assert.equal(calls,1);assert.equal(s.state().status,'connected');assert.equal(s.state().owner?.nickname,user.nickname);assert.ok(s.state().checked_at);assert.deepEqual(activated,['100']);
 await s.check(async()=>({...user,uid:'200'}));assert.equal(s.state().owner?.uid,'200');assert.deepEqual(activated,['100','200']);
});
test('会话变更后迟到身份不得激活；失效、验证码和网络分别显示',async()=>{
 let resolve!:(u:typeof user)=>void,activated=0;const s=new LoginState(()=>{},()=>activated++);
 const pending=s.check(()=>new Promise(r=>resolve=r));s.invalidate();resolve(user);await assert.rejects(pending,/会话变化/);assert.equal(activated,0);assert.equal(s.state().owner,null);
 await s.check(async()=>user);s.failure(new CollectError('CAPTCHA','验证'));assert.equal(s.state().status,'verification_required');await s.check(async()=>user);
 await assert.rejects(s.check(async()=>{throw new CollectError('NETWORK','网络')}));assert.equal(s.state().status,'connected');
 s.failure(new CollectError('LOGIN','失效'));assert.equal(s.state().status,'expired');assert.equal(s.state().owner,null);
 await assert.rejects(s.check(async()=>{throw new CollectError('NETWORK','网络')}));assert.equal(s.state().status,'unverified');
});
