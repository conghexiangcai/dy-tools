import {DatabaseSync} from 'node:sqlite';
import {DownloadFile,DownloadRun,storedWork} from './download-domain';
export class DownloadStore{
 constructor(private db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS download_runs(id TEXT PRIMARY KEY,owner TEXT NOT NULL,data TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS download_runs_owner ON download_runs(owner,updated_at);
 CREATE TABLE IF NOT EXISTS download_files(owner TEXT NOT NULL,file_key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,file_key));
 CREATE TABLE IF NOT EXISTS download_settings(owner TEXT PRIMARY KEY,directory TEXT NOT NULL);`);
 for(const row of db.prepare('SELECT data FROM download_runs').all() as any[]){const run=JSON.parse(row.data) as DownloadRun;if(['running','cooldown'].includes(run.status)){run.status='paused';run.message='上次下载中断，点击继续';for(const i of run.items)if(i.state==='downloading')i.state='pending';this.save(run)}}
 }
 save(r:DownloadRun){const copy={...r,updated_at:new Date().toISOString(),items:r.items.map(i=>({...i,work:storedWork(i.work)}))};this.db.prepare('INSERT INTO download_runs VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at').run(r.id,r.owner,JSON.stringify(copy),copy.updated_at)}
 run(owner:string,id:string):DownloadRun|null{const r=this.db.prepare('SELECT data FROM download_runs WHERE owner=? AND id=?').get(owner,id) as any;return r?JSON.parse(r.data):null}
 runs(owner:string):DownloadRun[]{return (this.db.prepare('SELECT data FROM download_runs WHERE owner=? ORDER BY updated_at DESC,rowid DESC LIMIT 50').all(owner) as any[]).map(r=>JSON.parse(r.data))}
 file(owner:string,key:string):DownloadFile|null{const r=this.db.prepare('SELECT data FROM download_files WHERE owner=? AND file_key=?').get(owner,key) as any;return r?JSON.parse(r.data):null}
 saveFile(owner:string,f:DownloadFile){this.db.prepare('INSERT INTO download_files VALUES(?,?,?) ON CONFLICT(owner,file_key) DO UPDATE SET data=excluded.data').run(owner,f.key,JSON.stringify(f))}
 directory(owner:string){return (this.db.prepare('SELECT directory FROM download_settings WHERE owner=?').get(owner) as any)?.directory as string|undefined}
 setDirectory(owner:string,directory:string){this.db.prepare('INSERT INTO download_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET directory=excluded.directory').run(owner,directory)}
}
