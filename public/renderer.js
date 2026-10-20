'use strict';
const $=id=>document.getElementById(id),fmt=n=>n===null||n===undefined?'未知':Number(n).toLocaleString('zh-CN'),date=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'尚未更新';
const defaults=window.filterDefaults,ids=Object.keys(defaults),size=50;
let rows=[],summary={},byId=new Map(),owner='',selected=new Set(),opened=new Set(),lastBatch=[],filtered=[],page=0,task={},batchBusy=false,loading=false,loadAgain=false,saveChain=Promise.resolve();
const settings=()=>Object.fromEntries(ids.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));
function error(message){$('app-error').textContent=message||'';$('app-error').hidden=!message;}
function write(delta){const account=owner;saveChain=saveChain.then(()=>desktop.call('review',{owner_uid:account,delta})).catch(e=>error('使用记录保存失败：'+e.message));return saveChain;}
function setSettings(s){for(const [id,value] of Object.entries({...defaults,...s})){if(!$(id))continue;if($(id).type==='checkbox')$(id).checked=!!value;else $(id).value=String(value)}}
function classify(r){return window.classifyRow(r,settings())}
function apply(reset=true){
  try{
    const s=settings();for(const id of ['fans','fans-min','works-limit','works-min','days-min','days-max'])if($(id).validity.badInput)throw Error('阈值请输入非负整数');
    // Validate even when the currently displayed account has no rows.
    window.classifyRow({follower_count:null,following_count:null,works_count:null},s);
    window.matchesAge(null,s);
    const labels=[];for(const [id,label,op] of [['fans','粉丝','<'],['fans-min','粉丝','>'],['works-limit','作品','<'],['works-min','作品','>']])if(String(s[id]).trim()!=='')labels.push(label+' '+op+' '+fmt(Number(s[id])));if(s['following-greater'])labels.push('关注 > 粉丝');
    $('rule').textContent=labels.length?labels.join(s.logic==='or'?'，或 ':'，且 '):'未启用数值条件，显示全部账号。';
    const needle=String(s.search).trim().toLowerCase();
    filtered=rows.map(r=>({r,age:window.latestAge(r),...classify(r)})).filter(x=>{
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
    const person=cell(tr,'','person'),name=document.createElement('strong'),account=document.createElement('small');name.textContent=r.nickname||'未命名账号';account.textContent=r.account;person.append(name,account);
    cell(tr,fmt(r.follower_count),'number');cell(tr,fmt(r.following_count),'number');const diff=r.following_minus_followers;cell(tr,diff===null?'未知':(diff>0?'+':'')+fmt(diff),'number '+(diff>0?'positive':'negative'));
    const works=cell(tr,fmt(r.works_count),'number');works.title=(r.works_count===null?'作品数未知：'+({private:'私密账号',privacy_unknown:'隐私状态未知',not_checked:'尚未采集',request_failed:'未能读取',conflict:'来源冲突',missing_count:'接口未返回数量'}[r.works_status]||'尚未核实'):'主页详情已读取')+' · '+date(r.checked_at);
    const pill=document.createElement('span');pill.className='pill '+(r.mutual_follow===true?'mutual':r.mutual_follow===null?'unknown':'');pill.textContent=r.mutual_follow===true?'互关':r.mutual_follow===false?'未互关':'未知';cell(tr,'').append(pill);
    const c=cell(tr,'','conditions');for(const label of x.matched.length?x.matched:[x.state==='pending'?'数据未知，待确认':$('rule').textContent.startsWith('未启用')?'不限':'未命中']){const span=document.createElement('span');span.textContent=label;c.append(span)}
    cell(tr,r.following_state,'state');const times=cell(tr,'','video-times');if(r.recent_video_times?.length){for(const value of r.recent_video_times.slice(0,3)){const line=document.createElement('div');line.textContent=new Date(value).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',hour12:false});times.append(line)}const ago=document.createElement('small');ago.textContent='最新距今 '+x.age+' 天';times.append(ago)}else times.textContent=r.recent_videos_status==='empty'?'无作品':r.recent_videos_status==='private'?'未知（私密）':r.recent_videos_status==='unknown'?'未知（未能读取）':'尚未获取';
    cell(tr,opened.has(r.uid)?'已请求打开主页':'尚未打开','state');cell(tr,'').append(profileLink(r));$('rows').append(tr);
  }
  if(!filtered.length){const tr=document.createElement('tr'),td=cell(tr,$('filter-error').hidden?'没有符合当前筛选条件的账号':'请修正筛选条件','empty');td.colSpan=12;$('rows').append(tr)}
  wrap.scrollTop=scroll;$('match-count').textContent=fmt(filtered.length);$('page-info').textContent=`共 ${fmt(filtered.length)} 人 · 第 ${filtered.length?page+1:0} / ${Math.ceil(filtered.length/size)} 页 · 每页 ${size} 人`;$('prev').disabled=!page;$('next').disabled=(page+1)*size>=filtered.length;updateActions();
}
function showBatch(message){
  $('batch-panel').hidden=!lastBatch.length;if(!lastBatch.length)return;$('batch-message').textContent=message||'上次打开的主页，可逐个打开或重开整批。';$('batch-links').replaceChildren();
  for(const id of lastBatch){const r=byId.get(id);if(!r)continue;const li=document.createElement('li'),a=profileLink(r);a.textContent=r.nickname+' ↗';li.append(a);$('batch-links').append(li)}
}
async function openBatch(ids){
  if(batchBusy)return;batchBusy=true;updateActions();const account=owner;
  try{await saveChain;const result=await desktop.call('openProfiles',{owner_uid:account,ids});if(owner!==account)return;result.opened.forEach(id=>opened.add(id));lastBatch=result.opened;showBatch(`本批已请求打开 ${result.opened.length} 个主页；请在抖音主页手动操作。`);apply(false)}catch(e){error(e.message)}finally{batchBusy=false;updateActions()}
}
async function reload(){
  if(loading){loadAgain=true;return;}loading=true;
  try{
    await saveChain;const data=await desktop.call('snapshot');const changed=owner!==data.summary.account_uid;owner=data.summary.account_uid;summary=data.summary;rows=data.rows;byId=new Map(rows.map(r=>[r.uid,r]));
    if(changed){selected=new Set(data.review.selected);opened=new Set(data.review.opened);lastBatch=data.review.lastBatch;setSettings(data.review.settings);page=0;}
    $('total').textContent=fmt(rows.length);$('data-status').textContent=summary.source_label+' · 本次主页更新 '+fmt(summary.profiles_refreshed)+' / '+fmt(summary.total)+' · 作品数未知 '+fmt(rows.length-summary.works_verified);$('data-status').classList.toggle('warning',!summary.refresh_complete);
    $('footer').textContent='名单同步：'+date(summary.following_snapshot_at)+' · 指标更新：'+date(summary.profiles_updated_at)+'。打开记录不表示已取关；手动取关后的变化将在下次更新时反映。';apply(false);if(changed)showBatch();
  }catch(e){error(e.message)}finally{loading=false;if(loadAgain){loadAgain=false;setTimeout(reload,100)}}
}
function renderTask(t){
  task=t||{};const r=task.run,p=task.progress||{completed:0,total:0,videos:0};const words={running:r?.phase==='following'?'正在读取关注列表':r?.phase==='videos'?'正在读取视频发布时间':'正在读取主页详情',paused:'已暂停',waiting_login:'等待登录',waiting_verification:'等待手动验证',cooldown:'验证后等待 '+(task.countdown||0)+' 秒',error:'已暂停，等待重试',completed:'采集完成'};
  const sec=task.etaSeconds,minutes=Math.ceil(sec/60),eta=sec===null||sec===undefined?'':` · 预计剩余 ${minutes<60?minutes+' 分钟':Math.floor(minutes/60)+' 小时 '+minutes%60+' 分钟'}（不含暂停与验证）`;
  $('task-status').textContent=(r?`${words[r.status]||r.status} · ${r.phase==='following'?p.total+' 个账号，'+r.pages+' 页':'详情 '+p.completed+' / '+p.total+' · 视频时间 '+(p.videos||0)+' / '+p.total} · ${r.message||''}`:'尚未开始更新，先登录抖音并检查连接')+eta+(task.notice?' · '+task.notice:'');
  $('progress').max=Math.max(1,p.total*2);$('progress').value=p.completed+(p.videos||0);$('refresh').disabled=!!task.busy;$('connect').disabled=!!task.busy;$('pause').disabled=!task.busy;$('resume').disabled=!!task.busy||!r||r.status==='completed';$('verified').hidden=!['waiting_verification','cooldown'].includes(r?.status);$('verified').disabled=!!task.busy;
}
async function act(method,payload){error('');try{const data=await desktop.call(method,payload);renderTask(await desktop.call('state'));return data}catch(e){error(e.message);return null}}
$('login').onclick=()=>act('login');$('connect').onclick=async()=>{const p=await act('probe');if(p){await reload();error(p.matched?'':`样本接口作品数 ${p.api_works}；主页数 ${p.page_works??'尚未读取'}，请查看样本页面。`)}};
$('refresh').onclick=()=>act('start');$('pause').onclick=()=>act('pause');$('resume').onclick=()=>act('resume');$('verified').onclick=()=>act('verified');
$('export').onclick=()=>act('export',{format:$('export-format').value});$('export-review').onclick=async()=>{await saveChain;await act('exportReview')};$('import-review').onclick=async()=>{await saveChain;const r=await act('importReview');if(r){r.selected.forEach(x=>selected.add(x));r.opened.forEach(x=>opened.add(x));lastBatch=r.lastBatch;setSettings(r.settings);apply(false);showBatch()}};
function selectPage(value){const ids=pageRows().map(x=>x.r.uid);ids.forEach(id=>value?selected.add(id):selected.delete(id));write({select:{ids,value}});render()}
$('select-page').onclick=()=>selectPage(true);$('unselect-page').onclick=()=>selectPage(false);$('check-page').onchange=()=>selectPage($('check-page').checked);$('clear-selection').onclick=()=>{selected.clear();write({clearSelected:true});render()};
$('open-next').onclick=()=>openBatch(eligible().slice(0,Number($('batch-size').value)||5));$('reopen').onclick=()=>openBatch(lastBatch.filter(id=>byId.has(id)));$('prev').onclick=()=>{page--;render()};$('next').onclick=()=>{page++;render()};
for(const id of ids)$(id).addEventListener(['search','fans','fans-min','works-limit','works-min','days-min','days-max'].includes(id)?'input':'change',()=>{if(id==='batch-size')updateActions();else apply();write({settings:settings()})});
$('reset').onclick=()=>{setSettings(defaults);apply();write({settings:settings()})};
desktop.onChange(e=>{if(e.task)renderTask({...e.task,notice:e.notice});if(e.version)reload()});
setSettings(defaults);reload();desktop.call('state').then(renderTask).catch(e=>error(e.message));
