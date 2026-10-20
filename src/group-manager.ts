import {randomUUID} from 'node:crypto';
import {Store} from './store';
import {User,Row,makeRow,cleanIds} from './domain';
import {GroupWire} from './group-service';
import {readCatalog,deltaConfirmed,groupIds} from './groups';
import {CollectError} from './transport';
export type GroupOperation='add'|'remove'|'copy'|'move';
export type GroupBatch={id:string;owner:string;nonce:string;operation:GroupOperation;source:string[];target:string[];names:Record<string,string>;created_at:string;status:string;message:string;items:{user:User;state:'pending'|'sending'|'unknown'|'done'|'skipped';message:string;actual?:string[]}[]};
export function groupIntent(operation:GroupOperation,source:string[],target:string[],current:string[]){
 const src=new Set(groupIds(source)),dest=new Set(groupIds(target)),now=new Set(groupIds(current));
 if(!['add','remove','copy','move'].includes(operation))throw Error('分组操作无效');
 if(operation!=='remove'&&!dest.size)throw Error('请选择目标分组');
 if(['remove','move','copy'].includes(operation)&&!src.size)throw Error('请选择来源分组');
 if(operation==='move'&&[...src].some(g=>dest.has(g)))throw Error('移动的来源和目标分组不能相同');
 return {add:operation==='remove'?[]:[...dest].filter(g=>!now.has(g)),del:['remove','move'].includes(operation)?[...src].filter(g=>now.has(g)):[]};
}
export class GroupManager{
 busy=false;countdown=0;private stopped=false;
 readonly capabilities={create:false,rename:false,delete:false,message:'新建、改名、删除只有 APK 静态定义，尚未在测试账号完成线上写入与回读验证；请暂在抖音中操作。'};
 constructor(public store:Store,private wire:GroupWire,private changed:()=>void,private delay=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms))){
  store.db.exec('CREATE TABLE IF NOT EXISTS group_batches(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL)');
  for(const x of store.db.prepare('SELECT data FROM group_batches').all() as any[]){const r:GroupBatch=JSON.parse(x.data);if(r.status==='running'){r.status='paused';r.message='上次任务中断，继续前先核对归属';for(const i of r.items)if(i.state==='sending')i.state='unknown';this.save(r)}}
 }
 rows(includeIgnored=false):Row[]{const owner=this.store.owner(),s=this.store.snapshot(owner),rows=new Map([...s.rows,...s.group_rows].map(r=>[r.uid,r]));if(includeIgnored){for(const r of this.store.tools.ignored(owner))rows.set(r.uid,r);for(const r of this.store.groups.users(owner))rows.set(r.uid,rows.get(r.uid)||r)}const memberships=this.store.groups.rows(owner);return [...rows.values()].map(r=>({...r,...memberships.get(r.uid)}))}
 private save(r:GroupBatch){this.store.db.prepare('INSERT INTO group_batches VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE group_batches.owner=excluded.owner').run(r.id,r.owner,JSON.stringify(r));this.changed()}
 get(owner:string,id:string):GroupBatch|null{const x=this.store.db.prepare('SELECT data FROM group_batches WHERE owner=? AND id=?').get(owner,id) as any;return x?JSON.parse(x.data):null}
 list(owner=this.store.owner()):GroupBatch[]{return (this.store.db.prepare('SELECT data FROM group_batches WHERE owner=? ORDER BY rowid DESC LIMIT 50').all(owner) as any[]).map(x=>JSON.parse(x.data))}
 preview(ids:string[],operation:GroupOperation,source:string[],target:string[],includeIgnored=false){
  if(this.busy)throw Error('已有分组任务执行中');const owner=this.store.owner();if(!owner)throw Error('请连接当前账号');const state=this.store.groups.state(owner);if(!state.checked_at||state.error)throw Error('请先完整刷新分组');
  source=groupIds(source);target=groupIds(target);const names=Object.fromEntries(state.groups.map(g=>[g.id,g.name]));if([...source,...target].some(id=>!names[id]))throw Error('所选分组已变化，请刷新');groupIntent(operation,source,target,[]);
  const chosen=new Set(cleanIds(ids)),users=this.rows(includeIgnored).filter(r=>chosen.has(r.uid));if(!users.length||users.length!==chosen.size)throw Error('选择中包含已失效或忽视账号，请重新选择');
  if(['remove','move','copy'].includes(operation)&&users.some(r=>r.groups_status!=='known'||!Array.isArray(r.groups)||!r.groups.some((g:any)=>source.includes(g.id))))throw Error('来源分组不包含全部所选成员，请重新选择');
  const r:GroupBatch={id:randomUUID(),owner,nonce:randomUUID(),operation,source,target,names,created_at:new Date().toISOString(),status:'ready',message:'预览已固定，仅确认后修改抖音分组',items:users.map(u=>({user:{uid:u.uid,sec_uid:u.sec_uid,nickname:u.nickname,unique_id:u.account},state:'pending',message:''}))};this.save(r);return r;
 }
 pause(){this.stopped=true}
 private check(owner:string){if(this.store.owner()!==owner)throw new CollectError('ACCOUNT_CHANGED','登录账号已切换，已暂停旧任务');if(this.stopped)throw new CollectError('PAUSED','分组任务已暂停')}
 async execute(id:string,nonce:string,verified=false){if(this.busy)throw Error('任务仍在运行');const r=this.get(this.store.owner(),id);if(!r||r.nonce!==nonce)throw Error('分组预览已失效');if(r.status==='completed')throw Error('任务已完成');if(r.status==='waiting_verification'&&!verified)throw Error('请完成验证后点击已完成验证');this.stopped=false;this.busy=true;void this.work(r,verified)}
 private async work(r:GroupBatch,verified:boolean){try{
  this.check(r.owner);if(verified){for(let n=5;n>0;n--){this.countdown=n;this.changed();await this.delay(1000);this.check(r.owner)}this.countdown=0;if(await this.wire.challenge())throw new CollectError('CAPTCHA','验证码尚未解除')}
  const cx=await this.wire.connect(r.owner);this.check(r.owner);r.status='running';this.save(r);
  for(const item of r.items){this.check(r.owner);if(['done','skipped'].includes(item.state))continue;const u=item.user;if(this.store.tools.ignored(r.owner).some(x=>x.uid===u.uid)){item.state='skipped';item.message='已加入忽视名单，跳过';this.save(r);continue}r.message='正在核对 '+(u.nickname||u.uid);this.save(r);await this.delay(1000);this.check(r.owner);
   let fresh=await readCatalog(cx.read,u.sec_uid);this.check(r.owner);const available=new Set(fresh.groups.map(g=>g.id));if([...r.source,...r.target].some(id=>!available.has(id)))throw new CollectError('CONFLICT','来源或目标分组已删除，请取消旧预览并重新选择');
   let delta=groupIntent(r.operation,r.source,r.target,fresh.belong);
   if(!delta.add.length&&!delta.del.length){item.state='skipped';item.message='已是目标归属，无需提交';item.actual=fresh.belong;this.store.groups.target(r.owner,u.uid,fresh.groups,fresh.belong);this.save(r);continue}
   // A move first adds and confirms destinations. Only then may it remove source groups.
   for(const phase of ['add','del'] as const){
    delta=groupIntent(r.operation,r.source,r.target,fresh.belong);if(!delta[phase].length)continue;
    if(phase==='del'&&r.operation==='move'&&!r.target.every(id=>fresh.belong.includes(id)))throw new CollectError('UNCONFIRMED','目标归属未确认，保留来源分组');
    const part={add:phase==='add'?delta.add:[],del:phase==='del'?delta.del:[]};this.check(r.owner);item.state='sending';item.message=phase==='add'?'正在加入目标分组':'正在移出来源分组';this.save(r);let error:any;
    try{await cx.write(u.sec_uid,part.add,part.del,()=>this.check(r.owner))}catch(e){error=e}
    this.check(r.owner);try{fresh=await readCatalog(cx.read,u.sec_uid)}catch(e){throw error||e}this.check(r.owner);
    this.store.groups.target(r.owner,u.uid,fresh.groups,fresh.belong);item.actual=fresh.belong;
    if(!deltaConfirmed(part,fresh.belong))throw error||new CollectError('UNCONFIRMED','归属未全部确认，已暂停；继续时先回读');
   }
   item.state='done';item.message='已回读确认';this.save(r);
  }r.status='completed';r.message='分组操作已回读确认；刷新分组可更新完整人数';this.save(r);
 }catch(e:any){for(const i of r.items)if(i.state==='sending'){i.state='unknown';i.message='提交结果待回读'}r.status=e.code==='CAPTCHA'?'waiting_verification':e.code==='LOGIN'?'waiting_login':'paused';r.message=e.message||'任务暂停';this.save(r);if(['CAPTCHA','LOGIN'].includes(e.code))this.wire.show()}
 finally{this.busy=false;this.countdown=0;this.changed()}}
}
