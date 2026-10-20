import tls from 'node:tls';
import {randomUUID,createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CheckinRun} from './checkin-domain';
import {chinaDate} from './checkin-schedule';

export type MailSettings={enabled:boolean;from:string;to:string[];cooldown_minutes:number;include_unavailable:boolean};
export type MailAuth={from:string;auth_code:string};
export type MailMessage={id:string;subject:string;body:string};
export const defaultMailSettings:MailSettings={enabled:false,from:'',to:[],cooldown_minutes:60,include_unavailable:false};
const email=(v:unknown)=>typeof v==='string'&&v.length<=254&&/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(v);
export function mailSettings(raw:any):MailSettings{
 if(!raw)return structuredClone(defaultMailSettings);
 if(typeof raw.enabled!=='boolean')throw Error('邮件告警开关无效');
 const from=typeof raw.from==='string'?raw.from.trim().toLowerCase():'',to=Array.isArray(raw.to)?[...new Set<string>(raw.to.map((x:any)=>typeof x==='string'?x.trim().toLowerCase():''))]:[];
 const minutes=raw.cooldown_minutes??60;
 if(from&&(!email(from)||!/@(qq|foxmail)\.com$/.test(from)))throw Error('请填写完整的 QQ 或 Foxmail 发件邮箱');
 if(to.length>5||to.some(v=>!email(v)))throw Error('收件邮箱格式无效，最多设置 5 个');
 if(raw.enabled&&(!from||!to.length))throw Error('启用告警需要填写发件邮箱和收件邮箱');
 if(!Number.isInteger(minutes)||minutes<10||minutes>1440)throw Error('同类告警间隔应为 10 至 1440 分钟');
 return {enabled:raw.enabled,from,to,cooldown_minutes:minutes,include_unavailable:raw.include_unavailable===true};
}
export function mailAuth(raw:any,from:string):MailAuth{
 if(!email(from)||!/@(qq|foxmail)\.com$/.test(from)||raw?.version!==1||raw.from!==from||typeof raw.auth_code!=='string'||!/^\S{8,128}$/.test(raw.auth_code)||/[\x00-\x20\x7f]/.test(raw.auth_code))throw new MailError('AUTH_CONFIG','邮件认证缺失或与发件邮箱不匹配，请重新配置 SMTP 授权码');
 return {from,auth_code:raw.auth_code};
}
export class MailError extends Error{constructor(public code:string,message:string,public uncertain=false){super(message)}}
const encoded=(s:string)=>{const chunks:string[]=[];let part='';for(const ch of s){if(Buffer.byteLength(part+ch)>42){chunks.push(part);part=''}part+=ch}if(part)chunks.push(part);return chunks.map(p=>'=?UTF-8?B?'+Buffer.from(p).toString('base64')+'?=').join('\r\n ')};
export function mailContent(auth:MailAuth,to:string[],m:MailMessage,now=Date.now()){
 if(!email(auth.from)||to.some(v=>!email(v))||!to.length||to.length>5||!/^[-a-zA-Z0-9]{1,80}$/.test(m.id)||/[\r\n]/.test(m.subject)||m.subject.length>150||Buffer.byteLength(m.body)>100000)throw new MailError('MESSAGE','邮件内容或地址无效');
 return ['From: '+auth.from,'To: '+to.join(',\r\n '),'Subject: '+encoded(m.subject),'Date: '+new Date(now).toUTCString(),'Message-ID: <'+m.id+'@'+auth.from.split('@')[1]+'>','MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(m.body).toString('base64').match(/.{1,76}/g)?.join('\r\n')||'',''].join('\r\n');
}
// Fixed QQ endpoint, implicit TLS with hostname/certificate checks; no cookies or debug logs.
export async function sendQQMail(auth:MailAuth,to:string[],message:MailMessage,options:{connect?:()=>tls.TLSSocket;timeoutMs?:number}={}):Promise<void>{
 const content=mailContent(auth,to,message);mailAuth({version:1,...auth},auth.from);
 const socket=options.connect?options.connect():tls.connect({host:'smtp.qq.com',port:465,servername:'smtp.qq.com',rejectUnauthorized:true,minVersion:'TLSv1.2'});
 let submitted=false,accepted=false,failed:MailError|undefined,buffer='',lines:string[]=[],code=0;
 const replies:{code:number;lines:string[]}[]=[],waiters:{resolve:(r:{code:number;lines:string[]})=>void;reject:(e:Error)=>void}[]=[];
 const fail=(e:MailError)=>{if(failed)return;failed=e;while(waiters.length)waiters.shift()!.reject(e);socket.destroy()};
 const deadline=setTimeout(()=>fail(new MailError('TIMEOUT','连接 QQ 邮箱超时，请检查网络及 465 端口',submitted&&!accepted)),options.timeoutMs??45000);
 socket.setEncoding('utf8');socket.on('error',()=>fail(new MailError('CONNECTION','QQ 邮箱连接失败，请检查网络、证书和 465 端口',submitted&&!accepted)));socket.on('close',()=>{if(!accepted)fail(new MailError('CLOSED','QQ 邮箱连接中断',submitted))});
 socket.on('data',chunk=>{buffer+=chunk;if(buffer.length>65536){fail(new MailError('PROTOCOL','QQ 邮箱响应格式异常',submitted));return}let index;
  while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);const match=line.match(/^(\d{3})([- ])(.*)$/);if(!match||lines.length>=100){fail(new MailError('PROTOCOL','QQ 邮箱响应格式异常',submitted));return}const next=Number(match[1]);if(code&&next!==code){fail(new MailError('PROTOCOL','QQ 邮箱响应格式异常',submitted));return}code=next;lines.push(match[3]);if(match[2]===' '){const reply={code,lines};code=0;lines=[];const waiter=waiters.shift();if(waiter)waiter.resolve(reply);else if(replies.length<20)replies.push(reply);else fail(new MailError('PROTOCOL','QQ 邮箱响应过多',submitted))}}
 });
 const read=()=>failed?Promise.reject(failed):replies.length?Promise.resolve(replies.shift()!):new Promise<{code:number;lines:string[]}>((resolve,reject)=>waiters.push({resolve,reject}));
 const expect=async(wanted:number,command?:string)=>{if(failed)throw failed;if(command!==undefined)socket.write(command+'\r\n');const r=await read();if(r.code!==wanted)throw new MailError(r.code===535?'AUTH':'REJECTED',r.code===535?'QQ 邮箱认证失败，请开启 SMTP 并替换授权码':'QQ 邮箱未接受邮件（状态 '+r.code+'），请检查邮箱服务与收件地址');return r};
 try{
  await expect(220);const greeting=await expect(250,'EHLO douyin-organizer.local');if(!greeting.lines.some(s=>/^AUTH[ =].*\bLOGIN\b/i.test(s)))throw new MailError('AUTH','QQ 邮箱未提供受支持的认证方式');
  await expect(334,'AUTH LOGIN');await expect(334,Buffer.from(auth.from).toString('base64'));await expect(235,Buffer.from(auth.auth_code).toString('base64'));
  await expect(250,'MAIL FROM:<'+auth.from+'>');for(const recipient of to)await expect(250,'RCPT TO:<'+recipient+'>');await expect(354,'DATA');submitted=true;await expect(250,content+'.');accepted=true;socket.end('QUIT\r\n');
 }catch(e){if(e instanceof MailError)throw e;throw new MailError('SEND','发送邮件失败',submitted&&!accepted)}finally{clearTimeout(deadline);socket.destroy()}
}

export type AlertRecord={key:string;run_id:string;state:'sending'|'sent'|'failed'|'unknown';at:string;message:string;message_id:string;next_at:number;pid:number};
export class CheckinMailStore{
 constructor(private db:DatabaseSync){db.exec('CREATE TABLE IF NOT EXISTS checkin_mail_settings(owner TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS checkin_mail_alerts(owner TEXT NOT NULL,key TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(owner,key));')}
 settings(owner:string):MailSettings{const r=this.db.prepare('SELECT data FROM checkin_mail_settings WHERE owner=?').get(owner) as any;return r?mailSettings(JSON.parse(r.data)):structuredClone(defaultMailSettings)}
 saveSettings(owner:string,s:MailSettings){this.db.prepare('INSERT INTO checkin_mail_settings VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET data=excluded.data').run(owner,JSON.stringify(mailSettings(s)))}
 latest(owner:string):AlertRecord|null{const r=this.db.prepare("SELECT data FROM checkin_mail_alerts WHERE owner=? ORDER BY json_extract(data,'$.at') DESC,rowid DESC LIMIT 1").get(owner) as any;return r?JSON.parse(r.data):null}
 private get(owner:string,key:string):AlertRecord|null{const r=this.db.prepare('SELECT data FROM checkin_mail_alerts WHERE owner=? AND key=?').get(owner,key) as any;return r?JSON.parse(r.data):null}
 private put(owner:string,r:AlertRecord){this.db.prepare('INSERT INTO checkin_mail_alerts VALUES(?,?,?) ON CONFLICT(owner,key) DO UPDATE SET data=excluded.data').run(owner,r.key,JSON.stringify(r))}
 claim(owner:string,key:string,run:string,cooldown:number,now:number):AlertRecord|null{
  this.db.exec('BEGIN IMMEDIATE');try{const old=this.get(owner,key);if(old?.state==='sending'){let alive=true;try{process.kill(old.pid,0)}catch(e:any){if(e.code==='ESRCH')alive=false}if(!alive){old.state='unknown';old.message='上次发信中断，送达情况未知；为避免重复，不自动重发同一告警';this.put(owner,old)}this.db.exec('COMMIT');return null}
   if(old&&(old.state==='unknown'||old.next_at>now)){this.db.exec('COMMIT');return null}
   const r:AlertRecord={key,run_id:run,state:'sending',at:new Date(now).toISOString(),message:'正在发送失败告警',message_id:randomUUID(),next_at:now+cooldown*60000,pid:process.pid};this.put(owner,r);this.db.exec('COMMIT');return r;
  }catch(e){this.db.exec('ROLLBACK');throw e}
 }
 finish(owner:string,r:AlertRecord,state:AlertRecord['state'],message:string){const current=this.get(owner,r.key);if(current?.message_id!==r.message_id)return;r.state=state;r.message=message;this.put(owner,r)}
}
const reason=(code?:string)=>({LOGIN:'抖音认证失效，请重新登录并替换认证',CAPTCHA:'需要人工完成抖音验证码',RATE_LIMIT:'接口限流，请稍后继续',RETRY:'连续读取失败，任务已暂停',NETWORK:'网络请求失败',EMPTY:'接口返回空响应',SCHEMA:'接口数据结构异常',CLOCK:'时间或日期校验失败',IDENTITY:'返回账号身份不匹配',STALE:'认证或页面状态已变化',CONFIG:'无法读取打卡认证文件，请检查路径、格式与权限'}[code||'']||'任务中断或部分项目失败，请打开执行记录查看');
const itemLabels:Record<string,string>={failed:'读取失败',unknown:'结果未知',sending:'提交未确认',needs_join:'需要先加入圈子',unsupported:'暂不支持'};
export function failureMail(r:CheckinRun,settings:MailSettings,now=Date.now()):{key:string;subject:string;body:string}|null{
 if(r.mode!=='sign'||r.status==='running'||['PAUSED','ACCOUNT_CHANGED'].includes(r.error_code||''))return null;
 const bad=r.items.filter(i=>['failed','unknown','sending'].includes(i.state)||settings.include_unavailable&&['needs_join','unsupported'].includes(i.state));
 if(r.status==='completed'&&!bad.length)return null;
 const day=r.day||chinaDate(now),code=r.error_code||r.status,key=createHash('sha256').update(JSON.stringify([r.owner,day,code,bad.map(i=>[i.club.key,i.state]).sort()])).digest('hex');
 const clean=(s:string)=>s.replace(/[\x00-\x1f\x7f]/g,' ').replace(/https?:\/\/\S+/g,'[链接省略]').slice(0,80);
 const body=['粉丝团打卡需要处理','账号 UID：'+r.owner,'记录日期：'+day,'发现时间：'+new Date(now).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})+'（北京时间）','任务：'+r.id,'状态：'+r.status,'原因：'+reason(r.error_code),'已确认签到：'+r.items.filter(i=>i.state==='signed').length+' / '+r.items.length,'失败或待处理项目：'+bad.length,...bad.slice(0,50).map(i=>'- '+clean(i.club.name)+'：'+(itemLabels[i.state]||i.state)),...(bad.length>50?['其余 '+(bad.length-50)+' 项请查看本地打卡记录']:[]),'','邮件不包含登录 Cookie、邮箱授权码或完整接口响应。未确认的签到应先回读，不能重复盲目提交。'];
 return {key,subject:'[抖音整理箱] 粉丝团打卡失败告警 '+day,body:body.join('\n')};
}
export class CheckinAlerts{
 constructor(public store:CheckinMailStore,private config:(owner:string)=>MailSettings,private auth:(owner:string,from:string)=>Promise<MailAuth>,private send=sendQQMail,private changed:()=>void=()=>{},private now=Date.now){}
 async report(r:CheckinRun){const config=this.config(r.owner);if(!config.enabled)return;const summary=failureMail(r,config,this.now());if(!summary)return;const record=this.store.claim(r.owner,summary.key,r.id,config.cooldown_minutes,this.now());if(!record)return;this.changed();
  try{const auth=await this.auth(r.owner,config.from);await this.send(auth,config.to,{id:record.message_id,subject:summary.subject,body:summary.body});this.store.finish(r.owner,record,'sent','QQ 邮箱已接受告警邮件，请检查收件箱及垃圾箱')}
  catch(e){this.store.finish(r.owner,record,e instanceof MailError&&e.uncertain?'unknown':'failed',e instanceof MailError?e.message:'告警邮件发送失败，请检查邮箱配置；打卡记录已保留')}
  this.changed();
 }
 async test(owner:string){const config=this.config(owner);if(!config.from||!config.to.length)throw Error('请先保存发件邮箱和收件邮箱');const record=this.store.claim(owner,'test:'+randomUUID(),'test',10,this.now())!;this.changed();try{await this.send(await this.auth(owner,config.from),config.to,{id:record.message_id,subject:'[抖音整理箱] 邮件告警测试',body:'这是一封由你主动触发的测试邮件。\n邮件发送功能已被 QQ 邮箱接受；此操作没有执行粉丝团签到。'});this.store.finish(owner,record,'sent','QQ 邮箱已接受测试邮件，请检查收件箱及垃圾箱')}catch(e){this.store.finish(owner,record,e instanceof MailError&&e.uncertain?'unknown':'failed',e instanceof MailError?e.message:'测试邮件发送失败，请检查邮箱配置');throw new Error(this.store.latest(owner)?.message||'邮件发送失败')}finally{this.changed()}}
}
