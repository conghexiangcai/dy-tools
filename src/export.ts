import {readFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {classify,settingsDefaults} from './domain';
export function exportText(snapshot:any,format:string,templatePath:string):string{
  const payload={group_catalog:snapshot.group_catalog||[],group_rows:snapshot.group_rows||[],summary:snapshot.summary,rows:snapshot.rows.map((r:any)=>({...r,...classify(r,settingsDefaults)}))};
  if(format==='json')return JSON.stringify(payload,null,2);
  if(format==='html'){const desktopTemplate=path.join(path.dirname(templatePath),'desktop-report-template.html');return readFileSync(existsSync(desktopTemplate)?desktopTemplate:templatePath,'utf8').replace('__DATA__',()=>JSON.stringify(payload).replace(/&/g,'\\u0026').replace(/</g,'\\u003c').replace(/>/g,'\\u003e'));}
  if(format!=='md')throw Error('不支持的导出格式');
  const esc=(v:any)=>String(v??'未知').replace(/[\r\n]/g,' ').replace(/\|/g,'\\|').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const groupLabel=(r:any)=>(r.groups_status!=='known'?'未知':r.groups?.length?r.groups.map((g:any)=>g.name).join('；'):'未分组')+(r.groups_stale?'（未更新，保留上次结果）':'');
  return ['# 抖音关注清单','',`名单时间：${payload.summary.following_snapshot_at||'尚未更新'}；指标时间：${payload.summary.profiles_updated_at||'尚未更新'}`,'','| 昵称 | 抖音号 | 粉丝数 | 关注数 | 关注−粉丝 | 作品数 | 互关 | 所属分组 | 最新三条视频发布时间（北京时间） | 主页 |','| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |',...[...payload.rows,...payload.group_rows].map((r:any)=>'| '+[r.nickname,r.account,r.follower_count,r.following_count,r.following_minus_followers,r.works_count,r.mutual_follow===null?'未知':r.mutual_follow?'是':'否',groupLabel(r),r.recent_video_times?.length?r.recent_video_times.map((s:string)=>new Date(s).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai'})).join('；'):r.recent_videos_status==='empty'?'无作品':'未知'].map(esc).join(' | ')+` | [主页](${r.profile_url}) |`)].join('\n');
}
