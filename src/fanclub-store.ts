import {DatabaseSync} from 'node:sqlite';
import {FanAnchor,FanRun,FanUser} from './fanclub';
export class FanStore {
  constructor(private db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS fan_anchors(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner_uid,uid));CREATE TABLE IF NOT EXISTS fan_runs(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL,data TEXT NOT NULL);CREATE INDEX IF NOT EXISTS fan_runs_owner ON fan_runs(owner_uid);`);for(const r of db.prepare('SELECT id,data FROM fan_runs').all() as any[]){const run=JSON.parse(r.data) as FanRun;if(['running','cooldown'].includes(run.status)){run.status='paused';run.message='上次查询中断，点击继续恢复';this.save(run)}}}
  anchors(owner:string):FanAnchor[]{return (this.db.prepare('SELECT data FROM fan_anchors WHERE owner_uid=? ORDER BY rowid').all(owner) as any[]).map(r=>JSON.parse(r.data))}
  add(owner:string,user:FanUser,remark=''){const old=this.anchors(owner).find(a=>a.uid===user.uid);const a:FanAnchor={...user,remark:old?.remark||remark.slice(0,200),selected:old?.selected??true};this.db.prepare('INSERT INTO fan_anchors VALUES(?,?,?) ON CONFLICT(owner_uid,uid) DO UPDATE SET data=excluded.data').run(owner,a.uid,JSON.stringify(a));return a}
  edit(owner:string,uid:string,patch:{remark?:string;selected?:boolean}){const a=this.anchors(owner).find(a=>a.uid===uid);if(!a)throw Error('主播已删除');if(typeof patch.remark==='string')a.remark=patch.remark.slice(0,200);if(typeof patch.selected==='boolean')a.selected=patch.selected;this.db.prepare('UPDATE fan_anchors SET data=? WHERE owner_uid=? AND uid=?').run(JSON.stringify(a),owner,uid)}
  remove(owner:string,uid:string){this.db.prepare('DELETE FROM fan_anchors WHERE owner_uid=? AND uid=?').run(owner,uid)}
  save(run:FanRun){run.updated_at=new Date().toISOString();this.db.prepare('INSERT INTO fan_runs VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(run.id,run.owner_uid,JSON.stringify(run))}
  latest(owner:string):FanRun|null{const r=this.db.prepare('SELECT data FROM fan_runs WHERE owner_uid=? ORDER BY rowid DESC LIMIT 1').get(owner) as any;return r?JSON.parse(r.data):null}
}
