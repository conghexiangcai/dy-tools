import test from 'node:test';import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';import {DatabaseSync} from 'node:sqlite';
import {CheckinAlerts,CheckinMailStore,defaultMailSettings,failureMail,mailAuth,mailContent,mailSettings,MailError,sendQQMail} from '../checkin-mail';
import {CheckinRun,CheckinError} from '../checkin-domain';import {CheckinService} from '../checkin-service';import {CheckinStore} from '../checkin-store';
import {defaultCheckinSchedule} from '../checkin-schedule';
import {loadMailAuth,loadCheckinConfig} from '../checkin-cli';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const auth={from:'synthetic@qq.com',auth_code:'synthetic-secret'},to=['receiver@example.com'],message={id:'synthetic-message',subject:'合成邮件测试',body:'合成内容\n第二行'};
const config=()=>mailSettings({...defaultMailSettings,enabled:true,from:auth.from,to});
const run=():CheckinRun=>({id:'r1',owner:'100',mode:'sign',status:'waiting_login',error_code:'LOGIN',phase:'list',offset:0,cursor:0,page_fingerprints:[],items:[],day:'2026-10-18',created_at:'',updated_at:'',message:'sessionid=not-for-export'});
class SMTP extends EventEmitter {
 commands:string[]=[];step=0;body='';destroyed=false;
 constructor(private mode='ok'){super();queueMicrotask(()=>this.emit('data','220 smtp synthetic\r\n'))}
 setEncoding(){} end(){} destroy(){if(!this.destroyed){this.destroyed=true;this.emit('close')}}
 write(s:string){this.commands.push(s);let response='';const step=this.step++;
  if(step===0)response='250-synthetic\r\n250-AUTH LOGIN PLAIN\r\n250 SIZE 100000\r\n';
  else if(step<3)response='334 prompt\r\n';else if(step===3)response=this.mode==='auth'?'535 secret must not leak\r\n':'235 ok\r\n';else if(step<6)response='250 ok\r\n';else if(step===6)response='354 data\r\n';else {this.body=s;if(this.mode==='drop'){this.destroy();return}if(this.mode==='timeout')return;response=this.mode==='reject'?'550 rejected secret\r\n':'250 accepted\r\n'}
  this.emit('data',response.slice(0,3));this.emit('data',response.slice(3));
 }
}
test('QQ configuration validates addresses, rejects injection and stays disabled by default',()=>{
 assert.equal(mailSettings(null).enabled,false);assert.throws(()=>mailSettings({...config(),from:'x@example.com'}));assert.throws(()=>mailSettings({...config(),to:['x@example.com\r\nBcc: evil@example.com']}));assert.throws(()=>mailSettings({...config(),to:[]}));assert.throws(()=>mailSettings({...config(),cooldown_minutes:1}));assert.throws(()=>mailAuth({version:1,...auth},'other@qq.com'));
 const mime=mailContent(auth,to,message);assert.ok(mime.includes('Content-Transfer-Encoding: base64'));assert.ok(mime.includes(Buffer.from(message.body).toString('base64')));assert.ok(!mime.includes(auth.auth_code));assert.throws(()=>mailContent(auth,to,{...message,subject:'Hi\r\nBcc: x@example.com'}));
});
test('SMTP handles fragmented multiline replies, LOGIN and positive post-DATA acknowledgement',async()=>{
 const socket=new SMTP();await sendQQMail(auth,to,message,{connect:()=>socket as any});assert.equal(socket.commands[1],'AUTH LOGIN\r\n');assert.equal(socket.commands[3],Buffer.from(auth.auth_code).toString('base64')+'\r\n');assert.ok(socket.body.endsWith('\r\n.\r\n'));assert.ok(socket.destroyed);
});
test('SMTP distinguishes auth/rejected delivery from uncertain timeout/disconnect without leaking response',async()=>{
 for(const mode of ['auth','reject','drop','timeout']){const socket=new SMTP(mode);await assert.rejects(sendQQMail(auth,to,message,{connect:()=>socket as any,timeoutMs:20}),e=>{assert.ok(e instanceof MailError);assert.equal(e.uncertain,['drop','timeout'].includes(mode));assert.ok(!e.message.includes('secret'));return true})}
});
test('failure summaries exclude manual pause/inspect/unsupported, redact raw messages and separate days',()=>{
 const r=run(),c=config();assert.ok(failureMail(r,c));assert.ok(!failureMail(r,c)!.body.includes('not-for-export'));for(const code of ['PAUSED','ACCOUNT_CHANGED'])assert.equal(failureMail({...r,error_code:code},c),null);assert.equal(failureMail({...r,mode:'inspect'},c),null);assert.equal(failureMail({...r,status:'completed'},c),null);
 const item={club:{key:'uid:1',name:'sample'},state:'unsupported'} as any;assert.equal(failureMail({...r,status:'completed',items:[item]},c),null);assert.ok(failureMail({...r,status:'completed',items:[item]},{...c,include_unavailable:true}));assert.notEqual(failureMail(r,c)!.key,failureMail({...r,day:'2026-10-19'},c)!.key);
});
test('alerts persist dedup, isolate owners, allow cooldown retry and skip ambiguous delivery',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let now=100000,sends=0,uncertain=false;const store=new CheckinMailStore(db);store.saveSettings('100',config());assert.equal(store.settings('200').enabled,false);
 const build=()=>new CheckinAlerts(new CheckinMailStore(db),()=>config(),async()=>auth,async()=>{sends++;if(uncertain)throw new MailError('TIMEOUT','未知',true)},()=>{},()=>now);let alerts=build();await alerts.report(run());await alerts.report(run());assert.equal(sends,1);alerts=build();await alerts.report(run());assert.equal(sends,1);now+=61*60000;await alerts.report(run());assert.equal(sends,2);
 uncertain=true;now+=61*60000;await alerts.report(run());assert.equal(store.latest('100')!.state,'unknown');now+=2*86400000;await alerts.report(run());assert.equal(sends,3);assert.equal(store.latest('200'),null);
});
test('disabled alerts never load auth; failed mail does not discard check-in record; concurrent reports claim once',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=new CheckinMailStore(db);let calls=0;const disabled=new CheckinAlerts(store,()=>defaultMailSettings,async()=>{throw Error('must not load')});await disabled.report(run());assert.equal(store.latest('100'),null);
 const alerts=new CheckinAlerts(store,()=>config(),async()=>auth,async()=>{calls++;await new Promise(r=>setImmediate(r));throw new MailError('AUTH','授权码失效')});await Promise.all([alerts.report(run()),alerts.report(run())]);assert.equal(calls,1);assert.equal(store.latest('100')!.state,'failed');assert.equal(run().status,'waiting_login');
});
test('test mail is a separate explicit message and bypasses automatic toggle only for that request',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());let body='';const alerts=new CheckinAlerts(new CheckinMailStore(db),()=>({...config(),enabled:false}),async()=>auth,async(_a,_t,m)=>{body=m.body});await alerts.test('100');assert.match(body,/没有执行粉丝团签到/);assert.equal(alerts.store.latest('100')!.state,'sent');
});
test('CLI reads mail config relative to file and hot replacement/environment without Douyin credentials',t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'mail-config-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'mail.json');writeFileSync(file,JSON.stringify({version:1,...auth}));assert.deepEqual(loadMailAuth(file,auth.from),auth);writeFileSync(file,JSON.stringify({version:1,...auth,auth_code:'replacement-secret'}));assert.equal(loadMailAuth(file,auth.from).auth_code,'replacement-secret');
 process.env.SYNTHETIC_MAIL_AUTH='environment-secret';t.after(()=>delete process.env.SYNTHETIC_MAIL_AUTH);writeFileSync(file,JSON.stringify({version:1,from:auth.from,auth_code_env:'SYNTHETIC_MAIL_AUTH'}));assert.equal(loadMailAuth(file,auth.from).auth_code,'environment-secret');assert.throws(()=>loadMailAuth(file,'other@qq.com'),e=>!String(e).includes('environment-secret'));
 const cf=path.join(dir,'config.json');writeFileSync(cf,JSON.stringify({version:1,credentials_file:'missing.json',data_file:'data.db',schedule:defaultCheckinSchedule,email:{...config(),credentials_file:'mail.json'}}));assert.equal(loadCheckinConfig(cf).mailCredentials,file);
});
test('service reports terminal failure and survives notification failure without a sign request',async t=>{
 const store=new CheckinStore(':memory:');t.after(()=>store.close());let observed:CheckinRun|undefined;
 const service=new CheckinService(store,{connect:async()=>{throw new CheckinError('LOGIN','请登录')}},()=> '100',()=>{},{finished:async r=>{observed=structuredClone(r);throw Error('simulated mail unavailable')}});await service.start();await service.wait();assert.equal(observed!.error_code,'LOGIN');assert.equal(store.latest('100')!.status,'waiting_login');assert.equal(service.busy,false);
});
