'use strict';
const $=id=>document.getElementById(id);
let mode='collector';
function render(browser,task,groups,fans,downloads){
  if(browser){mode=browser.mode;$('tabs').replaceChildren();for(const t of browser.tabs){const button=document.createElement('button');button.className='tab'+(browser.active===t.id?' active':'');button.textContent=t.title;button.title=t.title;button.onclick=()=>desktop.call('browserSelect',{id:t.id});if(mode==='review'){const close=document.createElement('span');close.className='close';close.textContent='×';close.setAttribute('role','button');close.onclick=e=>{e.stopPropagation();desktop.call('browserClose',{id:t.id})};button.append(close);}$('tabs').append(button)}}
  const status=task?.run?.status;$('verified').hidden=mode!=='collector'||!['waiting_verification','cooldown'].includes(status);$('verified').disabled=!!task?.busy;$('verified').textContent=status==='cooldown'?`等待 ${task.countdown||0} 秒…`:'已完成验证，等待 5 秒继续';
  if(mode==='review')$('note').textContent='取关请在抖音主页手动完成。此窗口与采集窗口独立。';else if(task?.run?.message)$('note').textContent=task.run.message;
  if(mode==='collector'&&(groups?.waiting||groups?.countdown)){$('verified').hidden=false;$('verified').disabled=!!groups.busy;$('verified').textContent=groups.countdown?'等待 '+groups.countdown+' 秒…':'已完成验证，等待 5 秒继续';$('note').textContent=groups.message}
  if(mode==='collector'&&['waiting_verification','cooldown'].includes(fans?.status)){$('verified').hidden=false;$('verified').disabled=!!fans.busy;$('verified').textContent=fans.countdown?'等待 '+fans.countdown+' 秒…':'已完成验证，等待 5 秒继续';$('note').textContent='粉丝团查询：'+fans.message}
  if(mode==='collector'&&downloads==='verification'){$('verified').hidden=false;$('verified').disabled=false;$('note').textContent='作品下载：请完成验证码后继续';}
}
$('back').onclick=()=>desktop.call('showDashboard');$('verified').onclick=async()=>{try{await desktop.call('verified')}catch(e){$('note').textContent=e.message}};
desktop.onChange(e=>render(e.browser,e.task,e.groups,e.fans,e.downloads));Promise.all([desktop.call('browserState'),desktop.call('state')]).then(([browser,task])=>render(browser,task,task.groups,task.fans));
