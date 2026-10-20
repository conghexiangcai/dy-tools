import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {ChatSnapshot,ChatGroup,ChatMember,distinctMembers,parseChatJSON} from './chat-domain';
export type ChatRun={id:string;owner:string;groups:ChatGroup[];index:number;snapshot_ids:string[];cursor:string;seen:string[];status:'paused'|'running'|'completed'|'waiting_login'|'waiting_verification'|'error';message:string;updated_at:string};
export class ChatStore{
 constructor(private db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS chat_snapshots(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS chat_snapshots_owner ON chat_snapshots(owner);
 CREATE TABLE IF NOT EXISTS chat_catalog(owner TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chat_runs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chat_imports(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS chat_profiles(owner TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,uid));
 CREATE TABLE IF NOT EXISTS chat_migrations(owner TEXT PRIMARY KEY);`);
 for(const r of db.prepare('SELECT data FROM chat_runs').all() as any[]){const run:ChatRun=JSON.parse(r.data);if(run.status==='running'){run.status='paused';run.message='上次扫描中断，可从已保存页继续';this.saveRun(run)}}}
 profiles(owner:string):Map<string,ChatMember>{return new Map((this.db.prepare('SELECT data FROM chat_profiles WHERE owner=?').all(owner) as any[]).map(r=>{const m=JSON.parse(r.data);return [m.uid,m]}))}
 saveProfile(owner:string,m:ChatMember){this.db.prepare('INSERT INTO chat_profiles VALUES(?,?,?) ON CONFLICT(owner,uid) DO UPDATE SET data=excluded.data').run(owner,m.uid,JSON.stringify({...m,checked_at:new Date().toISOString()}))}
 transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value}catch(e){this.db.exec('ROLLBACK');throw e}}
 migrate(owner:string,legacy:any[]){if(!owner||this.db.prepare('SELECT owner FROM chat_migrations WHERE owner=?').get(owner))return;this.transaction(()=>{if(legacy.length){for(const s of parseChatJSON({groups:legacy},'旧版群名单').snapshots)this.put(owner,s)}this.db.prepare('INSERT INTO chat_migrations VALUES(?)').run(owner)})}
 put(owner:string,s:ChatSnapshot){this.db.prepare('INSERT INTO chat_snapshots VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE chat_snapshots.owner=excluded.owner').run(s.id,owner,JSON.stringify(s))}
 snapshots(owner:string):ChatSnapshot[]{return (this.db.prepare('SELECT data FROM chat_snapshots WHERE owner=? ORDER BY rowid DESC').all(owner) as any[]).map(r=>JSON.parse(r.data))}
 get(owner:string,id:string):ChatSnapshot|null{const r=this.db.prepare('SELECT data FROM chat_snapshots WHERE owner=? AND id=?').get(owner,id) as any;return r?JSON.parse(r.data):null}
 import(owner:string,payload:{snapshots:ChatSnapshot[];unresolved:any[]}){return this.transaction(()=>{const ids:string[]=[];for(const item of payload.snapshots){const s={...item,id:randomUUID(),origin:'import' as const,imported_at:new Date().toISOString()};this.put(owner,s);ids.push(s.id)}this.db.prepare('INSERT INTO chat_imports VALUES(?,?,?)').run(randomUUID(),owner,JSON.stringify({at:new Date().toISOString(),ids,unresolved:payload.unresolved}));return ids})}
 imports(owner:string){return (this.db.prepare('SELECT data FROM chat_imports WHERE owner=? ORDER BY rowid DESC LIMIT 20').all(owner) as any[]).map(r=>JSON.parse(r.data))}
 catalog(owner:string):{groups:ChatGroup[];at:string;complete:boolean;message:string;cursor?:string;seen?:string[];status?:string}|null{const r=this.db.prepare('SELECT data FROM chat_catalog WHERE owner=?').get(owner) as any;return r?JSON.parse(r.data):null}
 saveCatalog(owner:string,groups:ChatGroup[],complete:boolean,message:string,progress:{cursor?:string;seen?:string[];status?:string}={}){this.db.prepare('INSERT INTO chat_catalog VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner,JSON.stringify({groups,complete,message,...progress,at:new Date().toISOString()}))}
 saveRun(run:ChatRun){run.updated_at=new Date().toISOString();this.db.prepare('INSERT INTO chat_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE chat_runs.owner=excluded.owner').run(run.id,run.owner,JSON.stringify(run))}
 latest(owner:string):ChatRun|null{const r=this.db.prepare('SELECT data FROM chat_runs WHERE owner=? ORDER BY rowid DESC LIMIT 1').get(owner) as any;return r?JSON.parse(r.data):null}
 page(run:ChatRun,members:ChatMember[],more:boolean,next:string){this.transaction(()=>{const id=run.snapshot_ids[run.index],s=this.get(run.owner,id)!;s.members=distinctMembers([...s.members,...members]);s.collected_at=new Date().toISOString();s.complete=!more&&(s.group.expected===null||s.group.expected===s.members.length);s.reason=s.complete?'成员分页已完整读取':more?'扫描尚未完成':'已读人数与群人数不一致';this.put(run.owner,s);if(more){run.seen.push(run.cursor);run.cursor=next}else{run.index++;run.cursor='0';run.seen=[]}this.saveRun(run)})}
}
