export type User = { uid: string; sec_uid: string; nickname?: string; unique_id?: string; short_id?: string; follower_count?: number; following_count?: number; follow_status?: number; secret?: number };
export type Row = { uid: string; sec_uid: string; nickname: string; account: string; follower_count: number|null; following_count: number|null; works_count: number|null; works_status: string; mutual_follow: boolean|null; follow_status: number|null; following_minus_followers: number|null; profile_url: string; checked_at: string|null; profile_status: string; following_state: string; recent_video_times?:string[]; recent_videos_status?:string; videos_checked_at?:string; [key:string]: unknown };
export type Review = { selected: string[]; opened: string[]; lastBatch: string[]; settings: Record<string,string|boolean> };
export type Status = 'running'|'paused'|'waiting_login'|'waiting_verification'|'cooldown'|'error'|'completed';
export type Run = { id:string; owner_uid:string; phase:'following'|'profiles'|'videos'; status:Status; offset:number; max_time:number; pages:number; started_at:string; updated_at:string; snapshot_at:string|null; message:string; total_hint:number; error_uid:string|null };
export const settingsDefaults: Record<string,string|boolean> = {fans:'10000','fans-min':'','works-limit':'20','works-min':'','days-min':'','days-max':'',logic:'or',mutual:'',decision:'match','works-state':'','opened-state':'',sort:'difference_desc','following-greater':false,search:'','batch-size':'5'};
export const uidValid = (s:unknown): s is string => typeof s==='string' && /^\d{1,32}$/.test(s);
export const count = (x:unknown):number|null => typeof x==='number' && Number.isSafeInteger(x) && x>=0 ? x:null;
export function cleanUser(x:any):User {
  if(!x || !uidValid(x.uid) || typeof x.sec_uid!=='string' || !/^[A-Za-z0-9_-]{8,200}$/.test(x.sec_uid)) throw new Error('接口返回的账号身份不完整');
  const u:User={uid:x.uid,sec_uid:x.sec_uid};
  for(const key of ['nickname','unique_id','short_id'] as const) if(typeof x[key]==='string')u[key]=x[key].slice(0,300);
  for(const key of ['follower_count','following_count','follow_status','secret'] as const) if(count(x[key])!==null)u[key]=x[key];
  return u;
}
export function makeRow(u:User,p?:any,failed=false):Row {
  if(p && String(p.uid)!==u.uid) throw new Error('账号身份不匹配，已停止采集');
  const fans=count(p?.follower_count)??count(u.follower_count), following=p?count(p.following_count):null;
  const secret=p?.secret??u.secret;
  const works_status=secret!==0?(secret===1?'private':'privacy_unknown'):!p?(failed?'request_failed':'not_checked'):count(p.aweme_count)===null?'missing_count':'verified';
  const works=works_status==='verified'?count(p.aweme_count):null;
  const follow=count(p?.follow_status??u.follow_status);
  return {uid:u.uid,sec_uid:u.sec_uid,nickname:typeof p?.nickname==='string'?p.nickname:u.nickname||'',account:u.unique_id||u.short_id||u.uid,follower_count:fans,following_count:following,works_count:works,works_status,mutual_follow:follow===2?true:follow===1?false:null,follow_status:follow,following_minus_followers:fans!==null&&following!==null?following-fans:null,profile_url:'https://www.douyin.com/user/'+u.sec_uid,checked_at:p?new Date().toISOString():null,profile_status:p?'ok':failed?'request_failed':'not_checked',following_state:'关注中（名单同步时）'};
}
export function sanitizeSettings(input:any):Record<string,string|boolean> {
  const out:Record<string,string|boolean>={};
  if(!input || typeof input!=='object')return out;
  for(const key of Object.keys(settingsDefaults)) {
    const v=input[key];
    if(typeof v===typeof settingsDefaults[key] && (typeof v==='boolean'||v.length<=300))out[key]=v;
  }
  return out;
}
export function cleanIds(ids:any):string[]{if(!Array.isArray(ids)||ids.length>100000)throw Error('记录格式无效');return [...new Set(ids.filter(uidValid))];}
export function classify(row:Row,settings:Record<string,string|boolean>){
  const values:{label:string;value:boolean|null}[]=[];
  for(const [id,key,op,label] of [['fans','follower_count','lt','粉丝'],['fans-min','follower_count','gt','粉丝'],['works-limit','works_count','lt','作品'],['works-min','works_count','gt','作品']]){
    const raw=String(settings[id]??'').trim();if(!raw)continue;const n=Number(raw);
    if(!Number.isSafeInteger(n)||n<0)throw Error('阈值请输入非负整数');
    const v=row[key] as number|null;values.push({label:`${label} ${op==='gt'?'>':'<'} ${n.toLocaleString('zh-CN')}`,value:v===null?null:op==='gt'?v>n:v<n});
  }
  if(settings['following-greater'])values.push({label:'关注 > 粉丝',value:row.following_count===null||row.follower_count===null?null:row.following_count>row.follower_count});
  const vals=values.map(x=>x.value);const state=!vals.length?'match':settings.logic==='and'?(vals.includes(false)?'excluded':vals.includes(null)?'pending':'match'):(vals.includes(true)?'match':vals.includes(null)?'pending':'excluded');
  return {state,matched:values.filter(x=>x.value===true).map(x=>x.label)};
}
// China calendar days, so midnight and future clock errors have explicit behavior.
export function latestAge(row:Pick<Row,'recent_video_times'>,now=Date.now()):number|null{
  const dates=row.recent_video_times;if(!Array.isArray(dates)||!dates.length)return null;
  const t=Date.parse(dates[0]);if(!Number.isFinite(t)||t>now+60000)return null;
  return Math.max(0,Math.floor((now+28800000)/86400000)-Math.floor((t+28800000)/86400000));
}
export function matchesAge(age:number|null,settings:Record<string,string|boolean>):boolean{
  let match=true;for(const [key,op] of [['days-min','gt'],['days-max','lt']]){const raw=String(settings[key]??'').trim();if(!raw)continue;const n=Number(raw);if(!Number.isSafeInteger(n)||n<0)throw Error('发布时间天数请输入非负整数');if(age===null||(op==='gt'?age<=n:age>=n))match=false;}return match;
}
