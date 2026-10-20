import {chinaDate} from './checkin-schedule';
export class CheckinError extends Error {constructor(public code:string,message:string){super(message)}}
export const CHECKIN_ENDPOINTS={list:'https://webcast.amemv.com/webcast/fansclub/user_auto_light_up_list/',calendar:'https://fandom.starplaylet.com/ent/fandom/user/calendar/',sign:'https://fandom.starplaylet.com/ent/fandom/join/',self:'https://api3-core-c.amemv.com/aweme/v1/user/profile/self/'} as const;
// The official calendar's TodayUnchecked handler uses /join/, join_type=3 and action=1.
// /sign/in was only an unused generated API definition; its enum is deliberately not guessed.
export const checkinParams={device_platform:'android',aid:'1128',channel:'channel_pc_web',version_code:'400600',version_name:'40.6.0',update_version_code:'400601',pc_client_type:'1',platform:'PC',packed_level:'2',current_room_id:'0'};
export const checkinSelfParams=checkinParams;
export type Club={key:string;anchor_id:string;sec_uid:string;name:string;club_name:string;level:number|null;lit:boolean|null;fandom_id:string;business_id:string;business_type:4;unsupported?:string};
export type Calendar={day:string;server_now:number;signed:boolean;streak:number|null;fandom_id:string;has_join_circle:boolean|null;checked_at:string;signed_at:string|null};
export type CheckinItem={club:Club;state:'pending'|'reading'|'sending'|'signed'|'needs_join'|'unsupported'|'unknown'|'failed';message:string;calendar?:Calendar;attempted_day?:string;checked_at?:string};
export type CheckinRun={id:string;owner:string;created_at:string;updated_at:string;status:'running'|'paused'|'waiting_login'|'waiting_verification'|'rate_limited'|'completed'|'error';phase:'list'|'check';mode:'inspect'|'sign';offset:number;page_fingerprints:string[];items:CheckinItem[];cursor:number;message:string;day:string|null;error_code?:string};
export function decimal(value:unknown,allowZero=false):string {const s=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;if(typeof s!=='string'||!/^\d{1,32}$/.test(s)||!allowZero&&/^0+$/.test(s))throw new CheckinError('SCHEMA','接口未提供可靠的字符串 ID');return s}
export function lossless(text:string):any{return JSON.parse(text,((_k:string,v:any,c?:{source?:string})=>typeof v==='number'&&!Number.isSafeInteger(v)&&c?.source?c.source:v) as any)}
const num=(v:any)=>Number.isSafeInteger(v)&&v>=0?v:null;
const str=(v:any,n=200)=>typeof v==='string'?v.slice(0,n):'';
export function parseClubs(data:any):{clubs:Club[];more:boolean}{
 if(data?.status_code!==0||!Array.isArray(data.data?.user_auto_light_up_list)||![true,false,0,1].includes(data.data.has_more))throw new CheckinError('SCHEMA','粉丝团列表或分页格式异常，未执行签到');
 const clubs:Club[]=data.data.user_auto_light_up_list.map((x:any)=>{const a=x.anchor_info||{},f=x.user_fansclub_info||{},entity=f.club_entity||{},uid=a.id_str??a.id??f.anchor_id;let anchor='';try{anchor=decimal(uid)}catch{}
  const key=anchor?'uid:'+anchor:'entity:'+decimal(entity.biz_id)+':'+decimal(entity.object_id);
  const circle=f.biz_extra?.fandom_id;return {key,anchor_id:anchor,sec_uid:str(a.sec_uid),name:str(a.nickname)||str(f.club_name)||key,club_name:str(f.club_name),level:num(f.level),lit:f.status===1?true:f.status===2?false:null,fandom_id:circle?decimal(circle):'',business_id:anchor,business_type:4 as const,...(!anchor?{unsupported:'此粉丝团没有主播 UID，签到业务类型尚未核实'}:{})};
 });
 if(new Set(clubs.map(x=>x.key)).size!==clubs.length)throw new CheckinError('SCHEMA','粉丝团当前页存在重复身份，请稍后刷新');
 return {clubs,more:!!data.data.has_more};
}
export function parseCalendar(raw:any,club:Club,now=Date.now()):Calendar {
 const d=raw?.months?raw:raw?.data;if(raw?.status_code!==0||!d||!Array.isArray(d.months))throw new CheckinError('SCHEMA','签到日历缺失，今日状态未知');
 const timestamp=raw.extra?.now??d.extra?.now;if(typeof timestamp!=='number'||!Number.isSafeInteger(timestamp)||Math.abs(timestamp-now)>24*3600_000)throw new CheckinError('CLOCK','服务端时间缺失或与本机相差超过一天，请核对系统时间');
 for(const k of ['business_id','anchor_id'])if(d[k]!==undefined&&decimal(d[k])!==club.business_id)throw new CheckinError('IDENTITY','签到日历与主播不一致');
 if(d.business_type!==undefined&&d.business_type!==4)throw new CheckinError('IDENTITY','签到业务类型不一致');
 const day=chinaDate(timestamp),year=Number(day.slice(0,4)),month=Number(day.slice(5,7));const months=d.months.filter((m:any)=>m.year===year&&m.month===month);
 if(months.length!==1||num(months[0].month_signed_days)===null)throw new CheckinError('SCHEMA','日历没有完整的当前月份，今日状态未知');
 const m=months[0];if(m.days!==undefined&&!Array.isArray(m.days)||m.month_signed_days>0&&!Array.isArray(m.days))throw new CheckinError('SCHEMA','当前月签到明细缺失');
 const days=m.days||[];let found:any;
 for(const item of days){if(num(item.date)===null||num(item.type)===null)throw new CheckinError('SCHEMA','签到日期或状态无效');const date=chinaDate(item.date*1000);if(date.slice(0,7)!==day.slice(0,7))throw new CheckinError('SCHEMA','日历月份与日期不一致');if(date===day){if(found)throw new CheckinError('SCHEMA','当天签到明细重复');found=item}}
 const circle=d.fandom_id?decimal(d.fandom_id):'';if(club.fandom_id&&circle&&club.fandom_id!==circle)throw new CheckinError('IDENTITY','圈子映射发生变化，请重新刷新名单');
 const signed=!!found&&found.type>0;return {day,server_now:timestamp,signed,streak:num(d.current_streak),fandom_id:circle,has_join_circle:d.has_join_circle===true?true:d.has_join_circle===false?false:null,checked_at:new Date(now).toISOString(),signed_at:signed&&num(found.time)!==null?new Date(found.time*1000).toISOString():null};
}
export function signArguments(club:Club,calendar:Calendar):Record<string,string>{
 if(club.unsupported||!club.business_id)throw new CheckinError('UNSUPPORTED','签到业务类型尚未核实');
 if(calendar.signed)throw new CheckinError('ALREADY','今天已签到');
 if(calendar.fandom_id&&calendar.has_join_circle!==true)throw new CheckinError('NEEDS_JOIN','官方入口要求先加入圈子，已跳过自动加入');
 return {business_id:decimal(club.business_id),business_type:'4',fandom_id:decimal(club.business_id),join_type:'3',action:'1'};
}
export function checkinExport(run:CheckinRun){return {version:1,scope:'当前账号已加入的全部粉丝团；仅普通当日签到，不送礼、不补签、不自动入圈',...run}}
