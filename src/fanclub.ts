import {count,uidValid} from './domain';
import {CollectError} from './transport';

export type FanUser={uid:string;sec_uid:string;nickname:string;account:string;avatar:string;profile_url:string};
export type FanAnchor=FanUser&{remark:string;selected:boolean};
export type Honor={level:number|null;diamond_min:number|null;diamond_max:number|null};
export type FanResult={anchor:FanAnchor;state:'ok'|'unknown'|'failed';level:number|null;club_name:string;badge:'active'|'inactive'|'unknown';guard:'unknown';guard_expires_at:null;checked_at:string;message:string};
export type FanRun={id:string;owner_uid:string;target:FanUser;anchors:FanAnchor[];honor:Honor;results:FanResult[];status:'running'|'paused'|'waiting_login'|'waiting_verification'|'cooldown'|'completed'|'error';message:string;started_at:string;updated_at:string};
export type FanInput={kind:'uid'|'sec'|'url';value:string};
export const fanParams={device_platform:'android',aid:'1128',channel:'channel_pc_web',version_code:'400600',version_name:'40.6.0',update_version_code:'400601',pc_client_type:'1',platform:'PC',packed_level:'2',current_room_id:'0'};
export const FAN_USER='/webcast/user/';
export const guardVerified=false;
export function fanLink(value:string):URL {
  let u:URL;try{u=new URL(value)}catch{throw Error('请输入有效的抖音主页链接')}
  if(u.protocol!=='https:'||u.username||u.password||u.port||!['douyin.com','www.douyin.com','v.douyin.com','www.iesdouyin.com','iesdouyin.com'].includes(u.hostname))throw Error('只支持抖音官方 HTTPS 主页或分享链接');
  return u;
}
export function fanInput(raw:unknown):FanInput {
  if(typeof raw!=='string'||raw.length>4000)throw Error('请输入主页分享文本、sec_uid 或内部 UID');
  const s=raw.trim();if(/^\d{1,32}$/.test(s))return {kind:'uid',value:s};
  if(/^MS4[A-Za-z0-9_-]{8,195}$/.test(s))return {kind:'sec',value:s};
  const links=s.match(/https:\/\/[^\s<>"\u3000]+/g)||[];
  if(links.length!==1)throw Error('请提供一个主页分享链接；数字输入按内部 UID 处理，不是抖音号');
  const u=fanLink(links[0].replace(/[，。；）)]+$/,''));const userPath=/^\/(?:share\/)?user\//.test(u.pathname);const sec=u.pathname.match(/^\/(?:share\/)?user\/(MS4[A-Za-z0-9_-]{8,195})\/?$/)?.[1]||(userPath?(u.searchParams.get('sec_uid')||u.searchParams.get('sec_user_id')):null);
  if(sec&&!/^MS4[A-Za-z0-9_-]{8,195}$/.test(sec))throw Error('链接中的用户 ID 无效');
  if(sec)return {kind:'sec',value:sec};
  const numeric=u.pathname.match(/^\/share\/user\/(\d{1,32})\/?$/)?.[1];if(numeric)return {kind:'uid',value:numeric};
  if(u.hostname==='v.douyin.com'&&/^\/[A-Za-z0-9_-]+\/?$/.test(u.pathname))return {kind:'url',value:u.href};
  throw Error('链接不是用户主页，请在抖音个人主页使用“分享”');
}
export function fanUser(data:any,expected?:{uid?:string;sec_uid?:string}):FanUser {
  const u=data?.data;if(data?.status_code!==0||!u||typeof u!=='object')throw new CollectError('SCHEMA','用户资料格式异常');
  const uid=String(u.id_str??u.id??''),sec=u.sec_uid;
  if(!uidValid(uid)||typeof sec!=='string'||!/^MS4[A-Za-z0-9_-]{8,195}$/.test(sec))throw new CollectError('SCHEMA','接口未返回完整账号身份');
  if(expected?.uid&&uid!==expected.uid||expected?.sec_uid&&sec!==expected.sec_uid)throw new CollectError('IDENTITY','返回的目标账号与请求不符，已暂停');
  const avatar=u.avatar_thumb?.url_list?.find((s:any)=>typeof s==='string'&&s.startsWith('https://'))||'';
  return {uid,sec_uid:sec,nickname:typeof u.nickname==='string'?u.nickname.slice(0,200):'',account:typeof u.display_id==='string'?u.display_id:uid,avatar,profile_url:'https://www.douyin.com/user/'+sec};
}
export function fanHonor(data:any):Honor {
  const p=data?.data?.pay_grade,level=count(p?.level),min=count(p?.this_grade_min_diamond),max=count(p?.this_grade_max_diamond);
  const valid=level!==null&&level>0&&min!==null&&min>0&&max!==null&&max>min;
  return {level,diamond_min:valid?min:null,diamond_max:valid?max:null};
}
export function fanRelation(data:any,target:FanUser,anchor:FanAnchor):FanResult {
  fanUser(data,target);const c=data.data.fans_club?.data;
  const base:FanResult={anchor,state:'unknown',level:null,club_name:'',badge:'unknown',guard:'unknown',guard_expires_at:null,checked_at:new Date().toISOString(),message:'接口未返回可确认的灯牌；会员／守护状态尚未完成实测核验'};
  if(!c||typeof c!=='object')return base;
  const aid=String(c.anchor_id??'0');if(aid!=='0'&&aid!==anchor.uid)throw new CollectError('IDENTITY','返回的主播身份与请求不符，已暂停');
  const level=count(c.level),status=c.user_fans_club_status;
  // APK Unknown(0) is not a confirmed non-member. Only matched positive badges are verified.
  if(aid===anchor.uid&&level!==null&&level>0&&[1,2].includes(status))return {...base,state:'ok',level,club_name:typeof c.club_name==='string'?c.club_name.slice(0,200):'',badge:status===1?'active':'inactive',message:'灯牌已核实；会员／守护状态尚未完成实测核验'};
  return base;
}
export function fanFailure(anchor:FanAnchor,message:string):FanResult{return {anchor,state:'failed',level:null,club_name:'',badge:'unknown',guard:'unknown',guard_expires_at:null,checked_at:new Date().toISOString(),message}}
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function fanExport(run:FanRun,format:string):string {
  const payload={version:1,scope:'仅查询本次添加的主播，不代表全部已加入粉丝团',diamond_note:'按等级估算的钻石区间，不是实际消费账单',guard_note:'会员／守护尚未完成正样本核验，保持未知',...run};
  if(format==='json')return JSON.stringify(payload,null,2);
  const rows=run.anchors.map(a=>{const r=run.results.find(r=>r.anchor.uid===a.uid);return [a.nickname,a.remark,r?.level??'未知',r?.badge==='active'?'已点亮':r?.badge==='inactive'?'未点亮':'未知','未知','未知',r?.club_name||'未知',r?.checked_at||'尚未查询',r?.message||'待查询',a.profile_url]});
  const heads=['主播','备注','灯牌等级','灯牌状态','会员／守护','到期时间','粉丝团名称','查询时间','说明','主页'];
  const range=run.honor.diamond_min===null?'未知':`${run.honor.diamond_min.toLocaleString('zh-CN')} ≤ 钻石 < ${run.honor.diamond_max!.toLocaleString('zh-CN')}`;
  if(format==='md'){const cell=(s:unknown)=>String(s).replace(/[\r\n|]/g,' ').replace(/</g,'&lt;');return `# 粉丝团查询\n\n目标：${cell(run.target.nickname)}（${cell(run.target.account)}）\n\n荣誉等级：${run.honor.level??'未知'}；按等级估算：${range}。不是实际消费账单。\n\n${payload.scope}。${payload.guard_note}。任务：${run.status}。\n\n创建时间：${run.started_at}；更新时间：${run.updated_at}。\n\n| ${heads.join(' | ')} |\n| ${heads.map(()=>'---').join(' | ')} |\n${rows.map(r=>'| '+r.map(cell).join(' | ')+' |').join('\n')}\n`}
  if(format!=='html')throw Error('不支持的导出格式');
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>粉丝团查询</title><style>body{font:15px/1.6 system-ui;background:#f3f5f0;color:#243731;padding:28px}table{border-collapse:collapse;background:white;width:100%}td,th{padding:12px;text-align:left;border-bottom:1px solid #dce3d9}input{padding:10px;width:320px;margin:16px 0}.note{color:#627168}</style><h1>${escape(run.target.nickname)} · 粉丝团查询</h1><p>抖音号 ${escape(run.target.account)} · 荣誉等级 ${run.honor.level??'未知'} · 按等级估算 ${escape(range)}</p><p class="note">${escape(payload.scope)}；不是实际消费账单。${escape(payload.guard_note)}。任务：${escape(run.status)}。创建时间：${escape(run.started_at)}；更新时间：${escape(run.updated_at)}</p><input id="q" placeholder="搜索主播或备注" aria-label="搜索"><table><thead><tr>${heads.map(x=>`<th>${escape(x)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((x,i)=>i===9?`<td><a href="${escape(x)}" target="_blank" rel="noopener noreferrer">主页</a></td>`:`<td>${escape(x)}</td>`).join('')}</tr>`).join('')}</tbody></table><script>document.getElementById('q').oninput=function(){for(const r of document.querySelectorAll('tbody tr'))r.hidden=!r.textContent.toLowerCase().includes(this.value.toLowerCase())}</script></html>`;
}
