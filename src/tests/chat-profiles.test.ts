import test from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {inspectChats,ChatSnapshot,member} from '../chat-domain';import {ChatStore} from '../chat-store';import {enrichChatMembers} from '../chat-profiles';import {FanConnection} from '../fanclub-service';import {CollectError} from '../transport';
import {chatWorkbook,readChatFile} from '../chat-files';import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';import os from 'node:os';import path from 'node:path';
const uid='9223372036854775806',sec='MS4wLjABAAAA_synthetic',m={uid,sec_uid:'',nickname:'',alias:''};
const snap=(id:string,person:any):ChatSnapshot=>({id,group:{id,name:id,kind:'未知',expected:1},source:'fixture',origin:'scan',collected_at:null,complete:true,reason:'',members:[person]});
const profile={uid,sec_uid:sec,nickname:'合成用户',account:'synthetic-account',avatar:'',profile_url:'https://www.douyin.com/user/'+sec};
test('duplicates and imports merge richer metadata from either side without changing source snapshots',()=>{
 const a=snap('a',m),b=snap('b',{...m,nickname:'昵称',account:'douyin-name',sec_uid:sec,alias:'群名片'});for(const kind of ['duplicates','compare'] as const){const r=kind==='duplicates'?inspectChats(kind,[a,b]):inspectChats(kind,[a],[b]);assert.equal(r.rows[0].nickname,'昵称');assert.equal(r.rows[0].account,'douyin-name');assert.equal(r.rows[0].groups.length,2)}assert.equal(a.members[0].nickname,'');assert.equal(member({uid,short_id:'0'})!.account,undefined);
});
test('member account survives Excel export/reimport, IDs remain text and older members stay compatible',async t=>{
 const dir=mkdtempSync(path.join(os.tmpdir(),'chat-profile-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'members.xlsx'),s=snap('g',{...m,nickname:'名字',account:'dy-account'});writeFileSync(file,await chatWorkbook([s]));assert.equal((await readChatFile(file)).payload!.snapshots[0].members[0].account,'dy-account');
});
test('profile enrichment retries bounded reads, saves each matched UID, skips complete rows and persists owner-isolated cache',async t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());const store=new ChatStore(db);let calls=0;const waits:number[]=[],cx:FanConnection={resolve:async raw=>{assert.equal(raw,uid);if(++calls<3)throw new CollectError('EMPTY','empty');return {user:profile,data:null}},assert:async()=>{},read:async()=>null};
 const result=await enrichChatMembers([m,{...m,uid:'12',nickname:'已知',account:'known'}],cx,{check:()=>{},save:v=>store.saveProfile('100',v),progress:()=>{},sleep:async ms=>{waits.push(ms)}});assert.equal(result.done,1);assert.equal(calls,3);assert.ok(waits.every(v=>v>=1000));assert.equal(new ChatStore(db).profiles('100').get(uid)!.account,'synthetic-account');assert.equal(store.profiles('200').size,0);
});
test('account switch, pause, mismatched identity and captcha never commit a late or wrong profile',async()=>{
 for(const code of ['ACCOUNT_CHANGED','PAUSED','IDENTITY','CAPTCHA']){let stopped=false,saved=0;const cx:FanConnection={resolve:async()=>{if(code==='CAPTCHA')throw new CollectError(code,'captcha');stopped=true;return {user:{...profile,uid:code==='IDENTITY'?'12':uid},data:null}},assert:async()=>{},read:async()=>null};await assert.rejects(enrichChatMembers([m],cx,{check:()=>{if(stopped&&code!=='IDENTITY')throw new CollectError(code,'stopped')},save:()=>{saved++},progress:()=>{},sleep:async()=>{}}));assert.equal(saved,0)}
});
test('three consecutive failed members pause; missing Douyin account stays unknown rather than copying UID',async()=>{
 let saved:any,calls=0;const cx:FanConnection={resolve:async()=>({user:{...profile,account:uid},data:null}),assert:async()=>{},read:async()=>null};await enrichChatMembers([m],cx,{check:()=>{},save:v=>saved=v,progress:()=>{},sleep:async()=>{}});assert.ok(!saved.account);
 cx.resolve=async()=>{calls++;throw new CollectError('EMPTY','empty')};await assert.rejects(enrichChatMembers(['1','2','3','4'].map(uid=>({...m,uid})),cx,{check:()=>{},save:()=>assert.fail(),progress:()=>{},sleep:async()=>{}}),/连续三个/);assert.equal(calls,9);
});
