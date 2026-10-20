import {BrowserWindow,WebContentsView} from 'electron';
import {BrowserHost,appURL} from './browser';
import {Store} from './store';
import {GroupService} from './group-service';
import {Row} from './domain';
// Read-only DOM inspection. No app bridge or local privileges are installed in the remote page.
export function inspectFollowAnchor(){
  const text=document.body?.innerText||'';
  if(/请完成下列验证后继续|按住左边按钮拖动|拖动滑块完成拼图/.test(text))return null;
  if([...document.querySelectorAll('iframe')].some(f=>{const r=f.getBoundingClientRect();return r.width>80&&r.height>80&&/captcha|verifycenter|verify_center/i.test(f.src)}))return null;
  const candidates=[...document.querySelectorAll<HTMLElement>('[data-e2e="user-info-follow-btn"]')].filter(b=>{
    const r=b.getBoundingClientRect(),s=getComputedStyle(b);if(!/^(关注|已关注|互相关注|回关|关注回关|相互关注)$/.test(b.innerText.trim())||s.visibility==='hidden'||s.display==='none'||r.width<35||r.height<20||r.top<40||r.bottom>innerHeight||r.left<0||r.right>innerWidth)return false;
    const at=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!at&&(at===b||b.contains(at));
  });
  if(candidates.length!==1)return null;const r=candidates[0].getBoundingClientRect();const info=(document.querySelector('[data-e2e="user-info"]') as HTMLElement|null)?.innerText||'';
  return {url:location.href,account:info.match(/抖音号[：:]\s*([^\s]+)/)?.[1]||'',nickname:info.split('\n')[0]?.trim()||'',x:r.x,y:r.y,width:r.width,height:r.height};
}
export class GroupUI {
  overlay:WebContentsView;privacyOverlay:WebContentsView;dialogWindow:BrowserWindow|null=null;private timer:NodeJS.Timeout;private polling=false;private anchor:{row:Row;owner:string;revision:number;url:string}|null=null;private loaded=false;private privacyLoaded=false;
  constructor(private host:BrowserHost,private store:Store,private groups:GroupService,private preload:string){
    this.overlay=new WebContentsView({webPreferences:{preload,contextIsolation:true,nodeIntegration:false,sandbox:true}});this.overlay.setVisible(false);this.overlay.setBackgroundColor('#00000000');
    this.host.window.contentView.addChildView(this.overlay);this.overlay.webContents.loadURL(appURL+'group-button.html');
    this.overlay.webContents.on('did-finish-load',()=>{this.loaded=true});this.overlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.overlay.webContents.on('will-navigate',e=>e.preventDefault());
    // Separate, tightly bounded local view: it never covers the remote follow button.
    this.privacyOverlay=new WebContentsView({webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});this.privacyOverlay.setVisible(false);this.privacyOverlay.setBackgroundColor('#00000000');
    this.host.window.contentView.addChildView(this.privacyOverlay);this.privacyOverlay.webContents.loadURL(appURL+'profile-private.html');
    this.privacyOverlay.webContents.on('did-finish-load',()=>{this.privacyLoaded=true});this.privacyOverlay.webContents.setWindowOpenHandler(()=>({action:'deny'}));this.privacyOverlay.webContents.on('will-navigate',e=>e.preventDefault());
    this.host.onContextChange=()=>this.cancel();this.host.window.on('hide',()=>this.hideOverlays());this.timer=setInterval(()=>void this.tick(),200);
  }
  owns(id:number){return id===this.overlay.webContents.id||id===this.dialogWindow?.webContents.id}
  private hideOverlays(){this.overlay.setVisible(false);this.privacyOverlay.setVisible(false)}
  cancel(){this.anchor=null;this.hideOverlays();this.groups.cancel();if(this.dialogWindow&&!this.dialogWindow.isDestroyed())this.dialogWindow.close();this.dialogWindow=null}
  private async tick(){
    if(this.polling||!this.loaded||!this.host.window.isVisible())return;this.polling=true;
    try{
      const wc=this.host.current,owner=this.store.owner(),revision=this.host.revision;
      if(!wc||wc.isDestroyed()||wc.isLoadingMainFrame()){this.hideOverlays();return}
      const url=new URL(wc.getURL());if(url.origin!=='https://www.douyin.com'){this.cancel();return}
      const sec=url.pathname.match(/^\/user\/([\w-]+)\/?$/)?.[1],row=sec?this.store.profileTarget(sec):undefined,profile=sec?this.host.profileMeta(sec):undefined;
      if(!row&&!profile){this.cancel();return}
      const a=await wc.executeJavaScript('('+inspectFollowAnchor.toString()+')()').catch(()=>null);
      if(wc!==this.host.current||revision!==this.host.revision||owner!==this.store.owner())return;
      if(!a||a.url!==wc.getURL()||(row&&(row.account!==row.uid?a.account!==row.account:a.nickname!==row.nickname))){this.hideOverlays();this.anchor=null;return}
      if(this.groups.dialog&&this.groups.dialog.owner!==owner){this.cancel();return}
      const zoom=wc.getZoomFactor(),badge={x:Math.round(a.x*zoom)-124,y:92+Math.round((a.y+a.height/2)*zoom)-15,width:112,height:30};
      this.host.window.contentView.addChildView(this.privacyOverlay);this.privacyOverlay.setBounds(badge);this.privacyOverlay.setVisible(this.privacyLoaded&&profile?.is_private===true&&badge.x>=8&&!this.dialogWindow);
      if(!row){this.anchor=null;this.overlay.setVisible(false);return}
      this.anchor={row,owner,revision,url:a.url};const bounds={x:Math.round(a.x*zoom),y:92+Math.round(a.y*zoom)-36,width:Math.max(88,Math.round(a.width*zoom)),height:30};
      this.host.window.contentView.addChildView(this.overlay);this.overlay.setBounds(bounds);this.overlay.setVisible(!this.dialogWindow);
    }catch{this.hideOverlays()}finally{this.polling=false}
  }
  notify(){if(this.dialogWindow&&!this.dialogWindow.isDestroyed())this.dialogWindow.webContents.send('desktop:change',{groups:this.groups.state(),groupDialog:this.safeDialog()})}
  private safeDialog(){try{return this.groups.dialogState()}catch{return null}}
  async command(method:string,p:any,sender:number){
    if(sender===this.overlay.webContents.id){if(method!=='groupOpen')throw Error('按钮不支持此操作');return this.open()}
    if(sender!==this.dialogWindow?.webContents.id)throw Error('分组窗口已关闭');
    if(method==='groupDialogState')return {dialog:this.safeDialog(),state:this.groups.state()};
    if(method==='groupSave')return this.groups.save(p?.token,p?.selected);
    if(method==='groupCancel'){this.cancel();return true}
    if(method==='groupVerified')return this.groups.verified();
    throw Error('分组窗口不支持此操作');
  }
  private async open(){
    await this.tick();const binding=this.anchor;if(!binding)throw Error('当前主页无法识别，请重新打开名单账号');
    const valid=()=>this.anchor?.row.uid===binding.row.uid&&this.store.owner()===binding.owner&&this.host.revision===binding.revision&&this.host.current?.getURL()===binding.url;
    if(!valid())return;this.hideOverlays();
    const win=new BrowserWindow({parent:this.host.window,width:450,height:590,resizable:true,minWidth:380,minHeight:400,show:false,autoHideMenuBar:true,title:'设置抖音关注分组',webPreferences:{preload:this.preload,contextIsolation:true,nodeIntegration:false,sandbox:true}});this.dialogWindow=win;
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
    win.on('closed',()=>{if(this.dialogWindow===win){this.dialogWindow=null;this.groups.cancel()}});
    await win.loadURL(appURL+'group-dialog.html');if(win.isDestroyed()||!valid())return;win.show();
    try{await this.groups.open({uid:binding.row.uid,sec_uid:binding.row.sec_uid,nickname:binding.row.nickname},valid)}catch(e:any){if(!win.isDestroyed())win.webContents.send('desktop:change',{groupError:e.message})}this.notify();
  }
  destroy(){clearInterval(this.timer);this.cancel();this.overlay.webContents.close();this.privacyOverlay.webContents.close()}
}
