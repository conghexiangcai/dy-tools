// Standalone exported HTML uses the same renderer; the desktop bridge is replaced locally.
(()=>{
 const data=JSON.parse(document.getElementById('data').textContent),key='douyin-review-v3:'+data.summary.account_uid;
 let review={selected:[],opened:[],lastBatch:[],settings:{}};try{review={...review,...JSON.parse(localStorage.getItem(key)||'{}')}}catch{}
 function save(){localStorage.setItem(key,JSON.stringify(review))}
 function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}
 window.desktop={onChange:()=>()=>{},call:async(method,p)=>{
  if(method==='snapshot')return {...data,review};
  if(method==='state')return {busy:false,notice:'离线名单；更新数据请使用桌面软件',run:null};
  if(method==='review'){const d=p.delta;if(d.select){const set=new Set(review.selected);d.select.ids.forEach(id=>d.select.value?set.add(id):set.delete(id));review.selected=[...set]}if(d.clearSelected)review.selected=[];if(d.opened)review.opened=[...new Set([...review.opened,...d.opened])];if(d.lastBatch)review.lastBatch=d.lastBatch;if(d.settings)review.settings={...review.settings,...d.settings};save();return true}
  if(method==='openProfiles'){const opened=[];for(const id of p.ids){const r=data.rows.find(r=>r.uid===id);if(!r||!/^https:\/\/www\.douyin\.com\/user\/[\w-]+$/.test(r.profile_url))continue;const w=window.open('about:blank','_blank');if(w){w.opener=null;w.location.replace(r.profile_url);opened.push(id)}}review.opened=[...new Set([...review.opened,...opened])];review.lastBatch=opened;save();return {opened}}
  if(method==='exportReview'){download({version:1,account_uid:data.summary.account_uid,exported_at:new Date().toISOString(),review},'抖音使用记录.json');return true}
  throw Error('此操作请在桌面软件中使用');
 }};
 for(const id of ['login','connect','refresh','pause','resume','verified','import-review','export-format','export','refresh-groups','group-status'])document.getElementById(id).hidden=true;
})();
