'use strict';
const $=id=>document.getElementById(id),q=new URLSearchParams(location.search),tool=q.get('tool')||'home';
const catalog=[['downloads','作品下载','粘贴分享链接，保存视频与原图图集','14'],['groups','分组管家','抖音关注分组，批量加入、复制、移动成员','11'],['activity','关注动态','对比关注与粉丝名单的新增和减少','12'],['chat-changes','群成员变动','查看同一群不同时间的成员变化','13'],['following','关注管理','筛选、分组、批量取关和忽视名单','01'],['fanclub','粉丝团查询','查看指定主播下的灯牌与会员情况','02'],['checkin','粉丝团打卡','全部已加入粉丝团，按多个时间点每日签到','03'],['migration','关注迁移','保存原账号名单，换账号后重新关注','04'],['likes','点赞清理','预览并取消自己点过的赞','05'],['collections','收藏整理','预览并取消收藏的视频与图文作品','06'],['recommendations','推荐清理','撤销自己主动推荐过的作品','07'],['duplicates','群成员检索','多群查重、查找某人，比较 JSON 与 Excel 名单','08'],['ignored','忽视名单','管理已隐藏的账号，随时恢复显示','09'],['tasks','执行记录','查看任务进度，继续未完成的任务','10']];
const labels={unfollow:'批量取关',follow:'关注迁移',unlike:'取消点赞',uncollect:'取消收藏作品',unrecommend:'撤销推荐'},states={pending:'待处理',sending:'正在提交',done:'已确认完成',skipped:'已跳过',unknown:'待核对',failed:'失败'};
let data=null,run=null,runId=q.get('run')||'',runPage=0,busy=false,loading=false,rerun=false,groupsChosen=new Set(),lastDuplicate=null;
const date=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'未知';
function text(tag,value,cls){const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e}
function button(label,fn,cls=''){const e=text('button',label,cls);e.onclick=()=>act(fn);return e}
function fail(e){$('error').textContent=e?.message||String(e);$('error').hidden=false}
async function call(method,p={}){return desktop.call(method,{owner:data?.owner,...p})}
async function act(fn){if(busy)return;busy=true;$('error').hidden=true;try{await fn();await reload()}catch(e){fail(e)}finally{busy=false}}
async function navigate(page,r){await desktop.call('navigate',{page,run:r})}
function entry(title,detail,controls=[]){const e=text('div','','entry'),body=text('span','');body.append(text('strong',title),text('small',detail));e.append(body,...controls);return e}
function showRun(r){if(!r)return;run=r;runId=r.id;renderRun()}
function renderRun(){
 $('preview').hidden=!run;if(!run)return;$('preview-title').textContent=labels[run.kind]+' · 操作预览';$('scope').textContent=`账号 UID：${run.owner_uid} · ${run.scope} · 生成于 ${date(run.created_at)}`;
 const done=run.items.filter(i=>['done','skipped'].includes(i.state)).length;$('run-count').textContent=`共 ${run.items.length} 项 · 已处理 ${done} 项 · 剩余 ${run.items.length-done} 项`;$('run-progress').max=Math.max(1,run.items.length);$('run-progress').value=done;
 $('run-message').textContent=run.message+(data.actions.countdown?' · '+data.actions.countdown+' 秒':'');$('execute').disabled=data.actions.busy||data.busy||['completed','waiting_verification'].includes(run.status);$('execute').textContent=run.status==='ready'?'确认并执行':'核对后继续';$('stop').disabled=!data.actions.busy&&!data.busy;$('verified').hidden=run.status!=='waiting_verification';$('verified').disabled=data.actions.busy;
 const needle=$('run-search').value.trim().toLowerCase(),items=run.items.filter(i=>(i.label+' '+i.id+' '+(i.account||'')).toLowerCase().includes(needle));runPage=Math.max(0,Math.min(runPage,Math.ceil(items.length/100)-1));$('run-items').replaceChildren();
 for(const i of items.slice(runPage*100,(runPage+1)*100)){const tr=document.createElement('tr');for(const v of [i.label+(i.account?' / '+i.account:''),i.id,states[i.state]||i.state,i.message||''])tr.append(text('td',v));$('run-items').append(tr)}$('run-page').textContent=`搜索结果 ${items.length} 项 · 第 ${items.length?runPage+1:0} / ${Math.ceil(items.length/100)} 页`;$('run-prev').disabled=!runPage;$('run-next').disabled=(runPage+1)*100>=items.length;
}
function render(){
 $('owner').textContent=data.owner?`${data.name||'已连接账号'} · UID ${data.owner}`:'尚未连接账号';$('connect').disabled=data.actions.busy||data.busy;$('home').hidden=tool==='home';$('title').textContent=tool==='home'?'抖音整理箱':catalog.find(t=>t[0]===tool)?.[1]||'工具箱';
 $('subtitle').textContent=tool==='home'?'整理关注与互动记录，按需要打开一项工具。':catalog.find(t=>t[0]===tool)?.[2]||'';
 $('cards').hidden=tool!=='home';$('module').hidden=tool==='home';if(tool==='home'){if(!$('cards').children.length)for(const [id,name,desc,num] of catalog){const b=button('',()=>id==='fanclub'?desktop.call('fanOpen'):navigate(id),'card');b.append(text('small',num),text('strong',name),text('p',desc));b.dataset.tool=id;$('cards').append(b)}return}
 $('module-actions').replaceChildren();$('contents').replaceChildren();$('info').textContent=data.message||'';const actions=$('module-actions'),contents=$('contents');
 if(['likes','collections','recommendations'].includes(tool)){
  $('intro').textContent=tool==='collections'?'本工具处理收藏的视频与图文作品，音乐、合集等其他收藏类型不在本次范围内。先读取完整名单，再确认执行。':tool==='recommendations'?'只撤销你主动点过“推荐”的作品。每项操作后回读推荐列表确认，名单较多时耗时会更长。':'读取当前账号点赞作品，生成完整预览后再确认执行。';
  const b=button('读取完整名单，生成预览',async()=>{runPage=0;showRun(await call('toolsMedia',{kind:{likes:'unlike',collections:'uncollect',recommendations:'unrecommend'}[tool]}))},'primary');b.disabled=!data.owner||data.busy||data.actions.busy;actions.append(b);
  const stop=button('停止读取',()=>call('toolsPause'));stop.onclick=()=>call('toolsPause').catch(fail);stop.disabled=!data.busy;actions.append(stop);if(!run)contents.append(text('p','读取和预览不会取消任何记录。确认执行前，请核对账号与名单。','muted'));
 }else if(tool==='migration'){
  $('intro').textContent='先在原账号保存当前全部关注名单（包含忽视账号），再在抖音窗口切换账号并点击“连接当前账号”。迁移会跳过已经关注的人，不会取关原账号。';
  const b=button('保存当前关注名单',()=>call('toolsFreeze'),'primary');b.disabled=!data.owner;actions.append(b);
  for(const t of data.transfers){const start=button('预览迁移到当前账号',async()=>{showRun(await call('toolsMigration',{id:t.id}));runPage=0});start.disabled=!data.owner||data.owner===t.source_uid;contents.append(entry(`${t.source_name||'原账号'} · ${t.total} 人`,`原账号 UID ${t.source_uid} · 名单时间 ${date(t.snapshot_at)} · 保存于 ${date(t.created_at)}`,[start]))}if(!data.transfers.length)contents.append(text('p','尚未保存迁移名单。','muted'));
 }else if(tool==='ignored'){
  $('intro').textContent='忽视账号在关注列表和批量取关预览中隐藏。恢复显示会保留原来的勾选、打开记录与分组。忽视不会在抖音上取关或拉黑。';
  for(const r of data.ignored)contents.append(entry(r.nickname||r.account,`${r.account} · UID ${r.uid} · ${date(r.ignored_at)}`,[button('恢复显示',()=>call('toolsRestore',{ids:[r.uid]}))]));if(!data.ignored.length)contents.append(text('p','忽视名单为空。在关注管理中勾选账号后可加入。','muted'));
 }else if(tool==='tasks'){
  $('intro').textContent='任务按账号隔离。关闭软件后不会自动继续执行；重新打开预览并确认后，先核对上次未确认的项目。';
  for(const r of data.actions.runs)contents.append(entry(`${labels[r.kind]} · ${r.done} / ${r.total}`,r.scope+' · '+date(r.created_at)+' · '+r.message,[button('查看预览与进度',async()=>{showRun(await call('toolsRun',{id:r.id}));runPage=0})]));if(!data.actions.runs.length)contents.append(text('p','当前账号没有执行任务。','muted'));
 }else if(tool==='duplicates'){
  $('intro').textContent='按内部 UID 比较多个粉丝群的成员，昵称和抖音号不作为去重依据。当前支持导入成员 JSON；自动读取抖音粉丝群成员的接口尚待测试账号验证。结果仅覆盖已导入名单。';
  for(const [label,fn] of [['导入群成员名单',()=>call('toolsRosterImport')],['下载格式示例',()=>call('toolsExport',{type:'template'})],['检索选中群的重复成员',async()=>{lastDuplicate=await call('toolsDuplicates',{ids:[...groupsChosen]})}]]){const b=button(label,fn);b.disabled=!data.owner;actions.append(b)}
  for(const g of data.rosters){const cb=document.createElement('input');cb.type='checkbox';cb.checked=groupsChosen.has(g.id);cb.setAttribute('aria-label','选择 '+g.name);cb.onchange=()=>{cb.checked?groupsChosen.add(g.id):groupsChosen.delete(g.id);lastDuplicate=null;render()};const row=entry(g.name,`${g.total} 人 · ${g.source} · ${date(g.collected_at)}`,[button('移除此名单',async()=>{await call('toolsRosterRemove',{id:g.id});groupsChosen.delete(g.id);lastDuplicate=null})]);row.prepend(cb);contents.append(row)}
  if(lastDuplicate){contents.append(text('h2',`重复成员 ${lastDuplicate.rows.length} 人`),button('导出查重结果',()=>call('toolsExport',{type:'duplicates',ids:[...groupsChosen]})));for(const r of lastDuplicate.rows)contents.append(entry(r.nickname||r.uid,`UID ${r.uid} · 出现在 ${r.groups.length} 个群：`+r.groups.map(g=>g.name).join('、')))}
 }
 renderRun();
}
async function reload(){if(loading){rerun=true;return}loading=true;try{const next=await desktop.call('toolsState');if(data&&data.owner!==next.owner){run=null;runId='';groupsChosen.clear();lastDuplicate=null}data=next;if(runId)run=await call('toolsRun',{id:runId});render()}catch(e){fail(e)}finally{loading=false;if(rerun){rerun=false;setTimeout(reload,50)}}}
$('home').onclick=()=>act(()=>navigate('home'));$('login').onclick=()=>act(()=>desktop.call('login'));$('connect').onclick=()=>act(()=>desktop.call('connect'));
$('execute').onclick=()=>act(()=>call('toolsExecute',{id:run.id,nonce:run.nonce}));$('verified').onclick=()=>act(()=>call('toolsExecute',{id:run.id,nonce:run.nonce,verified:true}));
// Pause remains available while a long read or execution request is pending.
$('stop').onclick=()=>call('toolsPause').catch(fail);$('run-export').onclick=()=>act(()=>call('toolsExport',{type:'run',id:run.id}));$('run-search').oninput=()=>{runPage=0;renderRun()};$('run-prev').onclick=()=>{runPage--;renderRun()};$('run-next').onclick=()=>{runPage++;renderRun()};
desktop.onChange(()=>reload());reload();
