import {BrowserWindow,WebContentsView,session,WebContents} from 'electron';
import path from 'node:path';
import {Transport,SELF,FOLLOWING,PROFILE,baseParams,pageRequest,checkPageResult,parseOwner,parseFollowing,CollectError} from './transport';
import {User} from './domain';
const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export const appURL='app://local/';
export function allowedRemote(url:string){try{const u=new URL(url);return u.protocol==='https:'&&['douyin.com','iesdouyin.com','bytedance.com','snssdk.com'].some(h=>u.hostname===h||u.hostname.endsWith('.'+h));}catch{return false}}
export class BrowserHost {
  window:BrowserWindow;tabs:{id:string;title:string;view:WebContentsView}[]=[];active='';onChange=()=>{};
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
    const wc=view.webContents;wc.setWindowOpenHandler(({url})=>{if(allowedRemote(url))void this.add(url,'抖音页面',String(Date.now())).catch(()=>{});return {action:'deny'};});
    wc.on('will-navigate',(e,url)=>{if(!allowedRemote(url))e.preventDefault()});wc.on('will-redirect',(e,url)=>{if(!allowedRemote(url))e.preventDefault()});
    wc.on('page-title-updated',(_,title)=>{const t=this.tabs.find(t=>t.id===id);if(t)t.title=title.slice(0,80);this.notify(this)});
    wc.on('render-process-gone',()=>{this.onChange();});
    try{await wc.loadURL(url)}catch{if(wc.isDestroyed())throw Error('抖音窗口已关闭')}
    return wc;
  }
  select(id:string){if(!this.tabs.some(t=>t.id===id))return;this.active=id;this.resize();this.notify(this);}
  closeTab(id:string){if(this.mode==='collector')return;const t=this.tabs.find(t=>t.id===id);if(!t)return;this.window.contentView.removeChildView(t.view);t.view.webContents.close();this.tabs=this.tabs.filter(x=>x!==t);if(this.active===id)this.active=this.tabs.at(-1)?.id||'';this.resize();this.notify(this);}
  resize(){const [width,height]=this.window.getContentSize();for(const t of this.tabs){t.view.setVisible(t.id===this.active);t.view.setBounds({x:0,y:92,width,height:Math.max(0,height-92)});}}
  show(){this.window.show();this.window.focus();}
  destroy(){(this.window as any).__quitting=true;for(const t of this.tabs)t.view.webContents.close();this.window.destroy();}
  state(){return {mode:this.mode,active:this.active,tabs:this.tabs.map(t=>({id:t.id,title:t.title}))};}
}
export class DouyinTransport implements Transport {
  constructor(public host:BrowserHost){}
  async ensure(){let wc=this.host.tabs.find(t=>t.id==='collector')?.view.webContents;if(!wc||wc.isDestroyed())wc=await this.host.add('https://www.douyin.com/user/self?showTab=post','抖音登录与采集','collector');return wc;}
  show(){this.host.select('collector');this.host.show();}
  private async request(path:string,params:Record<string,string>={}){
    const wc=await this.ensure();if(new URL(wc.getURL()).origin!=='https://www.douyin.com')await wc.loadURL('https://www.douyin.com/user/self?showTab=post');
    let result:any;try{result=await wc.executeJavaScript('('+pageRequest.toString()+')('+JSON.stringify(path)+','+JSON.stringify({...baseParams,...params})+')')}catch{throw new CollectError('NETWORK','抖音页面暂时无法读取')}
    return checkPageResult(result);
  }
  async owner(){if(await this.challenge())throw new CollectError('CAPTCHA','需要先完成抖音验证');return parseOwner(await this.request(SELF));}
  async following(owner:User,offset:number,time:number){return parseFollowing(await this.request(FOLLOWING,{user_id:owner.uid,sec_user_id:owner.sec_uid,offset:String(offset),max_time:String(time),count:'20'}));}
  async profile(user:User){const data=await this.request(PROFILE,{sec_user_id:user.sec_uid});if(!data.user||String(data.user.uid)!==user.uid)throw new CollectError('SCHEMA','详情接口身份不匹配');return data.user;}
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
