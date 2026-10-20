import {DatabaseSync} from 'node:sqlite';
import {Group,groupIds} from './groups';
import {User,makeRow} from './domain';
export class GroupStore {
  constructor(private db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS group_catalog(owner_uid TEXT PRIMARY KEY,data TEXT NOT NULL DEFAULT '[]',checked_at TEXT,error TEXT NOT NULL DEFAULT '');
    CREATE TABLE IF NOT EXISTS group_membership(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,ids TEXT NOT NULL,checked_at TEXT NOT NULL,PRIMARY KEY(owner_uid,uid));
    CREATE TABLE IF NOT EXISTS group_user(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner_uid,uid));`)}
  state(owner:string){const r=this.db.prepare('SELECT * FROM group_catalog WHERE owner_uid=?').get(owner) as any;return {groups:r?JSON.parse(r.data) as Group[]:[],checked_at:r?.checked_at||null,error:r?.error||''}}
  failed(owner:string,message:string){this.db.prepare('INSERT INTO group_catalog(owner_uid,error) VALUES(?,?) ON CONFLICT(owner_uid) DO UPDATE SET error=excluded.error').run(owner,message)}
  needsMemberDetails(owner:string){const s=this.state(owner);return s.groups.some(g=>g.member_count>0)&&!(this.db.prepare('SELECT 1 FROM group_user WHERE owner_uid=? LIMIT 1').get(owner))}
  complete(owner:string,groups:Group[],mapping:Map<string,string[]>,users:Map<string,User>=new Map()){
    const at=new Date().toISOString();this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare("INSERT INTO group_catalog VALUES(?,?,?,'') ON CONFLICT(owner_uid) DO UPDATE SET data=excluded.data,checked_at=excluded.checked_at,error=''").run(owner,JSON.stringify(groups),at);
      this.db.prepare("UPDATE group_membership SET ids='[]',checked_at=? WHERE owner_uid=?").run(at,owner);
      const put=this.db.prepare('INSERT INTO group_membership VALUES(?,?,?,?) ON CONFLICT(owner_uid,uid) DO UPDATE SET ids=excluded.ids,checked_at=excluded.checked_at');for(const [uid,ids] of mapping)put.run(owner,uid,JSON.stringify(groupIds(ids)),at);
      const putUser=this.db.prepare('INSERT INTO group_user VALUES(?,?,?) ON CONFLICT(owner_uid,uid) DO UPDATE SET data=excluded.data');for(const [uid,user] of users)putUser.run(owner,uid,JSON.stringify(user));
      this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  target(owner:string,uid:string,groups:Group[],ids:string[]){
    // A target read is not a complete all-member sync; retain the full-sync timestamp/error.
    this.db.exec('BEGIN IMMEDIATE');try{
      this.db.prepare('INSERT INTO group_catalog(owner_uid,data) VALUES(?,?) ON CONFLICT(owner_uid) DO UPDATE SET data=excluded.data').run(owner,JSON.stringify(groups));
      this.db.prepare('INSERT INTO group_membership VALUES(?,?,?,?) ON CONFLICT(owner_uid,uid) DO UPDATE SET ids=excluded.ids,checked_at=excluded.checked_at').run(owner,uid,JSON.stringify(groupIds(ids)),new Date().toISOString());this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e}
  }
  rows(owner:string){const state=this.state(owner),names=new Map(state.groups.map(g=>[g.id,g.name]));return new Map((this.db.prepare('SELECT * FROM group_membership WHERE owner_uid=?').all(owner) as any[]).map(r=>{
    const ids=JSON.parse(r.ids) as string[],valid=ids.every(id=>names.has(id));return [r.uid,{groups:ids.map(id=>({id,name:names.get(id)||'已变更分组'})),groups_status:valid?'known':'unknown',groups_checked_at:r.checked_at,groups_stale:!!state.error||!valid}];
  }))}
  users(owner:string){return (this.db.prepare('SELECT u.data FROM group_user u JOIN group_membership m ON u.owner_uid=m.owner_uid AND u.uid=m.uid WHERE u.owner_uid=? AND m.ids!=?').all(owner,'[]') as any[]).map(x=>{const row=makeRow(JSON.parse(x.data));row.following_state='分组成员（当前关注快照未包含）';return row})}
}
