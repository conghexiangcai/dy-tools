import test from 'node:test';import assert from 'node:assert/strict';import {EventEmitter} from 'node:events';
import {guardExternalLaunches,isWebNavigation} from '../navigation-guard';

test('客户端链接、intent 和未知协议不能作为网页导航，正常 HTTPS 保留',()=>{
 for(const url of ['bytedance://user/profile','douyin://','snssdk1128://user/profile','intent://user#Intent;scheme=bytedance;end','custom-client://open','file:///C:/Windows/notepad.exe','javascript:alert(1)','not-a-url'])assert.equal(isWebNavigation(url),false,url);
 for(const url of ['https://www.douyin.com/user/self','about:blank','blob:https://www.douyin.com/123','data:text/html,ok','app://local/index.html'])assert.equal(isWebNavigation(url),true,url);
});
test('所有新会话和窗口拒绝系统应用打开权限；主框架、子框架、重定向均拦截',()=>{
 const app=new EventEmitter();guardExternalLaunches(app as any);guardExternalLaunches(app as any);
 const session=()=>({request:null as any,check:null as any,setPermissionRequestHandler(fn:any){this.request=fn},setPermissionCheckHandler(fn:any){this.check=fn}});
 const first=session();app.emit('session-created',first);
 const second=session(),wc=Object.assign(new EventEmitter(),{session:second});app.emit('web-contents-created',{},wc);
 for(const ses of [first,second]){
  for(const permission of ['openExternal','unknown','notifications']){let result;ses.request(null,permission,(yes:boolean)=>result=yes,{externalURL:'bytedance://test'});assert.equal(result,false);assert.equal(ses.check(null,permission,'https://www.douyin.com'),false)}
  assert.equal(ses.check(null,'fullscreen','https://www.douyin.com'),true);
 }
 for(const name of ['will-navigate','will-frame-navigate','will-redirect']){let blocked=0;wc.emit(name,{url:'bytedance://test',preventDefault(){blocked++}});assert.equal(blocked,1);wc.emit(name,{url:'https://www.douyin.com/user/self',preventDefault(){blocked++}});assert.equal(blocked,1)}
 assert.equal(wc.listenerCount('will-frame-navigate'),1);
});
