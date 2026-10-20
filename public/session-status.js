(() => {
 const login=document.getElementById('login');if(!login||!window.desktop)return;
 const badge=document.createElement('small');badge.id='session-status';badge.setAttribute('role','status');login.insertAdjacentElement('afterend',badge);
 // Module-specific cached owner labels must not masquerade as verified online identity.
 const cached=document.getElementById('owner');if(cached)cached.hidden=true;
 let revision=-1;
 function render(s){if(!s||s.revision<revision)return;revision=s.revision;
  login.textContent=s.status==='connected'?'查看登录账号':s.status==='expired'?'重新登录抖音':s.status==='verification_required'?'查看验证窗口':'登录抖音';
  badge.textContent=s.status==='connected'&&s.owner?`已登录：${s.owner.nickname||s.owner.uid} · UID ${s.owner.uid}`:s.message||'尚未核验登录';
  badge.title=s.checked_at?'最近核验：'+new Date(s.checked_at).toLocaleString():'';
 }
 desktop.onChange(e=>{if(e.session)render(e.session)});
 desktop.call('sessionState').then(render).catch(()=>{badge.textContent='暂时无法读取登录状态'});
})();
