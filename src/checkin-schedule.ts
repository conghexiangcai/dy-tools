export type CheckinSchedule={enabled:boolean;mode:'times'|'interval';times:string[];start:string;repeats:number;interval_minutes:number;timezone:'Asia/Shanghai'};
export const defaultCheckinSchedule:CheckinSchedule={enabled:false,mode:'times',times:['08:30','12:00','21:15'],start:'09:00',repeats:3,interval_minutes:240,timezone:'Asia/Shanghai'};
export function timeMinutes(value:unknown):number {
 if(typeof value!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value))throw Error('时间请使用 HH:mm，例如 08:30');
 return Number(value.slice(0,2))*60+Number(value.slice(3));
}
export function normalizeSchedule(input:any):CheckinSchedule {
 if(!input||!['times','interval'].includes(input.mode)||typeof input.enabled!=='boolean')throw Error('定时配置无效');
 const s:CheckinSchedule={enabled:input.enabled,mode:input.mode,times:[],start:String(input.start||'09:00'),repeats:input.repeats??3,interval_minutes:input.interval_minutes??240,timezone:'Asia/Shanghai'};
 if(input.timezone&&input.timezone!==s.timezone)throw Error('当前按北京时间执行');
 timeMinutes(s.start);if(!Number.isInteger(s.repeats)||s.repeats<1||s.repeats>24||!Number.isInteger(s.interval_minutes)||s.interval_minutes<1||s.interval_minutes>1440)throw Error('每天次数为 1–24，间隔为 1–1440 分钟');
 if(!Array.isArray(input.times)||input.times.length>24)throw Error('指定时间最多 24 个');
 s.times=[...new Set<string>(input.times.map((v:unknown)=>{timeMinutes(v);return String(v)}))].sort();
 if(s.mode==='times'&&!s.times.length)throw Error('请至少填写一个执行时间');
 if(s.mode==='interval'&&timeMinutes(s.start)+(s.repeats-1)*s.interval_minutes>=1440)throw Error('间隔配置跨到次日，请减少次数或改为指定时间');
 return s;
}
export function scheduleTimes(s:CheckinSchedule):string[]{normalizeSchedule(s);return s.mode==='times'?[...s.times]:Array.from({length:s.repeats},(_,n)=>{const t=timeMinutes(s.start)+n*s.interval_minutes;return String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0')})}
export function chinaDate(now:number=Date.now()):string {if(!Number.isFinite(now))throw Error('日期无效');return new Date(now+8*3600_000).toISOString().slice(0,10)}
export function chinaTime(now:number=Date.now()):string{return new Date(now+8*3600_000).toISOString().slice(11,16)}
export function scheduleSlot(s:CheckinSchedule,now:number=Date.now(),graceMinutes=5):string|null {
 if(!s.enabled)return null;const minute=timeMinutes(chinaTime(now)),times=scheduleTimes(s).filter(t=>minute>=timeMinutes(t)&&minute-timeMinutes(t)<graceMinutes);
 return times.length?chinaDate(now)+'T'+times.at(-1):null;
}
const xml=(s:string)=>s.replace(/[<>&"']/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]!));
export function windowsTaskXML(s:CheckinSchedule,exe:string,args:string,workingDirectory:string,user:string):string {
 const day=chinaDate();return `<?xml version="1.0" encoding="UTF-16"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers>${scheduleTimes(s).map(t=>`<CalendarTrigger><StartBoundary>${day}T${t}:00+08:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`).join('')}</Triggers><Principals><Principal id="Author"><UserId>${xml(user)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT2H</ExecutionTimeLimit></Settings><Actions Context="Author"><Exec><Command>${xml(exe)}</Command><Arguments>${xml(args)}</Arguments><WorkingDirectory>${xml(workingDirectory)}</WorkingDirectory></Exec></Actions></Task>`;
}
