import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {User,Row,Run,Review,makeRow,settingsDefaults,sanitizeSettings,cleanIds,uidValid,classify} from './domain';
import {GroupStore} from './group-store';
export class Store {
  db:DatabaseSync;
  groups:GroupStore;
  constructor(path:string){
    mkdirSync(dirname(path),{recursive:true});this.db=new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT);
      CREATE TABLE IF NOT EXISTS accounts(uid TEXT PRIMARY KEY,name TEXT,active_run TEXT);
      CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,owner_uid TEXT NOT NULL,phase TEXT NOT NULL,status TEXT NOT NULL,offset INTEGER DEFAULT 0,max_time INTEGER DEFAULT 0,pages INTEGER DEFAULT 0,started_at TEXT,updated_at TEXT,snapshot_at TEXT,message TEXT DEFAULT '',total_hint INTEGER DEFAULT 0,error_uid TEXT);
      CREATE INDEX IF NOT EXISTS runs_owner ON runs(owner_uid,started_at);
      CREATE TABLE IF NOT EXISTS members(run_id TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(run_id,uid));
      CREATE TABLE IF NOT EXISTS profiles(run_id TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,done INTEGER NOT NULL,PRIMARY KEY(run_id,uid));
      CREATE TABLE IF NOT EXISTS review(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,selected INTEGER DEFAULT 0,opened INTEGER DEFAULT 0,PRIMARY KEY(owner_uid,uid));
      CREATE TABLE IF NOT EXISTS review_meta(owner_uid TEXT PRIMARY KEY,settings TEXT DEFAULT '{}',last_batch TEXT DEFAULT '[]');
      CREATE TABLE IF NOT EXISTS history(owner_uid TEXT NOT NULL,uid TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner_uid,uid));`);
    this.groups=new GroupStore(this.db);
    if(!(this.db.prepare('PRAGMA table_info(profiles)').all() as any[]).some(c=>c.name==='videos_done'))this.db.exec('ALTER TABLE profiles ADD COLUMN videos_done INTEGER NOT NULL DEFAULT 0');
    this.db.exec("UPDATE runs SET phase='videos',status='paused',message='已有详情保留，点击继续补齐最新视频时间' WHERE status='completed' AND id!='seed-v3' AND id IN (SELECT active_run FROM accounts) AND EXISTS (SELECT 1 FROM profiles p WHERE p.run_id=runs.id AND p.done=1 AND p.videos_done=0)");
    this.db.prepare("UPDATE runs SET status='paused',message='上次任务中断，点击继续恢复' WHERE status IN ('running','cooldown')").run();
  }
  transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const r=fn();this.db.exec('COMMIT');return r;}catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
  owner():string{return (this.db.prepare("SELECT value FROM meta WHERE key='owner'").get() as any)?.value||'';}
  activate(uid:string,name=''){if(!uidValid(uid))throw Error('登录账号无效');this.db.prepare('INSERT INTO accounts(uid,name) VALUES(?,?) ON CONFLICT(uid) DO UPDATE SET name=excluded.name').run(uid,name);this.db.prepare("INSERT INTO meta(key,value) VALUES('owner',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(uid);}
  createRun(owner:string,total:number):Run{
    const id=randomUUID(),at=new Date().toISOString();
    this.transaction(()=>{this.db.prepare("UPDATE runs SET status='paused',message='已由新更新任务替代' WHERE owner_uid=? AND status!='completed'").run(owner);this.db.prepare("INSERT INTO runs(id,owner_uid,phase,status,started_at,updated_at,total_hint) VALUES(?,?,'following','running',?,?,?)").run(id,owner,at,at,total);});
    return this.run(id)!;
  }
  run(id:string):Run|null{return this.db.prepare('SELECT * FROM runs WHERE id=?').get(id) as unknown as Run||null;}
  latest(owner=this.owner()):Run|null{return this.db.prepare('SELECT * FROM runs WHERE owner_uid=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(owner) as unknown as Run||null;}
  update(id:string,patch:Partial<Run>){const keys=Object.keys(patch).filter(k=>['phase','status','offset','max_time','pages','snapshot_at','message','error_uid','total_hint'].includes(k));if(!keys.length)return;this.db.prepare(`UPDATE runs SET ${keys.map(k=>k+'=?').join(',')},updated_at=? WHERE id=?`).run(...keys.map(k=>(patch as any)[k]),new Date().toISOString(),id);}
  members(id:string):User[]{return (this.db.prepare('SELECT data FROM members WHERE run_id=? ORDER BY rowid').all(id) as any[]).map(x=>JSON.parse(x.data));}
  addPage(id:string,users:User[],next:{offset:number;max_time:number;pages:number},last:boolean){
    this.transaction(()=>{const put=this.db.prepare('INSERT OR IGNORE INTO members VALUES(?,?,?)');for(const u of users)put.run(id,u.uid,JSON.stringify(u));this.update(id,next);if(last){const r=this.run(id)!;this.update(id,{phase:'profiles',snapshot_at:new Date().toISOString()});this.db.prepare('UPDATE accounts SET active_run=? WHERE uid=?').run(id,r.owner_uid);}});
  }
  nextUser(id:string):User|null{const r=this.db.prepare('SELECT m.data FROM members m LEFT JOIN profiles p ON p.run_id=m.run_id AND p.uid=m.uid WHERE m.run_id=? AND COALESCE(p.done,0)=0 ORDER BY m.rowid LIMIT 1').get(id) as any;return r?JSON.parse(r.data):null;}
  saveRow(id:string,row:Row,done=true){this.transaction(()=>{this.db.prepare('INSERT INTO profiles(run_id,uid,data,done) VALUES(?,?,?,?) ON CONFLICT(run_id,uid) DO UPDATE SET data=excluded.data,done=excluded.done').run(id,row.uid,JSON.stringify(row),done?1:0);this.update(id,{error_uid:null});});}
  nextVideos(id:string):{user:User;row:Row}|null{const v=this.db.prepare('SELECT m.data member,p.data profile FROM members m JOIN profiles p ON m.run_id=p.run_id AND m.uid=p.uid WHERE m.run_id=? AND p.done=1 AND p.videos_done=0 ORDER BY m.rowid LIMIT 1').get(id) as any;return v?{user:JSON.parse(v.member),row:JSON.parse(v.profile)}:null;}
  saveVideos(id:string,uid:string,times:string[],status:string){this.transaction(()=>{const p=this.db.prepare('SELECT data FROM profiles WHERE run_id=? AND uid=?').get(id,uid) as any;if(!p)throw Error('账号详情尚未保存');const row={...JSON.parse(p.data),recent_video_times:times,recent_videos_status:status,videos_checked_at:new Date().toISOString()};this.db.prepare('UPDATE profiles SET data=?,videos_done=1 WHERE run_id=? AND uid=?').run(JSON.stringify(row),id,uid);this.update(id,{error_uid:null});});}
  progress(id:string){return {total:Number((this.db.prepare('SELECT count(*) n FROM members WHERE run_id=?').get(id) as any).n),completed:Number((this.db.prepare('SELECT count(*) n FROM profiles WHERE run_id=? AND done=1').get(id) as any).n),videos:Number((this.db.prepare('SELECT count(*) n FROM profiles WHERE run_id=? AND videos_done=1').get(id) as any).n)};}
  profileTarget(sec:string):Row|null{const x=this.db.prepare("SELECT m.data member,p.data profile FROM accounts a JOIN members m ON m.run_id=a.active_run LEFT JOIN profiles p ON p.run_id=m.run_id AND p.uid=m.uid WHERE a.uid=? AND json_extract(m.data,'$.sec_uid')=? LIMIT 1").get(this.owner(),sec) as any;return x?(x.profile?JSON.parse(x.profile):makeRow(JSON.parse(x.member))):this.groups.users(this.owner()).find(r=>r.sec_uid===sec)||null}
  snapshot(owner=this.owner()){
    const a=this.db.prepare('SELECT * FROM accounts WHERE uid=?').get(owner) as any;
    const run=a?.active_run?this.run(a.active_run):null;
    const rows:Row[]=run?(this.db.prepare('SELECT m.data member,p.data profile FROM members m LEFT JOIN profiles p ON p.run_id=m.run_id AND p.uid=m.uid WHERE m.run_id=? ORDER BY m.rowid').all(run.id) as any[]).map(x=>x.profile?JSON.parse(x.profile):makeRow(JSON.parse(x.member))):[];
    const memberships=this.groups.rows(owner);for(const row of rows)Object.assign(row,memberships.get(row.uid)||{groups:[],groups_status:'unknown',groups_checked_at:null,groups_stale:false});
    const knownIds=new Set(rows.map(r=>r.uid)),groupRows=this.groups.users(owner).filter(r=>!knownIds.has(r.uid));for(const row of groupRows)Object.assign(row,memberships.get(row.uid)||{groups:[],groups_status:'unknown'});
    const decisions=rows.map(r=>classify(r,settingsDefaults).state);
    const profileTime=rows.reduce((latest,r)=>Math.max(latest,Date.parse(r.checked_at||'')||0),0);
    const videoTime=rows.reduce((latest,r)=>Math.max(latest,Date.parse(r.videos_checked_at||'')||0),0);
    return {group_catalog:this.groups.state(owner).groups,group_rows:groupRows,summary:{version:4,account_uid:owner,account_name:a?.name||'',total:rows.length,source_label:run?.id==='seed-v3'?'导入的历史关注名单':'当前关注名单（最近一次完整同步）',following_snapshot_at:run?.snapshot_at||null,profiles_updated_at:profileTime?new Date(profileTime).toISOString():run?.id==='seed-v3'?run.updated_at:null,videos_updated_at:videoTime?new Date(videoTime).toISOString():null,generated_at:new Date().toISOString(),profiles_refreshed:run?this.progress(run.id).completed:0,refresh_complete:run?.status==='completed',works_verified:rows.filter(r=>r.works_count!==null).length,matches:decisions.filter(x=>x==='match').length,pending:decisions.filter(x=>x==='pending').length,excluded:decisions.filter(x=>x==='excluded').length,mutual_count:rows.filter(r=>r.mutual_follow===true).length},rows,review:this.getReview(owner)};
  }
  getReview(owner=this.owner()):Review{
    const all=this.db.prepare('SELECT * FROM review WHERE owner_uid=?').all(owner) as any[];
    const m=this.db.prepare('SELECT * FROM review_meta WHERE owner_uid=?').get(owner) as any;
    return {selected:all.filter(r=>r.selected).map(r=>r.uid),opened:all.filter(r=>r.opened).map(r=>r.uid),settings:{...settingsDefaults,...(m?JSON.parse(m.settings):{})},lastBatch:m?JSON.parse(m.last_batch):[]};
  }
  reviewDelta(owner:string,d:any){
    if(!uidValid(owner)||!this.db.prepare('SELECT 1 FROM accounts WHERE uid=?').get(owner))throw Error('记录账号无效');
    this.transaction(()=>{
      if(d.select){const ids=cleanIds(d.select.ids);if(typeof d.select.value!=='boolean')throw Error('勾选记录无效');const q=this.db.prepare('INSERT INTO review(owner_uid,uid,selected) VALUES(?,?,?) ON CONFLICT(owner_uid,uid) DO UPDATE SET selected=excluded.selected');for(const id of ids)q.run(owner,id,d.select.value?1:0);}
      if(d.clearSelected===true)this.db.prepare('UPDATE review SET selected=0 WHERE owner_uid=?').run(owner);
      if(d.opened){const q=this.db.prepare('INSERT INTO review(owner_uid,uid,opened) VALUES(?,?,1) ON CONFLICT(owner_uid,uid) DO UPDATE SET opened=1');for(const id of cleanIds(d.opened))q.run(owner,id);}
      if(d.settings||d.lastBatch){this.db.prepare('INSERT OR IGNORE INTO review_meta(owner_uid) VALUES(?)').run(owner);if(d.settings){const old=this.getReview(owner).settings;this.db.prepare('UPDATE review_meta SET settings=? WHERE owner_uid=?').run(JSON.stringify({...old,...sanitizeSettings(d.settings)}),owner);}if(d.lastBatch)this.db.prepare('UPDATE review_meta SET last_batch=? WHERE owner_uid=?').run(JSON.stringify(cleanIds(d.lastBatch).slice(0,10)),owner);}
    });
  }
  importReview(owner:string,data:any){
    if(data.account_uid!==owner)throw Error('使用记录属于另一个抖音账号，请登录对应账号后导入');
    const r=data.review||data;
    const hasUsage=!!(this.db.prepare('SELECT EXISTS(SELECT 1 FROM review WHERE owner_uid=?) OR EXISTS(SELECT 1 FROM review_meta WHERE owner_uid=?) AS used').get(owner,owner) as any).used;
    this.reviewDelta(owner,{select:{ids:cleanIds(r.selected||[]),value:true},opened:cleanIds(r.opened||[]),...(!hasUsage?{settings:sanitizeSettings(r.settings),lastBatch:cleanIds(r.lastBatch||[])}:{})});
    return this.getReview(owner);
  }
}
