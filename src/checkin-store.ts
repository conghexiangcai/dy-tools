import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {CheckinRun,decimal} from './checkin-domain';
import {CheckinSchedule,defaultCheckinSchedule,normalizeSchedule} from './checkin-schedule';
export class CheckinStore {
 readonly db:DatabaseSync;
 constructor(file:string){this.db=new DatabaseSync(file);this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
 CREATE TABLE IF NOT EXISTS checkin_runs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS checkin_owner ON checkin_runs(owner);
 CREATE TABLE IF NOT EXISTS checkin_settings(owner TEXT PRIMARY KEY,data TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS checkin_locks(owner TEXT PRIMARY KEY,pid INTEGER NOT NULL,token TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS checkin_slots(owner TEXT NOT NULL,slot TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(owner,slot));`)}
 close(){this.db.close()}
 save(r:CheckinRun){r.updated_at=new Date().toISOString();this.db.prepare('INSERT INTO checkin_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(r.id,r.owner,JSON.stringify(r))}
 create(owner:string,mode:CheckinRun['mode']):CheckinRun {decimal(owner);const at=new Date().toISOString();const r:CheckinRun={id:randomUUID(),owner,created_at:at,updated_at:at,status:'running',phase:'list',mode,offset:0,page_fingerprints:[],items:[],cursor:0,message:'正在读取全部已加入粉丝团',day:null};this.save(r);return r}
 latest(owner:string):CheckinRun|null {const row=this.db.prepare('SELECT data FROM checkin_runs WHERE owner=? ORDER BY rowid DESC LIMIT 1').get(owner) as any;return row?JSON.parse(row.data):null}
 history(owner:string){return (this.db.prepare('SELECT data FROM checkin_runs WHERE owner=? ORDER BY rowid DESC LIMIT 30').all(owner) as any[]).map(r=>JSON.parse(r.data) as CheckinRun)}
 schedule(owner:string):CheckinSchedule{const row=this.db.prepare('SELECT data FROM checkin_settings WHERE owner=?').get(owner) as any;return row?normalizeSchedule(JSON.parse(row.data)):structuredClone(defaultCheckinSchedule)}
 saveSchedule(owner:string,s:CheckinSchedule){decimal(owner);const normalized=normalizeSchedule(s);this.db.prepare('INSERT INTO checkin_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner,JSON.stringify(normalized))}
 claimSlot(owner:string,slot:string){return Number(this.db.prepare('INSERT OR IGNORE INTO checkin_slots VALUES(?,?,?)').run(owner,slot,new Date().toISOString()).changes)>0}
 releaseSlot(owner:string,slot:string){this.db.prepare('DELETE FROM checkin_slots WHERE owner=? AND slot=?').run(owner,slot)}
 acquire(owner:string):()=>void {
  decimal(owner);const token=randomUUID();this.db.exec('BEGIN IMMEDIATE');try{const old=this.db.prepare('SELECT pid FROM checkin_locks WHERE owner=?').get(owner) as any;if(old){let alive=true;try{process.kill(old.pid,0)}catch(e:any){if(e.code==='ESRCH')alive=false}if(alive)throw Error('该账号已有打卡任务运行，请等待完成');}
   this.db.prepare('INSERT INTO checkin_locks VALUES(?,?,?) ON CONFLICT(owner) DO UPDATE SET pid=excluded.pid,token=excluded.token').run(owner,process.pid,token);this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e}
  return ()=>{this.db.prepare('DELETE FROM checkin_locks WHERE owner=? AND token=?').run(owner,token)};
 }
}
