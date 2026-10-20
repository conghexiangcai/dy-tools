import {randomUUID} from 'node:crypto';
import {Store} from './store';
import {User,cleanUser} from './domain';
import {CollectError} from './transport';
import {GroupCatalog,readCatalog,readMembers,membershipDelta,deltaConfirmed,sameCatalog} from './groups';
export type GroupConnection={selfSec?:string;read:(path:string,params:Record<string,string>)=>Promise<any>;write:(secUid:string,add:string[],del:string[],guard?:()=>void)=>Promise<void>};
export interface GroupWire {connect(owner:string):Promise<GroupConnection>;challenge(target?:User,navigate?:boolean):Promise<boolean>;show():void}
export class GroupService {
  busy=false;countdown=0;waiting=false;message='';private pending:'refresh'|'dialog'|null=null;
  dialog:{token:string;owner:string;user:User;initial:string[];catalog:GroupCatalog;valid:()=>boolean;loaded:boolean}|null=null;
  constructor(public store:Store,private wire:GroupWire,private changed:()=>void,private delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
  state(){return {busy:this.busy,countdown:this.countdown,waiting:this.waiting,message:this.message,...this.store.groups.state(this.store.owner())}}
  cancel(){if(!this.dialog)return;this.dialog=null;this.changed()}
  private guard(d:NonNullable<GroupService['dialog']>){if(this.dialog!==d||this.store.owner()!==d.owner||!d.valid())throw new CollectError('STALE','主页或登录账号已切换，请重新打开分组弹窗')}
  private async failed(owner:string,e:any,pending:'refresh'|'dialog'){
    if(e.code==='STALE')return;
    this.message=e instanceof CollectError?e.message:'分组请求失败，请刷新重试';
    this.waiting=e.code==='CAPTCHA'||await this.wire.challenge();this.pending=this.waiting?pending:null;
    if(e.code==='CAPTCHA')await this.wire.challenge(this.dialog?.user,true);
    if(this.waiting){this.message='分组请求需要验证，请在抖音窗口完成后点击“已完成验证”';this.wire.show()}
    this.store.groups.failed(owner,this.message);this.changed();
  }
  async refresh(){
    if(this.busy)throw Error('正在处理分组，请稍候');const owner=this.store.owner(),rows=this.store.snapshot().rows;if(!owner)throw Error('请先登录并连接当前账号');
    this.busy=true;this.waiting=false;this.message='正在读取抖音分组';this.changed();
    try{
      const cx=await this.wire.connect(owner),sec=rows[0]?.sec_uid||cx.selfSec;if(!sec)throw Error('分组目录缺少可核对的账号，请先获取关注名单');const catalog=await readCatalog(cx.read,sec),mapping=new Map(rows.map(r=>[r.uid,[] as string[]])),users=new Map<string,User>();
      const memberRead:GroupConnection['read']=async(p,q)=>{const data=await cx.read(p,q);for(const u of data.user_list||[])try{const user=cleanUser(u);users.set(user.uid,user)}catch{throw new CollectError('SCHEMA','分组成员身份不完整，已保留上次数据')}return data};
      for(const [i,g] of catalog.groups.entries()){
        if(this.store.owner()!==owner)throw new CollectError('STALE','登录账号已切换，已取消旧账号分组更新');
        this.message=`正在读取分组成员 ${i+1} / ${catalog.groups.length}`;this.changed();
        for(const uid of await readMembers(memberRead,g)){if(!mapping.has(uid))mapping.set(uid,[]);mapping.get(uid)!.push(g.id)}
      }
      const latest=await readCatalog(cx.read,sec);
      if(!sameCatalog(catalog.groups,latest.groups))throw new CollectError('CONFLICT','分组在同步期间发生变化，请重新刷新');
      if(this.store.owner()!==owner)throw new CollectError('STALE','登录账号已切换，已取消旧账号分组更新');
      this.store.groups.complete(owner,catalog.groups,mapping,users);this.message=`已同步 ${catalog.groups.length} 个抖音分组`;this.pending=null;
    }catch(e){await this.failed(owner,e,'refresh')}finally{this.busy=false;this.changed()}
  }
  async open(user:User,valid:()=>boolean){
    if(this.busy)throw Error('正在刷新分组，请稍候再设置');this.cancel();
    const d={token:randomUUID(),owner:this.store.owner(),user,initial:[] as string[],catalog:{groups:[],belong:[]} as GroupCatalog,valid,loaded:false};this.dialog=d;
    this.busy=true;this.changed();try{
      const cx=await this.wire.connect(d.owner),catalog=await readCatalog(cx.read,user.sec_uid);this.guard(d);
      d.initial=catalog.belong;d.catalog=catalog;d.loaded=true;this.store.groups.target(d.owner,user.uid,catalog.groups,catalog.belong);
      this.message='';return this.dialogState();
    }catch(e){await this.failed(d.owner,e,'dialog');throw e}finally{this.busy=false;this.changed()}
  }
  dialogState(){const d=this.dialog;if(!d||!d.loaded)return null;this.guard(d);return {token:d.token,nickname:d.user.nickname||'',account:d.user.uid,groups:d.catalog.groups,selected:d.initial}}
  async save(token:string,selected:string[]){
    const d=this.dialog;if(!d||!d.loaded||d.token!==token)throw Error('分组弹窗已失效');this.guard(d);if(this.busy)throw Error('分组请求进行中，请稍候');
    this.busy=true;this.changed();try{
      const cx=await this.wire.connect(d.owner),fresh=await readCatalog(cx.read,d.user.sec_uid);this.guard(d);
      const delta=membershipDelta(d.initial,selected,fresh.belong,fresh.groups.map(g=>g.id));
      if(!delta.add.length&&!delta.del.length){this.store.groups.target(d.owner,d.user.uid,fresh.groups,fresh.belong);d.initial=fresh.belong;d.catalog=fresh;return {confirmed:true,message:'没有需要提交的更改',...this.dialogState()}}
      let writeError:unknown;
      try{this.guard(d);await cx.write(d.user.sec_uid,delta.add,delta.del,()=>this.guard(d))}catch(e){writeError=e}
      // A write is NEVER automatically retried, even after timeout, captcha or an ambiguous response.
      let actual:GroupCatalog;
      try{actual=await readCatalog(cx.read,d.user.sec_uid)}catch(e){throw writeError||e}
      this.guard(d);this.store.groups.target(d.owner,d.user.uid,actual.groups,actual.belong);d.initial=actual.belong;d.catalog=actual;
      const confirmed=deltaConfirmed(delta,actual.belong);
      if(!confirmed){this.message='尚未确认全部变更；已回读实际归属，请核对后再保存';if(writeError)await this.failed(d.owner,writeError,'dialog')}
      else this.message='已同步到抖音，并回读确认';
      return {confirmed,message:this.message,...this.dialogState()};
    }catch(e){await this.failed(d.owner,e,'dialog');throw e}finally{this.busy=false;this.changed()}
  }
  async verified(){
    if(!this.waiting||this.busy)throw Error('当前没有等待验证的分组请求');const pending=this.pending;this.busy=true;
    try{for(let i=5;i>0;i--){this.countdown=i;this.message=`验证后等待 ${i} 秒`;this.changed();await this.delay(1000)}if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证尚未完成');this.waiting=false;
    }catch(e){await this.failed(this.store.owner(),e,pending||'refresh');return}finally{this.countdown=0;this.busy=false;this.changed()}
    if(pending==='refresh')await this.refresh();
    else if(this.dialog){const d=this.dialog;this.guard(d);await this.open(d.user,d.valid);this.message='已重新读取实际归属；请核对后点击保存';this.changed()}
  }
}
