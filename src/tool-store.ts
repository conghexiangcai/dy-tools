import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {uidValid,Row} from './domain';
export type ActionKind='unfollow'|'follow'|'unlike'|'uncollect'|'unrecommend';
export type ActionItem={id:string;sec_uid?:string;label:string;account?:string;url?:string;aweme_type?:number;state:'pending'|'sending'|'done'|'skipped'|'unknown'|'failed';message?:string;checked_at?:string};
export type ActionRun={id:string;owner_uid:string;kind:ActionKind;scope:string;created_at:string;updated_at:string;nonce:string;status:'ready'|'running'|'paused'|'waiting_verification'|'waiting_login'|'completed'|'error';message:string;items:ActionItem[]};
export type Transfer={id:string;source_uid:string;source_name:string;created_at:string;snapshot_at:string|null;items:ActionItem[]};
export type Roster={id:string;name:string;members:{uid:string;nickname:string}[];source:string;collected_at:string};
export class ToolStore {
 constructor(private db:DatabaseSync){db.exec(`
 CREATE TABLE IF NOT EXISTS ignored_accounts(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,added_at TEXT NOT NULL,PRIMARY KEY(owner_uid,uid));
 CREATE TABLE IF NOT EXISTS action_runs(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS action_owner ON action_runs(owner_uid);
 CREATE TABLE IF NOT EXISTS following_transfers(id TEXT PRIMARY KEY,source_uid TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS group_rosters(owner_uid TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner_uid,id));
 CREATE TABLE IF NOT EXISTS relationship_effects(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,following INTEGER NOT NULL,checked_at TEXT NOT NULL,PRIMARY KEY(owner_uid,uid));`);
 for(const r of this.db.prepare('SELECT data FROM action_runs').all() as any[]){const run:ActionRun=JSON.parse(r.data);if(run.status==='running'||run.items.some(i=>i.state==='sending')){run.status='paused';run.message='上次操作中断，继续时先核对结果';for(const i of run.items)if(i.state==='sending'){i.state='unknown';i.message='上次请求结果待核对'}this.save(run)}}
 }
 ignored(owner:string):Array<Row&{ignored_at:string}>{return (this.db.prepare('SELECT data,added_at FROM ignored_accounts WHERE owner_uid=? ORDER BY added_at DESC').all(owner) as any[]).map(r=>({...JSON.parse(r.data),ignored_at:r.added_at}))}
 ignore(owner:string,rows:Row[]){if(!uidValid(owner))throw Error('请先连接账号');const q=this.db.prepare('INSERT INTO ignored_accounts VALUES(?,?,?,?) ON CONFLICT(owner_uid,uid) DO NOTHING');this.db.exec('BEGIN IMMEDIATE');try{for(const r of rows){if(!uidValid(r.uid))throw Error('账号编号无效');q.run(owner,r.uid,JSON.stringify(r),new Date().toISOString())}this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}}
 restore(owner:string,ids:string[]){const q=this.db.prepare('DELETE FROM ignored_accounts WHERE owner_uid=? AND uid=?');for(const id of ids)q.run(owner,id)}
 effect(owner:string,uid:string,following:boolean){this.db.prepare('INSERT INTO relationship_effects VALUES(?,?,?,?) ON CONFLICT(owner_uid,uid) DO UPDATE SET following=excluded.following,checked_at=excluded.checked_at').run(owner,uid,following?1:0,new Date().toISOString())}
 removed(owner:string,snapshotAt:string|null){return new Set((this.db.prepare('SELECT uid FROM relationship_effects WHERE owner_uid=? AND following=0 AND checked_at>?').all(owner,snapshotAt||'') as any[]).map(r=>r.uid as string))}
 create(owner:string,kind:ActionKind,scope:string,items:ActionItem[]):ActionRun{if(!uidValid(owner)||!items.length)throw Error('没有可操作的项目');const ids=new Set<string>();for(const i of items){if(!uidValid(i.id)||ids.has(i.id))throw Error('操作名单无效或重复');ids.add(i.id)}const at=new Date().toISOString(),r:ActionRun={id:randomUUID(),owner_uid:owner,kind,scope,created_at:at,updated_at:at,nonce:randomUUID(),status:'ready',message:'仅已生成预览，尚未执行',items:structuredClone(items)};this.save(r);return r}
 save(r:ActionRun){r.updated_at=new Date().toISOString();this.db.prepare('INSERT INTO action_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(r.id,r.owner_uid,JSON.stringify(r))}
 run(owner:string,id:string):ActionRun|null{const r=this.db.prepare('SELECT data FROM action_runs WHERE owner_uid=? AND id=?').get(owner,id) as any;return r?JSON.parse(r.data):null}
 runs(owner:string):ActionRun[]{return (this.db.prepare('SELECT data FROM action_runs WHERE owner_uid=? ORDER BY rowid DESC LIMIT 30').all(owner) as any[]).map(r=>JSON.parse(r.data))}
 transfer(source_uid:string,source_name:string,snapshot_at:string|null,items:ActionItem[]){if(!items.length)throw Error('当前没有可迁移的关注账号');const p:Transfer={id:randomUUID(),source_uid,source_name,created_at:new Date().toISOString(),snapshot_at,items};this.db.prepare('INSERT INTO following_transfers VALUES(?,?,?)').run(p.id,source_uid,JSON.stringify(p));return p}
 transfers():Transfer[]{return (this.db.prepare('SELECT data FROM following_transfers ORDER BY rowid DESC').all() as any[]).map(r=>JSON.parse(r.data))}
 rosters(owner:string):Roster[]{return (this.db.prepare('SELECT data FROM group_rosters WHERE owner_uid=? ORDER BY rowid').all(owner) as any[]).map(r=>JSON.parse(r.data))}
 putRoster(owner:string,r:Roster){this.db.prepare('INSERT INTO group_rosters VALUES(?,?,?) ON CONFLICT(owner_uid,id) DO UPDATE SET data=excluded.data').run(owner,r.id,JSON.stringify(r))}
 removeRoster(owner:string,id:string){this.db.prepare('DELETE FROM group_rosters WHERE owner_uid=? AND id=?').run(owner,id)}
}
