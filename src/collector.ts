import {Store} from './store';
import {Transport,CollectError,VideoPage,newestThree} from './transport';
import {User,Run,makeRow,count} from './domain';
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
export class Collector {
  busy=false;private paused=false;private ownerUser:User|null=null;countdown=0;
  private pendingStart:{status:Run['status'];message:string}|null=null;
  private requestDurations:number[]=[];
  constructor(public store:Store,public transport:Transport,public changed:()=>void,private delay=sleep){}
  state(){const saved=this.store.latest();const run=this.pendingStart?{id:'pending-login',phase:'following',pages:0,...this.pendingStart}:saved;const progress=!this.pendingStart&&saved?this.store.progress(saved.id):{total:0,completed:0,videos:0};const average=this.requestDurations.length?this.requestDurations.reduce((a,b)=>a+b)/this.requestDurations.length:1600;const expected=Math.max(progress.total,saved?.total_hint||0);const remaining=run?.phase==='following'?Math.ceil(Math.max(0,expected-progress.total)/20)+2*expected:Math.max(0,progress.total-progress.completed)+Math.max(0,progress.total-progress.videos);const etaSeconds=this.busy&&run?.status==='running'&&!this.pendingStart?Math.ceil(remaining*average/1000):null;return {run,progress,busy:this.busy,countdown:this.countdown,etaSeconds};}
  pause(){this.paused=true;if(this.pendingStart)this.pendingStart={status:'paused',message:'已暂停，点击继续开始更新'};else {const r=this.store.latest();if(r&&r.status!=='completed')this.store.update(r.id,{status:'paused',message:'已暂停，可从断点继续'});}this.changed();}
  private checkPause(){if(this.paused)throw new CollectError('PAUSED','已暂停');}
  async start(){
    if(this.busy)throw Error('已有采集任务正在运行');this.busy=true;this.paused=false;this.pendingStart={status:'running',message:'正在确认登录账号'};this.changed();
    await this.beginNew();
  }
  private async beginNew(){try{const owner=await this.request(()=>this.transport.owner());this.checkPause();this.ownerUser=owner;this.store.activate(owner.uid,owner.nickname);const run=this.store.createRun(owner.uid,count(owner.following_count)||0);this.pendingStart=null;this.changed();await this.delay(1000);void this.work(run.id);}catch(e:any){this.busy=false;this.pendingStart={status:e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':e.code==='PAUSED'?'paused':'error',message:e instanceof CollectError?e.message:'登录连接失败，请重试'};if(['CAPTCHA','LOGIN'].includes(e.code))this.transport.show();this.changed();}}
  private async waitVerification(update:(message:string)=>void){update('验证后等待 5 秒');for(let i=5;i>0;i--){this.countdown=i;this.changed();await this.delay(1000);this.checkPause();}this.countdown=0;if(await this.transport.challenge())throw new CollectError('CAPTCHA','验证尚未完成，请继续操作抖音窗口');}
  async resume(verification=false){
    if(this.busy)throw Error('已有采集任务正在运行');
    if(this.pendingStart){this.busy=true;this.paused=false;try{if(verification)await this.waitVerification(message=>{this.pendingStart={status:'cooldown',message}});await this.beginNew();}catch(e:any){this.countdown=0;this.busy=false;this.pendingStart={status:e.code==='PAUSED'?'paused':'waiting_verification',message:e.message};this.transport.show();this.changed();}return;}
    const r=this.store.latest();if(!r||r.status==='completed')throw Error('没有未完成任务，请点击更新数据');
    this.busy=true;this.paused=false;this.changed();
    try{
      if(verification)await this.waitVerification(message=>this.store.update(r.id,{status:'cooldown',message}));
      const owner=await this.request(()=>this.transport.owner());this.checkPause();if(owner.uid!==r.owner_uid)throw new CollectError('ACCOUNT_CHANGED','登录账号已更换。请切回原账号继续，或点击更新数据创建新账号任务');
      this.ownerUser=owner;this.store.update(r.id,{status:'running',message:'',error_uid:null});this.changed();await this.delay(1000);void this.work(r.id);
    }catch(e){this.countdown=0;await this.block(r.id,e);this.busy=false;this.changed();}
  }
  private async request<T>(fn:()=>Promise<T>,target?:User):Promise<T>{
    for(let attempt=0;;attempt++){
      this.checkPause();try{const started=Date.now();const result=await fn();this.requestDurations.push(Date.now()-started+1000);if(this.requestDurations.length>30)this.requestDurations.shift();return result}catch(e:any){
        this.checkPause();if(e.code==='LOGIN'||e.code==='ACCOUNT_CHANGED')throw e;
        if(await this.transport.challenge(target,attempt===0))throw new CollectError('CAPTCHA','需要手动完成验证码');
        if(e.code==='SCHEMA')throw e;
        if(!['NETWORK','TIMEOUT','HTTP_500','HTTP_502','HTTP_503','HTTP_504'].includes(e.code)||attempt>=2)throw e;
        await this.delay(attempt===0?3000:10000);
      }
    }
  }
  private async work(id:string){
    let target:User|undefined;
    try{
      let run=this.store.run(id)!;
      while(run.phase==='following'){
        const page=await this.request(()=>this.transport.following(this.ownerUser!,run.offset,run.max_time));this.checkPause();
        const existing=new Set(this.store.members(id).map(u=>u.uid));
        if(page.more&&(page.min_time===run.max_time||page.users.every(u=>existing.has(u.uid))))throw new CollectError('SCHEMA','关注列表分页未推进，已保存断点');
        this.store.addPage(id,page.users,{offset:run.offset+page.users.length,max_time:page.min_time,pages:run.pages+1},!page.more);this.changed();run=this.store.run(id)!;await this.delay(1000);
      }
      for(;;){
        this.checkPause();const next=this.store.nextVideos(id);
        if(!next){
          const u=this.store.nextUser(id);if(!u)break;target=u;this.store.update(id,{phase:'profiles'});this.changed();
          const p=await this.request(()=>this.transport.profile(u),u);this.checkPause();
          if(String(p?.uid)!==u.uid)throw new CollectError('SCHEMA','详情账号身份不匹配，已暂停');
          this.store.saveRow(id,makeRow(u,p));this.changed();target=undefined;await this.delay(1000);continue;
        }
        target=next.user;this.store.update(id,{phase:'videos'});this.changed();
        if(next.row.works_status==='private'||next.row.works_status==='privacy_unknown'){this.store.saveVideos(id,target.uid,[],'private');this.changed();target=undefined;continue}
        if(next.row.works_count===0){this.store.saveVideos(id,target.uid,[],'empty');this.changed();target=undefined;continue}
        let cursor=0,all:VideoPage['videos']=[],valid=true,conflict=false;
        for(let pages=0;;pages++){
          const data=await this.request(()=>this.transport.videos(target!,cursor),target);this.checkPause();all.push(...data.videos);valid=valid&&data.valid;
          if(!valid||!data.more||new Set(all.filter(v=>!v.pinned).map(v=>v.id)).size>=3)break;
          if(data.cursor===cursor||pages>=4){valid=false;conflict=true;break;}
          cursor=data.cursor;await this.delay(1000);
        }
        this.store.saveVideos(id,target.uid,valid?newestThree(all):[],conflict?'conflict':!valid?'unknown':all.length?'verified':'unknown');this.changed();target=undefined;await this.delay(1000);
      }
      this.store.update(id,{status:'completed',message:'采集完成，未知数量按原口径保留',error_uid:null});
    }catch(e){if(target)this.store.update(id,{error_uid:target.uid});await this.block(id,e);}finally{this.busy=false;this.changed();}
  }
  private async block(id:string,e:any){
    if(e.code==='PAUSED'){this.store.update(id,{status:'paused',message:'已暂停，可从断点继续'});return;}
    this.store.update(id,{status:e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':'error',message:e instanceof CollectError?e.message:'采集异常，已保存断点；请点击继续重试'});
    if(['CAPTCHA','LOGIN','ACCOUNT_CHANGED'].includes(e.code))this.transport.show();
  }
}
