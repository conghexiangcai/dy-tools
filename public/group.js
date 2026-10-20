'use strict';
(()=>{const $=id=>document.getElementById(id);if($('group-open')){$('group-open').onclick=async()=>{try{await desktop.call('groupOpen')}catch(e){$('group-open').title=e.message}};return}
 let token='',busy=false;const message=(text,fail=false)=>{$('group-message').textContent=text||'';$('group-message').classList.toggle('error',fail)};
 function render(dialog,state){
  busy=!!state?.busy;$('group-save').disabled=busy||!dialog;$('group-verified').hidden=!state?.waiting&&!state?.countdown;$('group-verified').disabled=busy;$('group-verified').textContent=state?.countdown?'等待 '+state.countdown+' 秒…':'已完成验证，等待 5 秒';
  for(const c of document.querySelectorAll('#group-options input'))c.disabled=busy;
  if(dialog&&dialog.token!==token){token=dialog.token;$('group-person').textContent=dialog.nickname+' · '+dialog.account;$('group-options').replaceChildren();for(const g of dialog.groups){const l=document.createElement('label'),c=document.createElement('input'),name=document.createElement('span'),count=document.createElement('small');c.type='checkbox';c.value=g.id;c.checked=dialog.selected.includes(g.id);c.disabled=busy;name.textContent=g.name;count.textContent=g.member_count+' 人';l.append(c,name,count);$('group-options').append(l)}if(!dialog.groups.length)message('暂无已有分组，请先在抖音中创建分组。')}
  if(state?.message)message(state.message);else if(dialog)message('选择完成后点击保存。');
 }
 $('group-save').onclick=async()=>{if(busy)return;busy=true;$('group-save').disabled=true;message('正在刷新归属并保存…');try{const result=await desktop.call('groupSave',{token,selected:[...document.querySelectorAll('#group-options input:checked')].map(c=>c.value)});token='';render(result,{busy:false});message(result.message,!result.confirmed)}catch(e){message(e.message,true)}finally{busy=false;$('group-save').disabled=!token}};
 $('group-cancel').onclick=()=>desktop.call('groupCancel');$('group-verified').onclick=async()=>{try{await desktop.call('groupVerified')}catch(e){message(e.message,true)}};
 desktop.onChange(e=>{if(e.groupError)message(e.groupError,true);if(e.groups)render(e.groupDialog,e.groups)});desktop.call('groupDialogState').then(r=>render(r.dialog,r.state)).catch(e=>message(e.message,true));
})();
