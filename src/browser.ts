import {BrowserWindow,WebContentsView,session,WebContents} from 'electron';
import path from 'node:path';
import {Transport,SELF,FOLLOWING,PROFILE,POSTS,baseParams,pageRequest,checkPageResult,parseOwner,parseFollowing,parseFollowers,parseVideos,CollectError} from './transport';
import {User,cleanUser} from './domain';
import {parseAccountSearch} from './account-search';
import {LoginState} from './login-state';
import {protectNavigation} from './navigation-guard';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export const appURL='app://local/';
export function allowedRemote(url:string){try{const u=new URL(url);return u.protocol==='https:'&&['douyin.com','iesdouyin.com','bytedance.com','snssdk.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false}}
export class BrowserHost {
  window:BrowserWindow;tabs:{id:string;title:string;view:WebContentsView}[]=[];active='';onChange=()=>{};onContextChange=()=>{};revision=0;
  profileMeta:(sec:string)=>{nickname:string;is_private?:boolean|null}|undefined=()=>undefined;
  contextChanged(){this.revision++;this.onContextChange()}
  constructor(public mode:'collector'|'review',preload:string,private notify:(host:BrowserHost)=>void){
    this.window=new BrowserWindow({width:1160,height:820,minWidth:700,minHeight:500,show:false,title:mode==='collector'?'抖音登录与验证':'手动查看主页',autoHideMenuBar:true,webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true}});
    this.window.loadURL(appURL+'browser.html?mode='+mode);this.window.on('resize',()=>this.resize());
    this.window.on('close',e=>{if(!(this.window as any).__quitting){e.preventDefault();this.window.hide();}});
    this.window.webContents.on('did-finish-load',()=>this.notify(this));this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    this.window.webContents.on('will-navigate',e=>e.preventDefault());
  }
  get current(){return this.tabs.find(t=>t.id===this.active)?.view.webContents;}
  async add(url:string,title:string,id:string){
    if(!allowedRemote(url))throw Error('只支持打开抖音网页');const existing=this.tabs.find(t=>t.id===id);
    if(existing){this.select(id);this.show();return existing.view.webContents;}
    const view=new WebContentsView({webPreferences:{partition:'persist:douyin-login',contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
    this.tabs.push({id,title,view});this.window.contentView.addChildView(view);this.select(id);
    const wc=view.webContents;protectNavigation(wc);wc.setWindowOpenHandler(({url})=>{if(allowedRemote(url))void this.add(url,'抖音页面',String(Date.now())).catch(()=>{});return {action:'deny'};});
    wc.on('did-start-navigation',(_e,_url,_inPlace,isMain)=>{if(isMain){this.contextChanged();this.notify(this)}});
    wc.on('did-navigate-in-page',(_e,_url,isMain)=>{if(isMain){this.contextChanged();this.notify(this)}});
    wc.on('did-stop-loading',()=>this.notify(this));
    wc.on('will-navigate',(e,url)=>{if(!allowedRemote(url))e.preventDefault()});wc.on('will-redirect',(e,url)=>{if(!allowedRemote(url))e.preventDefault()});
    wc.on('page-title-updated',(_,title)=>{const t=this.tabs.find(t=>t.id===id);if(t)t.title=title.slice(0,80);this.notify(this)});
    wc.on('render-process-gone',()=>{this.onChange();});
    try{await wc.loadURL(url)}catch{if(wc.isDestroyed())throw Error('抖音窗口已关闭')}
    return wc;
  }
  select(id:string){if(!this.tabs.some(t=>t.id===id))return;if(this.active!==id)this.contextChanged();this.active=id;this.resize();this.notify(this);}
  closeTab(id:string){if(this.mode==='collector')return;const t=this.tabs.find(t=>t.id===id);if(!t)return;this.contextChanged();this.window.contentView.removeChildView(t.view);t.view.webContents.close();this.tabs=this.tabs.filter(x=>x!==t);if(this.active===id)this.active=this.tabs.at(-1)?.id||'';this.resize();this.notify(this);}
  resize(){const [width,height]=this.window.getContentSize();for(const t of this.tabs){t.view.setVisible(t.id===this.active);t.view.setBounds({x:0,y:92,width,height:Math.max(0,height-92)});}}
  show(){this.window.show();this.window.focus();}
  destroy(){(this.window as any).__quitting=true;for(const t of this.tabs)t.view.webContents.close();this.window.destroy();}
  state(){let profile:ReturnType<BrowserHost['profileMeta']>;try{const url=new URL(this.current?.getURL()||'');if(url.origin==='https://www.douyin.com'){const sec=url.pathname.match(/^\/user\/([\w-]+)\/?$/)?.[1];if(sec&&!this.current?.isLoadingMainFrame())profile=this.profileMeta(sec)}}catch{}return {mode:this.mode,active:this.active,tabs:this.tabs.map(t=>({id:t.id,title:t.title})),profile};}
}
export class DouyinTransport implements Transport {
  private searchAt=0;
  private queue:Promise<unknown>=Promise.resolve();
  exclusive<T>(fn:()=>Promise<T>):Promise<T>{const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next}
  constructor(public host:BrowserHost,public loginState?:LoginState){}
  async ensure(){let wc=this.host.tabs.find(t=>t.id==='collector')?.view.webContents;if(!wc||wc.isDestroyed())wc=await this.host.add('https://www.douyin.com/user/self?showTab=post','抖音登录与采集','collector');return wc;}
  show(){this.host.select('collector');this.host.show();}
  private async request(path:string,params:Record<string,string>={}){
    return this.exclusive(async()=>{
    const wc=await this.ensure();if(new URL(wc.getURL()).origin!=='https://www.douyin.com')await wc.loadURL('https://www.douyin.com/user/self?showTab=post');
    let result:any;try{result=await wc.executeJavaScript('('+pageRequest.toString()+')('+JSON.stringify(path)+','+JSON.stringify({...baseParams,...params})+')')}catch{throw new CollectError('NETWORK','抖音页面暂时无法读取')}
    try{return checkPageResult(result)}catch(e){this.loginState?.failure(e);throw e}
    });
  }
  async owner(){const read=async()=>{if(await this.challenge())throw new CollectError('CAPTCHA','需要先完成抖音验证');return parseOwner(await this.request(SELF))};return this.loginState?this.loginState.check(read):read();}
  async following(owner:User,offset:number,time:number){return parseFollowing(await this.request(FOLLOWING,{user_id:owner.uid,sec_user_id:owner.sec_uid,offset:String(offset),max_time:String(time),count:'20'}));}
  // Read-only candidate: accepted only after schema, identity and full-count checks.
  async followers(owner:User,offset:number,time:number){return parseFollowers(await this.request('/aweme/v1/web/user/follower/list/',{user_id:owner.uid,sec_user_id:owner.sec_uid,offset:String(offset),max_time:String(time),count:'20'}));}
  async profile(user:User){const data=await this.request(PROFILE,{sec_user_id:user.sec_uid});if(!data.user||String(data.user.uid)!==user.uid)throw new CollectError('SCHEMA','详情接口身份不匹配');return data.user;}
  async resolveSec(sec:string){const data=await this.request(PROFILE,{sec_user_id:sec});let u:User;try{u=cleanUser(data.user)}catch{throw new CollectError('SCHEMA','主页接口未返回完整账号身份')}if(u.sec_uid!==sec)throw new CollectError('IDENTITY','主页账号身份与输入不符');return u}
  async workAuthor(id:string){const d=await this.request('/aweme/v1/web/aweme/detail/',{aweme_id:id});if(d.aweme_detail?.aweme_id!==id)throw new CollectError('IDENTITY','作品失效或返回了其他作品，无法确认作者');let u:User;try{u=cleanUser(d.aweme_detail.author)}catch{throw new CollectError('SCHEMA','作品未返回可靠作者身份')}const p=await this.resolveSec(u.sec_uid);if(p.uid!==u.uid)throw new CollectError('IDENTITY','作品作者与主页身份不一致');return p}
  async searchUsers(keyword:string,offset=0,searchId?:string){
    if(offset&&(!searchId||!/^[A-Za-z0-9_-]{1,200}$/.test(searchId)))throw new CollectError('SCHEMA','搜索分页凭据缺失，请重新搜索');
    await delay(Math.max(0,1000-(Date.now()-this.searchAt)));this.searchAt=Date.now();
    return parseAccountSearch(await this.request('/aweme/v1/web/discover/search/',{search_channel:'aweme_user_web',keyword,search_source:'normal_search',query_correct_type:'1',is_filter_search:'0',from_group_id:'',disable_rs:'0',offset:String(offset),count:'10',need_filter_settings:offset?'0':'1',list_type:'single',pc_search_top_1_params:'{"enable_ai_search_top_1":1}',...(offset?{search_id:searchId!}:{}),pc_client_type:'2'}),offset);
  }
  async videos(user:User,cursor:number){
    const page=parseVideos(await this.request(POSTS,{sec_user_id:user.sec_uid,max_cursor:String(cursor),count:'20'}),user);
    if(!page.valid&&!page.videos.length&&await this.challenge(user))throw new CollectError('CAPTCHA','需要手动完成验证码');
    return page;
  }
  async challenge(target?:User,navigate=false){
    const wc=await this.ensure();const visible=async()=>{
      try{
        const top=await wc.executeJavaScript(`(()=>{const text=document.body?.innerText||'';return /请完成下列验证后继续|按住左边按钮拖动|拖动滑块完成拼图/.test(text)||[...document.querySelectorAll('iframe')].some(f=>{const r=f.getBoundingClientRect(),s=getComputedStyle(f);return r.width>80&&r.height>80&&s.display!=='none'&&s.visibility!=='hidden'&&/captcha|verifycenter|verify_center/i.test(f.src)})})()`);
        if(top)return true;
        for(const frame of wc.mainFrame.framesInSubtree){if(frame===wc.mainFrame)continue;try{if(await frame.executeJavaScript(`(()=>{const t=document.body?.innerText||'';return /请完成下列验证后继续|按住左边按钮拖动|拖动滑块完成拼图/.test(t)})()`))return true;}catch{}}
      }catch{}return false;
    };
    if(await visible())return true;
    if(navigate){try{await wc.loadURL(target?'https://www.douyin.com/user/'+target.sec_uid:'https://www.douyin.com/user/self?showTab=post');await delay(1500);}catch{}return visible();}
    return false;
  }
}
