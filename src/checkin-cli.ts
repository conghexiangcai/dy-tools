import {readFileSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {CheckinHTTP,parseCheckinAuth} from './checkin-wire';
import {CheckinStore} from './checkin-store';
import {CheckinService} from './checkin-service';
import {normalizeSchedule,scheduleSlot,scheduleTimes} from './checkin-schedule';
import {CheckinAlerts,CheckinMailStore,MailError,mailAuth,mailSettings} from './checkin-mail';
import {CheckinRun} from './checkin-domain';
export function loadCheckinConfig(file:string){const c=JSON.parse(readFileSync(file,'utf8'));if(c.version!==1||typeof c.credentials_file!=='string'||typeof c.data_file!=='string')throw Error('配置格式无效，请参考 config.example.json');return {credentials:path.resolve(path.dirname(file),c.credentials_file),data:path.resolve(path.dirname(file),c.data_file),schedule:normalizeSchedule(c.schedule),mail:mailSettings(c.email),mailCredentials:path.resolve(path.dirname(file),typeof c.email?.credentials_file==='string'?c.email.credentials_file:'mail-credentials.json')}}
export function loadMailAuth(file:string,from:string){try{const text=readFileSync(file,'utf8');if(text.length>8192)throw Error();const raw=JSON.parse(text);if(raw.auth_code_env){if(typeof raw.auth_code_env!=='string'||!/^[A-Z_][A-Z0-9_]{0,100}$/.test(raw.auth_code_env))throw Error();raw.auth_code=process.env[raw.auth_code_env]}return mailAuth(raw,from)}catch{throw new MailError('AUTH_CONFIG','无法读取邮箱认证，请检查 mail-credentials.json、环境变量、权限和发件邮箱是否匹配')}}
export function startupMailRun():CheckinRun {const at=new Date().toISOString();return {id:'startup-auth',owner:'unknown',created_at:at,updated_at:at,status:'waiting_login',phase:'list',mode:'sign',offset:0,page_fingerprints:[],items:[],cursor:0,message:'无法读取打卡认证',day:null,error_code:'CONFIG'}}
async function main(){
 const args=process.argv.slice(2),index=args.indexOf('--config'),file=path.resolve(index>=0?args[index+1]||'config.json':'config.json');
 if(args.includes('--help')){console.log('node checkin-cli.js --config config.json --check-auth | --inspect | --once | --resume | --verified | --daemon | --test-mail\n--inspect 仅读取全部粉丝团签到状态；--once 普通签到；--resume 从断点继续；--verified 人工完成验证后等待 5 秒继续；--daemon 按指定时间或间隔执行。--test-mail 仅向已配置收件人发送一封测试邮件，不登录抖音、不签到。Node.js 24+。');return}
 const commands=['--check-auth','--inspect','--once','--resume','--verified','--daemon','--test-mail'].filter(x=>args.includes(x));if(commands.length!==1)throw Error('请指定一种运行模式（--help 查看说明）');
 let lastMail='';let stopping=false,service:CheckinService|undefined;process.on('SIGINT',()=>{stopping=true;service?.pause()});process.on('SIGTERM',()=>{stopping=true;service?.pause()});
 async function cycle(daemon:boolean){
  const config=loadCheckinConfig(file),auth=()=>Promise.resolve(parseCheckinAuth(JSON.parse(readFileSync(config.credentials,'utf8')))),wire=new CheckinHTTP(auth);
  mkdirSync(path.dirname(config.data),{recursive:true});const store=new CheckinStore(config.data),mailStore=new CheckinMailStore(store.db);let slot:string|null=null;
  const logMail=(owner:string)=>{const m=mailStore.latest(owner);if(m&&m.message_id+m.state!==lastMail){lastMail=m.message_id+m.state;console.log(JSON.stringify({at:m.at,mail_status:m.state,message:m.message}))}};
  const alerts=new CheckinAlerts(mailStore,()=>config.mail,async(_owner,from)=>loadMailAuth(config.mailCredentials,from));
  try{
   if(commands[0]==='--test-mail'){try{await alerts.test('mail-test')}finally{logMail('mail-test')}return}
   let first;try{first=await auth()}catch(e){if(!['--inspect','--check-auth'].includes(commands[0])){await alerts.report(startupMailRun());logMail('unknown')}throw e}
   if(commands[0]==='--check-auth'){await wire.connect(first.owner_uid);console.log(JSON.stringify({status:'authenticated',owner_uid:first.owner_uid}));return}
   if(daemon){const last=store.latest(first.owner_uid);if(last&&last.status!=='completed'){await alerts.report(last);logMail(first.owner_uid);return}slot=scheduleSlot(config.schedule);if(!slot||!store.claimSlot(first.owner_uid,slot))return}
   let last='';service=new CheckinService(store,wire,()=>first.owner_uid,()=>{const state=service!.state(),r=state.run;if(!r)return;const message=[r.status,r.phase,r.cursor,r.items.length,r.message].join('|');if(message!==last){last=message;console.log(JSON.stringify({at:new Date().toISOString(),owner_uid:first.owner_uid,status:r.status,total:r.items.length,processed:r.cursor,message:r.message}))}},{finished:async r=>{await alerts.report(r);logMail(r.owner)}});
   try{if(commands[0]==='--resume'||commands[0]==='--verified')await service.resume(commands[0]==='--verified');else await service.start(commands[0]==='--inspect'?'inspect':'sign');await service.wait()}catch(e){if(slot)store.releaseSlot(first.owner_uid,slot);throw e}
   const r=store.latest(first.owner_uid);if(r?.status!=='completed'&&!daemon)process.exitCode=2;
  }finally{service=undefined;store.close()}
 }
 if(commands[0]!=='--daemon'){await cycle(false);return}
 console.log(JSON.stringify({status:'scheduler_started',timezone:'Asia/Shanghai',times:scheduleTimes(loadCheckinConfig(file).schedule)}));
 let lastError='';while(!stopping){try{await cycle(true);lastError=''}catch(e){const message='配置、认证或请求不可用；检查文件后将自动重读。';if(lastError!==message){console.error(message);lastError=message}}if(!stopping)await new Promise(r=>setTimeout(r,15000))}
}
if(require.main===module)main().catch(()=>{console.error('执行失败：请检查配置、凭据文件权限、Node.js 版本及网络。凭据不会打印。');process.exitCode=1});
