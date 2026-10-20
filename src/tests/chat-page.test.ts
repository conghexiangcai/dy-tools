import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {chatPageRead} from '../chat-wire';
const group={id:'9223372036854775806',short_id:'9223372036854775806',name:'合成群',kind:'未知',conversation_type:2,inbox_type:0,expected:2};
function fixture(){
 let uid='100',fail=false,init=3;const model={id:group.id,shortId:group.short_id,type:2,inboxType:0,coreInfo:{name:group.name},version:{toString:()=> '1'},forceRefreshUnreadCount(){},participantCount:2};
 const sdk={get initResult(){return init},option:{get userId(){return uid}},getUserConversationList:async()=>({conversation:[model],hasMore:false,cursor:'0'}),getConversationParticipantsByPage:async({conversation,cursor}:any)=>{assert.equal(conversation,model);assert.equal(conversation.version.toString(),'1');conversation.forceRefreshUnreadCount();if(fail)throw new TypeError('broken component sessionid=secret https://bad.test/?token=hidden');return {participants:[{userId:cursor==='0'?'12':'13',secUid:'',alias:'群昵称',conversationId:group.id}],hasMore:cursor==='0',cursor:cursor==='0'?'1':'-1'}}};
 const req:any=()=>({o:()=>sdk});req.m={a:function(){return 'getImSdkInstance ImSdkInstance:null'}};
 const context=vm.createContext({'@pc-im/im:test':{}});context['@pc-im/im:test']=[];context['@pc-im/im:test'].push=(chunk:any)=>chunk[2](req);
 const read=(kind:string,cursor='0')=>vm.runInContext('('+chatPageRead.toString()+')('+JSON.stringify('100')+','+JSON.stringify(kind)+','+JSON.stringify(cursor)+','+JSON.stringify(group)+')',context);
 return {read,context,sdk,setInit:(v:number)=>init=v,setOwner:(v:string)=>uid=v,setFail:()=>fail=true};
}
test('群成员调用保留完整 SDK 对象；缓存仅存于原网页和账号',async()=>{
 const f=fixture();assert.equal((await f.read('members')).error,'IM_CONVERSATION_MISSING');const catalog=await f.read('catalog');assert.equal(catalog.groups[0].id,group.id);assert.equal(catalog.groups[0].version,undefined);
 assert.equal((await f.read('members')).members[0].uid,'12');assert.equal((await f.read('members','1')).members[0].uid,'13');
 vm.runInContext("delete globalThis[Symbol.for('douyin-review.chat-models.v1')]",f.context);assert.equal((await f.read('members','1')).error,'IM_CONVERSATION_MISSING');await f.read('catalog');assert.equal((await f.read('members','1')).members[0].uid,'13');
 f.setOwner('200');assert.equal((await f.read('members')).error,'ACCOUNT_CHANGED');
});
test('组件异常保留 message，同时不泄露凭据或 URL',async()=>{const f=fixture();await f.read('catalog');f.setFail();const r=await f.read('members');assert.equal(r.name,'TypeError');assert.match(r.message,/broken component/);assert.doesNotMatch(r.message,/secret|https:|hidden/)});
test('网页重载后等待 SDK 初始化，缺失响应不能伪装空名单',async()=>{const f=fixture();f.setInit(1);assert.equal((await f.read('ready')).error,'IM_NOT_READY');assert.equal((await f.read('catalog')).error,'IM_NOT_READY');f.setInit(3);assert.equal((await f.read('ready')).ready,true);f.sdk.getUserConversationList=async()=>undefined as any;assert.equal((await f.read('catalog')).error,'EMPTY')});
