'use strict';
const $=id=>document.getElementById(id),fmt=n=>n===null||n===undefined?'未知':Number(n).toLocaleString('zh-CN'),date=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'尚未更新';
const defaults=window.filterDefaults,ids=Object.keys(defaults),size=50;
let rows=[],groupRows=[],summary={},byId=new Map(),owner='',selected=new Set(),opened=new Set(),lastBatch=[],filtered=[],page=0,task={},batchBusy=false,loading=false,loadAgain=false,saveChain=Promise.resolve(),usageRevision=0;
const settings=()=>Object.fromEntries(ids.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));
function error(message){$('app-error').textContent=message||'';$('app-error').hidden=!message;}
function write(delta){const account=owner;usageRevision++;if(!account)return Promise.resolve();saveChain=saveChain.then(()=>desktop.call('review',{owner_uid:account,delta})).catch(e=>error('使用记录保存失败：'+e.message));return saveChain;}
function setSettings(s){for(const [id,value] of Object.entries({...defaults,...s})){if(!$(id))continue;if($(id).type==='checkbox')$(id).checked=!!value;else $(id).value=String(value)}}
function apply(reset=true){
  try{
    const s=settings();for(const id of ['fans','fans-min','works-limit','works-min','days-min','days-max'])if($(id).validity.badInput)throw Error('阈值请输入非负整数');
    // Validate even when the currently displayed account has no rows.
    window.classifyRow({follower_count:null,following_count:null,works_count:null},s);
    window.matchesAge(null,s);
    const labels=[];for(const [id,label,op] of [['fans','粉丝','<'],['fans-min','粉丝','>'],['works-limit','作品','<'],['works-min','作品','>']])if(String(s[id]).trim()!=='')labels.push(label+' '+op+' '+fmt(Number(s[id])));if(s['following-greater'])labels.push('关注 > 粉丝');
    $('rule').textContent=labels.length?labels.join(s.logic==='or'?'，或 ':'，且 '):'未启用数值条件，显示全部账号。';
    const needle=String(s.search).trim().toLowerCase();
    const source=/^\d+$/.test(String(s['group-filter']))?[...rows,...groupRows]:rows;
    filtered=source.filter(r=>window.matchesGroup(r,String(s['group-filter']))).map(r=>({r,age:window.latestAge(r),...window.classifyRow(r,s)})).filter(x=>{
      const r=x.r;return (!needle||(r.nickname+' '+r.account).toLowerCase().includes(needle))&&(!s.decision||x.state===s.decision)&&(!s.mutual||(s.mutual==='yes'?r.mutual_follow===true:s.mutual==='no'?r.mutual_follow===false:r.mutual_follow===null))&&(!s['works-state']||(s['works-state']==='known'?r.works_count!==null:r.works_count===null))&&(!s['opened-state']||(s['opened-state']==='opened'?opened.has(r.uid):!opened.has(r.uid)));
    }).filter(x=>window.matchesAge(x.age,s));
    const [field,dir]=String(s.sort).split('_'),key={difference:'following_minus_followers',fans:'follower_count',works:'works_count',following:'following_count'}[field]||'following_minus_followers';
    filtered.sort((a,b)=>{const x=field==='recency'?a.age:a.r[key],y=field==='recency'?b.age:b.r[key];if(x===null&&y!==null)return 1;if(y===null&&x!==null)return -1;return (x===null?0:(x-y)*(dir==='desc'?-1:1))||a.r.uid.localeCompare(b.r.uid)});
    page=reset?0:Math.min(page,Math.max(0,Math.ceil(filtered.length/size)-1));$('filter-error').hidden=true;render();
  }catch(e){$('filter-error').textContent=e.message;$('filter-error').hidden=false;filtered=[];page=0;render();}
}
const pageRows=()=>filtered.slice(page*size,(page+1)*size);
const eligible=()=>filtered.filter(x=>selected.has(x.r.uid)&&!opened.has(x.r.uid)).map(x=>x.r.uid);
function updateActions(){
  const visible=filtered.filter(x=>selected.has(x.r.uid)).length,left=eligible().length,batch=Number($('batch-size').value)||5;
  $('selected-count').textContent=fmt(selected.size);$('selection-info').textContent='已勾选 '+fmt(selected.size)+' 人';
  $('batch-info').textContent=`当前筛选中已选 ${visible} 人 · 隐藏或历史账号勾选 ${selected.size-visible} 人 · 尚未打开 ${left} 人，剩余 ${Math.ceil(left/batch)} 批`;
  $('open-next').disabled=batchBusy||!left;$('reopen').disabled=batchBusy||!lastBatch.some(id=>byId.has(id));$('clear-selection').disabled=!selected.size;
  const pr=pageRows(),all=pr.length>0&&pr.every(x=>selected.has(x.r.uid));$('check-page').checked=all;$('check-page').indeterminate=!all&&pr.some(x=>selected.has(x.r.uid));$('check-page').disabled=!pr.length;$('select-page').disabled=!pr.length;$('unselect-page').disabled=!pr.some(x=>selected.has(x.r.uid));
}
function cell(tr,value,cls=''){const td=document.createElement('td');td.textContent=value;td.className=cls;tr.append(td);return td}
function profileLink(r){const a=document.createElement('a');a.href=r.profile_url;a.textContent='打开 ↗';a.className='link';a.onclick=e=>{e.preventDefault();if(!batchBusy)openBatch([r.uid])};return a}
function render(){
  const wrap=document.querySelector('.table-wrap'),scroll=wrap.scrollTop;$('rows').replaceChildren();
  for(const x of pageRows()){
    const r=x.r,tr=document.createElement('tr');tr.classList.toggle('selected',selected.has(r.uid));
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=selected.has(r.uid);cb.setAttribute('aria-label','选择 '+r.nickname+' '+r.account);cb.onchange=()=>{cb.checked?selected.add(r.uid):selected.delete(r.uid);tr.classList.toggle('selected',cb.checked);write({select:{ids:[r.uid],value:cb.checked}});updateActions()};cell(tr,'').append(cb);
    const person=cell(tr,'','person'),heading=document.createElement('div'),name=document.createElement('strong'),account=document.createElement('small');heading.className='person-name';name.textContent=r.nickname||'未命名账号';heading.append(name);
    if(window.accountPrivacy(r)===true){const badge=document.createElement('span');badge.className='private-badge';badge.textContent='🔒 私密账号';badge.title='最近一次采集确认该账号为私密账号';heading.append(badge)}
    account.textContent=r.account;person.append(heading,account);if($('ignore-selected')){const hide=document.createElement('button');hide.className='ignore-account';hide.textContent='忽视';hide.title='只在本地隐藏，不取关';hide.onclick=()=>ignoreAccounts([r.uid]);heading.append(hide)}
    cell(tr,fmt(r.follower_count),'number');cell(tr,fmt(r.following_count),'number');const diff=r.following_minus_followers;cell(tr,diff===null?'未知':(diff>0?'+':'')+fmt(diff),'number '+(diff>0?'positive':'negative'));
    const works=cell(tr,fmt(r.works_count),'number');works.title=(r.works_count===null?'作品数未知：'+({private:'私密账号',privacy_unknown:'隐私状态未知',not_checked:'尚未采集',request_failed:'未能读取',conflict:'来源冲突',missing_count:'接口未返回数量'}[r.works_status]||'尚未核实'):'主页详情已读取')+' · '+date(r.checked_at);
    const pill=document.createElement('span');pill.className='pill '+(r.mutual_follow===true?'mutual':r.mutual_follow===null?'unknown':'');pill.textContent=r.mutual_follow===true?'互关':r.mutual_follow===false?'未互关':'未知';cell(tr,'').append(pill);
    const c=cell(tr,'','conditions');for(const label of x.matched.length?x.matched:[x.state==='pending'?'数据未知，待确认':$('rule').textContent.startsWith('未启用')?'不限':'未命中']){const span=document.createElement('span');span.textContent=label;c.append(span)}
    const gc=cell(tr,'','group-tags');gc.title='分组读取时间：'+date(r.groups_checked_at);if(r.groups_status!=='known')gc.textContent='未知';else if(!r.groups?.length)gc.textContent='未分组';else for(const g of r.groups){const tag=document.createElement('span');tag.className='group-tag';tag.textContent=g.name;gc.append(tag)}if(r.groups_stale){const stale=document.createElement('small');stale.textContent='未更新 · 保留上次结果';gc.append(stale)}
    tr.insertBefore(gc,c);
    const times=cell(tr,'','video-times');if(r.recent_video_times?.length){for(const value of r.recent_video_times.slice(0,3)){const line=document.createElement('div');line.textContent=new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});times.append(line)}const ago=document.createElement('small');ago.textContent='最新距今 '+x.age+' 天';times.append(ago)}else times.textContent=r.recent_videos_status==='empty'?'无作品':r.recent_videos_status==='private'?'未知（私密）':['unknown','conflict'].includes(r.recent_videos_status)?'未知（未能可靠读取）':'尚未获取';
    cell(tr,opened.has(r.uid)?'已请求打开主页':'尚未打开','state');cell(tr,'').append(profileLink(r));$('rows').append(tr);
  }
  if(!filtered.length){const tr=document.createElement('tr'),td=cell(tr,$('filter-error').hidden?emptyListMessage():'请修正筛选条件','empty');td.colSpan=12;$('rows').append(tr)}
  wrap.scrollTop=scroll;$('match-count').textContent=fmt(filtered.length);$('page-info').textContent=`共 ${fmt(filtered.length)} 人 · 第 ${filtered.length?page+1:0} / ${Math.ceil(filtered.length/size)} 页 · 每页 ${size} 人`;$('prev').disabled=!page;$('next').disabled=(page+1)*size>=filtered.length;updateActions();
}
function showBatch(message){
  $('batch-panel').hidden=!lastBatch.length;if(!lastBatch.length)return;$('batch-message').textContent=message||'上次打开的主页，可逐个打开或重开整批。';$('batch-links').replaceChildren();
  for(const id of lastBatch){const r=byId.get(id);if(!r)continue;const li=document.createElement('li'),a=profileLink(r);a.textContent=r.nickname+' ↗';li.append(a);$('batch-links').append(li)}
}
async function openBatch(ids){
  if(batchBusy)return;batchBusy=true;updateActions();const account=owner;
  try{await saveChain;const result=await desktop.call('openProfiles',{owner_uid:account,ids});if(owner!==account)return;usageRevision++;result.opened.forEach(id=>opened.add(id));lastBatch=result.opened;showBatch(`本批已请求打开 ${result.opened.length} 个主页；请在抖音主页手动操作。`);apply(false)}catch(e){error(e.message)}finally{batchBusy=false;updateActions()}
}
async function reload(){
  if(loading){loadAgain=true;return;}loading=true;
  try{
    await saveChain;const data=await desktop.call('snapshot');const changed=owner!==data.summary.account_uid;owner=data.summary.account_uid;summary=data.summary;rows=data.rows;groupRows=data.group_rows||[];byId=new Map([...rows,...groupRows].map(r=>[r.uid,r]));
    fillGroups(data.group_catalog||[],changed?data.review.settings['group-filter']||'':$('group-filter').value);
    if(changed){selected=new Set(data.review.selected);opened=new Set(data.review.opened);lastBatch=data.review.lastBatch;setSettings(data.review.settings);page=0;}
    $('total').textContent=fmt(rows.length);$('data-status').textContent=!owner?'暂无本地名单，请登录抖音后点击更新数据':summary.source_label+' · 本次主页更新 '+fmt(summary.profiles_refreshed)+' / '+fmt(summary.total)+' · 作品数未知 '+fmt(rows.length-summary.works_verified);$('data-status').classList.toggle('warning',!!owner&&!summary.refresh_complete);if(!rows.length&&task.run?.phase==='following')$('data-status').textContent=emptyListMessage();
    $('import-review').disabled=!owner;$('export-review').disabled=!owner;$('export').disabled=!rows.length;$('refresh-groups').disabled=!owner||!!task.groups?.busy;
    $('footer').textContent='名单同步：'+date(summary.following_snapshot_at)+' · 指标更新：'+date(summary.profiles_updated_at)+' · 视频时间更新：'+date(summary.videos_updated_at)+'。打开记录不表示已取关；手动取关后的变化将在下次更新时反映。';apply(false);if(changed)showBatch();
  }catch(e){error(e.message)}finally{loading=false;if(loadAgain){loadAgain=false;setTimeout(reload,100)}}
}
function emptyListMessage(){
 if(!rows.length&&task.run?.phase==='following')return `正在读取关注名单，已获取 ${fmt(task.progress?.total||0)} 人，完整后展示${task.busy?'':'；任务已暂停，可继续'}`;
 if(!owner)return '暂无本地名单，请登录抖音后点击更新数据';
 return !rows.length&&!summary.following_snapshot_at?'尚无完整关注名单，请点击更新数据':'没有符合当前筛选条件的账号';
}
function renderTask(t){
  task=t||{};const r=task.run,p=task.progress||{completed:0,total:0,videos:0};const words={running:r?.phase==='following'?'正在读取关注列表':r?.phase==='videos'?'正在读取视频发布时间':'正在读取主页详情',paused:'已暂停',waiting_login:'等待登录',waiting_verification:'等待手动验证',cooldown:'验证后等待 '+(task.countdown||0)+' 秒',error:'已暂停，等待重试',completed:r?.id==='seed-v3'?'已导入原名单，视频时间待更新':'采集完成'};
  const sec=task.etaSeconds,minutes=Math.ceil(sec/60),eta=sec===null||sec===undefined?'':` · 预计剩余 ${minutes<60?minutes+' 分钟':Math.floor(minutes/60)+' 小时 '+minutes%60+' 分钟'}（不含暂停与验证）`;
  $('task-status').textContent=(r?`${words[r.status]||r.status} · ${r.phase==='following'?p.total+' 个账号，'+r.pages+' 页':'详情 '+p.completed+' / '+p.total+' · 视频时间 '+(p.videos||0)+' / '+p.total} · ${r.message||''}`:'尚未开始更新，先登录抖音并检查连接')+eta+(task.notice?' · '+task.notice:'');
  $('progress').max=Math.max(1,p.total*2);$('progress').value=p.completed+(p.videos||0);$('refresh').disabled=!!task.busy;$('connect').disabled=!!task.busy;$('pause').disabled=!task.busy;$('resume').disabled=!!task.busy||!r||r.status==='completed';$('verified').hidden=!['waiting_verification','cooldown'].includes(r?.status);$('verified').disabled=!!task.busy;
  if(task.groups)renderGroups(task.groups);
  if(!rows.length){render();if(task.run?.phase==='following')$('data-status').textContent=emptyListMessage();}
}
function renderGroups(g){$('refresh-groups').disabled=!owner||!!g.busy;$('group-status').textContent=g.message||g.error||(g.checked_at?'分组同步：'+date(g.checked_at):'分组尚未同步；可使用“所属分组”列的刷新按钮');if(g.waiting||g.countdown){$('verified').hidden=false;$('verified').disabled=!!g.busy}}
function fillGroups(catalog,value){const select=$('group-filter');select.replaceChildren();const entries=[['','所属分组：全部'],['ungrouped','未分组'],['unknown','归属未知'],...catalog.map(g=>[g.id,g.name+'（'+g.member_count+' 人）'])];if(value&&!entries.some(([id])=>id===value))entries.push([value,'该分组已变更（请刷新）']);for(const [id,label] of entries){const option=document.createElement('option');option.value=id;option.textContent=label;select.append(option)}select.value=value;select.title='分组与粉丝、作品、互关、是否打开等现有筛选条件叠加；多组账号包含在各所属分组中。'}
async function act(method,payload){error('');try{const data=await desktop.call(method,payload);renderTask(await desktop.call('state'));return data}catch(e){error(e.message);return null}}
async function refreshImportedReview(account){
  // A native import dialog and IPC response can overlap with new local edits.
  // Read the merged database after queued edits; never apply the stale import result.
  while(owner===account){
    const revision=usageRevision;await saveChain;const data=await desktop.call('snapshot');
    if(owner!==account||data.summary.account_uid!==account)return;
    if(revision!==usageRevision)continue;
    const r=data.review;selected=new Set(r.selected);opened=new Set(r.opened);lastBatch=r.lastBatch;setSettings(r.settings);apply(false);showBatch();return;
  }
}
$('login').onclick=()=>act('login');$('connect').onclick=async()=>{const p=await act('probe');if(p){await reload();error(p.matched?'':`样本接口作品数 ${p.api_works}；主页数 ${p.page_works??'尚未读取'}，请查看样本页面。`)}};
$('refresh').onclick=()=>act('start');$('pause').onclick=()=>act('pause');$('resume').onclick=()=>act('resume');$('verified').onclick=()=>act('verified');
$('refresh-groups').onclick=()=>act('groupRefresh');
$('export').onclick=()=>act('export',{format:$('export-format').value});$('export-review').onclick=async()=>{await saveChain;await act('exportReview')};$('import-review').onclick=async()=>{const account=owner;await saveChain;const r=await act('importReview');if(r)try{await refreshImportedReview(account)}catch(e){error('使用记录读取失败：'+e.message)}};
function selectPage(value){const ids=pageRows().map(x=>x.r.uid);ids.forEach(id=>value?selected.add(id):selected.delete(id));write({select:{ids,value}});render()}
$('select-page').onclick=()=>selectPage(true);$('unselect-page').onclick=()=>selectPage(false);$('check-page').onchange=()=>selectPage($('check-page').checked);$('clear-selection').onclick=()=>{selected.clear();write({clearSelected:true});render()};
$('open-next').onclick=()=>openBatch(eligible().slice(0,Number($('batch-size').value)||5));$('reopen').onclick=()=>openBatch(lastBatch.filter(id=>byId.has(id)));$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};
for(const id of ids)$(id).addEventListener(['search','fans','fans-min','works-limit','works-min','days-min','days-max'].includes(id)?'input':'change',()=>{if(id==='batch-size')updateActions();else apply();write({settings:settings()})});
$('reset').onclick=()=>{setSettings(defaults);apply();write({settings:settings()})};
desktop.onChange(e=>{if(e.task)renderTask({...e.task,notice:e.notice,groups:e.groups});if(e.groups)renderGroups(e.groups);if(e.version)reload()});
setSettings(defaults);reload();desktop.call('state').then(renderTask).catch(e=>error(e.message));
let calendarDay=Math.floor((Date.now()+28800000)/86400000);setInterval(()=>{const next=Math.floor((Date.now()+28800000)/86400000);if(next!==calendarDay){calendarDay=next;apply(false)}},60000);

if($('fan-open'))$('fan-open').onclick=()=>act('fanOpen');

async function ignoreAccounts(ids){try{await saveChain;await desktop.call('toolsIgnore',{owner,ids});await reload()}catch(e){error(e.message)}}
if($('toolbox-home'))$('toolbox-home').onclick=async()=>{await saveChain;await desktop.call('navigate',{page:'home'})};
if($('ignored-list'))$('ignored-list').onclick=async()=>{await saveChain;await desktop.call('navigate',{page:'ignored'})};
if($('ignore-selected'))$('ignore-selected').onclick=()=>ignoreAccounts([...selected].filter(id=>byId.has(id)));
async function prepareUnfollow(scope){error('');try{if(scope==='filtered'&&!$('filter-error').hidden)throw Error('请先修正筛选条件');await saveChain;const r=await desktop.call('toolsPreview',{owner,scope,group:$('group-filter').value,settings:settings()});await desktop.call('navigate',{page:'tasks',run:r.id})}catch(e){error(e.message)}}
if($('unfollow-filtered'))$('unfollow-filtered').onclick=()=>prepareUnfollow('filtered');
if($('unfollow-group'))$('unfollow-group').onclick=()=>prepareUnfollow('group');

async function stageGroups(scope){error('');try{await saveChain;await desktop.call('orgStage',{owner,scope,settings:settings()});await desktop.call('navigate',{page:'groups'})}catch(e){error(e.message)}}
if($('group-add-selected'))$('group-add-selected').onclick=()=>stageGroups('selected');
if($('group-add-filtered'))$('group-add-filtered').onclick=()=>stageGroups('filtered');
