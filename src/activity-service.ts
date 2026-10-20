import {ActivityStore,RelationRun} from './activity-store';
import {ActivityMember,memberMap} from './activity-domain';
import {User,count} from './domain';
import {CollectError} from './transport';
export interface RelationWire{owner():Promise<User>;following(u:User,offset:number,time:number):Promise<{users:User[];more:boolean;min_time:number}>;followers(u:User,offset:number,time:number):Promise<{users:User[];more:boolean;min_time:number}>;challenge():Promise<boolean>;show():void}
export class ActivityService{
 busy=false;countdown=0;private stopped=false;
 constructor(public store:ActivityStore,private wire:RelationWire,private owner:()=>string,private changed:()=>void,private delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){}
 pause(){this.stopped=true}
 state(){return {busy:this.busy,countdown:this.countdown,run:this.store.latest(this.owner()),following:this.store.latest(this.owner(),'following'),followers:this.store.latest(this.owner(),'followers')}}
 private check(owner:string){if(owner!==this.owner())throw new CollectError('ACCOUNT_CHANGED','账号已切换，旧任务已暂停');if(this.stopped)throw new CollectError('PAUSED','已暂停，分页断点已保存')}
 async start(kind:'following'|'followers'){if(this.busy)throw Error('任务仍在运行');if(!this.owner())throw Error('请连接当前账号');if(!['following','followers'].includes(kind))throw Error('名单类型无效');const r=this.store.newRun(this.owner(),kind);this.busy=true;this.stopped=false;void this.work(r,false)}
 async resume(verified=false,kind?:'following'|'followers'){if(this.busy)throw Error('任务仍在运行');if(kind!==undefined&&!['following','followers'].includes(kind))throw Error('名单类型无效');const r=this.store.latest(this.owner(),kind);if(!r||r.status==='completed')throw Error('没有可继续的任务');if(r.status==='waiting_verification'&&!verified)throw Error('请完成验证后点击已完成验证');this.busy=true;this.stopped=false;void this.work(r,verified)}
 private async read<T>(owner:string,fn:()=>Promise<T>){for(let n=0;;n++){this.check(owner);await this.delay(1000);this.check(owner);try{const v=await fn();this.check(owner);return v}catch(e:any){this.check(owner);if(!['EMPTY','NETWORK','TIMEOUT'].includes(e.code)||n>=2)throw e;if(await this.wire.challenge())throw new CollectError('CAPTCHA','请先完成抖音验证码')}}}
 private async work(r:RelationRun,verified:boolean){try{
  this.changed();if(verified){for(let n=5;n>0;n--){this.countdown=n;this.changed();await this.delay(1000);this.check(r.owner)}this.countdown=0;if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证码尚未解除')}
  const user=await this.read(r.owner,()=>this.wire.owner());if(user.uid!==r.owner)throw new CollectError('ACCOUNT_CHANGED','当前网页登录身份不符');const expected=count(r.kind==='following'?user.following_count:user.follower_count);
  if(r.expected!==null&&r.expected!==expected&&r.offset>0)throw new CollectError('CONFLICT','续传期间人数发生变化，请重新刷新建立完整名单');r.expected=expected;r.status='running';this.store.saveRun(r);
  for(let n=0;n<10000;n++){
   const key=r.offset+':'+r.time;if(r.seen.includes(key))throw new CollectError('SCHEMA','分页游标重复，请重新刷新');
   const p=await this.read(r.owner,()=>this.wire[r.kind](user,r.offset,r.time));const merged=memberMap([...r.members,...p.users.map(u=>({...u,account:u.unique_id||u.short_id}))] as ActivityMember[]);
   if(p.more&&(!p.users.length||merged.size===r.members.length))throw new CollectError('SCHEMA','分页未增加成员，名单不完整');
   // Check live identity after the page and before committing it.
   const identity=await this.read(r.owner,()=>this.wire.owner());if(identity.uid!==r.owner)throw new CollectError('ACCOUNT_CHANGED','登录身份已变化，丢弃本页');
   r.members=[...merged.values()];r.message=`已读取 ${r.members.length} 人`;if(p.more){r.seen.push(key);r.offset+=p.users.length;r.time=p.min_time}this.store.base.transaction(()=>{this.store.saveRun(r);this.store.saveSnapshot(r,false)});this.changed();
   if(!p.more){const finalCount=count(r.kind==='following'?identity.following_count:identity.follower_count);if(r.expected===null||finalCount!==r.expected||r.members.length!==r.expected)throw new CollectError('CONFLICT','人数变化、缺失或列表受限；已保留不完整名单，不生成减少记录');r.status='completed';r.message='完整名单已保存并自动比较；首次读取仅建立基准';this.store.saveRun(r);this.store.saveSnapshot(r,true);this.store.sync(r.owner);return}
  }throw Error('分页超出上限，已保留已读范围');
 }catch(e:any){r.status=e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':'paused';r.message=e.message||'读取中断';this.store.saveRun(r);this.store.saveSnapshot(r,false);if(['CAPTCHA','LOGIN'].includes(e.code))this.wire.show()}
 finally{this.busy=false;this.countdown=0;this.changed()}}
}
