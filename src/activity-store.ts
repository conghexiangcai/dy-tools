import {randomUUID} from 'node:crypto';
import {Store} from './store';
import {ActivityKind,ActivityMember,ActivitySnapshot,ChangeSet,compareSnapshots,memberMap} from './activity-domain';
export type RelationRun={id:string;owner:string;kind:'following'|'followers';offset:number;time:number;seen:string[];expected:number|null;status:string;message:string;started_at:string;updated_at:string;members:ActivityMember[]};
export class ActivityStore{
 constructor(public base:Store){base.db.exec(`CREATE TABLE IF NOT EXISTS activity_snapshots(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS activity_snapshot_owner ON activity_snapshots(owner);
 CREATE TABLE IF NOT EXISTS activity_changes(id TEXT NOT NULL,owner TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,id));
 CREATE TABLE IF NOT EXISTS relation_runs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);`);
 for(const x of base.db.prepare('SELECT data FROM relation_runs').all() as any[]){const r:RelationRun=JSON.parse(x.data);if(r.status==='running'){r.status='paused';r.message='上次读取中断，可继续';this.saveRun(r)}}}
 list(owner:string):ActivitySnapshot[]{return (this.base.db.prepare('SELECT data FROM activity_snapshots WHERE owner=?').all(owner) as any[]).map(x=>JSON.parse(x.data)).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')))}
 get(owner:string,id:string):ActivitySnapshot|null{const x=this.base.db.prepare('SELECT data FROM activity_snapshots WHERE owner=? AND id=?').get(owner,id) as any;return x?JSON.parse(x.data):null}
 put(s:ActivitySnapshot){memberMap(s.members);this.base.db.prepare('INSERT INTO activity_snapshots VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE activity_snapshots.owner=excluded.owner AND json_extract(activity_snapshots.data,\'$.complete\')=0').run(s.id,s.owner,JSON.stringify(s))}
 // Source membership snapshots, never the filtered/ignored/current display rows.
 sync(owner:string){
  for(const r of this.base.db.prepare("SELECT id,snapshot_at,started_at,total_hint FROM runs WHERE owner_uid=? AND snapshot_at IS NOT NULL AND id!='seed-v3'").all(owner) as any[]){const id='following:'+r.id;if(this.get(owner,id)?.complete)continue;const members=this.base.members(r.id).map(u=>({...u,account:u.unique_id||u.short_id})),complete=Number.isSafeInteger(r.total_hint)&&r.total_hint>=0&&members.length===r.total_hint;this.put({id,owner,kind:'following',scope:owner,name:'我的关注',at:r.snapshot_at,started_at:r.started_at,complete,reason:complete?'原采集完整关注分页，人数相符':'旧快照人数与当时总数不一致，仅保留历史，不生成减少记录',origin:'scan',members})}
  if(this.base.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='chat_snapshots'").get())for(const x of this.base.db.prepare('SELECT data FROM chat_snapshots WHERE owner=?').all(owner) as any[]){const s=JSON.parse(x.data),id='chat:'+s.id;if(this.get(owner,id)?.complete)continue;this.put({id,owner,kind:'chat',scope:s.group.id,name:s.group.name,at:s.collected_at,started_at:s.started_at,complete:s.complete,reason:s.reason,origin:s.origin,members:s.members})}
  const series=new Map<string,ActivitySnapshot[]>();for(const s of this.list(owner).reverse()){if(!s.complete||!s.at||s.origin!=='scan')continue;const key=JSON.stringify([s.kind,s.scope]);if(!series.has(key))series.set(key,[]);series.get(key)!.push(s)}
  for(const all of series.values())for(let n=1;n<all.length;n++)if(all[n-1].at!<all[n].at!)this.compare(owner,all[n-1].id,all[n].id);
 }
 compare(owner:string,before:string,after:string){const id=JSON.stringify([before,after]),saved=this.base.db.prepare('SELECT data FROM activity_changes WHERE owner=? AND id=?').get(owner,id) as any;if(saved)return JSON.parse(saved.data) as ChangeSet;
  const a=this.get(owner,before),b=this.get(owner,after);if(!a||!b)throw Error('历史版本不存在或属于其他账号');const value=compareSnapshots(a,b);
  if(a.kind==='following')for(const run of this.base.tools.runs(owner))if(['follow','unfollow'].includes(run.kind))for(const item of run.items){if(item.state!=='done'||!item.checked_at||item.checked_at<=value.from||item.checked_at>value.to)continue;const row=value.rows.find(r=>r.uid===item.id&&r.type===(run.kind==='follow'?'added':'removed'));if(row)row.operation='由本软件操作（已回读确认）'}
  this.base.db.prepare('INSERT OR IGNORE INTO activity_changes VALUES(?,?,?)').run(id,owner,JSON.stringify(value));return value;
 }
 changes(owner:string):ChangeSet[]{return (this.base.db.prepare('SELECT data FROM activity_changes WHERE owner=? ORDER BY rowid DESC').all(owner) as any[]).map(x=>JSON.parse(x.data))}
 newRun(owner:string,kind:RelationRun['kind']){const at=new Date().toISOString(),r:RelationRun={id:randomUUID(),owner,kind,offset:0,time:0,seen:[],expected:null,status:'running',message:'正在读取名单',started_at:at,updated_at:at,members:[]};this.saveRun(r);return r}
 saveRun(r:RelationRun){r.updated_at=new Date().toISOString();this.base.db.prepare('INSERT INTO relation_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE relation_runs.owner=excluded.owner').run(r.id,r.owner,JSON.stringify(r))}
 latest(owner:string,kind?:RelationRun['kind']):RelationRun|null{const x=(kind?this.base.db.prepare("SELECT data FROM relation_runs WHERE owner=? AND json_extract(data,'$.kind')=? ORDER BY rowid DESC LIMIT 1").get(owner,kind):this.base.db.prepare('SELECT data FROM relation_runs WHERE owner=? ORDER BY rowid DESC LIMIT 1').get(owner)) as any;return x?JSON.parse(x.data):null}
 saveSnapshot(r:RelationRun,complete:boolean){this.put({id:'relation:'+r.id,owner:r.owner,kind:r.kind,scope:r.owner,name:r.kind==='following'?'我的关注':'我的粉丝',at:new Date().toISOString(),started_at:r.started_at,origin:'scan',complete,reason:r.message,members:r.members})}
}
