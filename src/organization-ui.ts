import {BrowserWindow,dialog} from 'electron';
import {writeFileSync} from 'node:fs';
import ExcelJS from 'exceljs';
import {Store} from './store';
import {ActivityService} from './activity-service';
import {GroupManager} from './group-manager';
import {GroupService} from './group-service';
import {ChatUI} from './chat-ui';
import {changeLabels} from './activity-domain';
import {selectRows,actionItems} from './tool-rules';
import {cleanIds} from './domain';
export class OrganizationUI{
 private staged:{owner:string;ids:string[]}|null=null;
 constructor(public store:Store,public activity:ActivityService,public manager:GroupManager,private groups:GroupService,private chats:ChatUI,private window:()=>BrowserWindow,private idle:()=>Promise<void>,private changed:()=>void,private open:(uid:string,sec:string,name:string)=>Promise<void>){}
 get busy(){return this.activity.busy||this.manager.busy}
 pause(){this.activity.pause();this.manager.pause()}
 private owner(p:any){const o=this.store.owner();if(!o||p?.owner!==o)throw Error('页面登录账号已变化，请重新连接');return o}
 state(){const owner=this.store.owner();this.activity.store.sync(owner);return {owner,name:this.store.snapshot().summary.account_name,groups:this.groups.state(),capabilities:this.manager.capabilities,rows:this.manager.rows(),activity:this.activity.state(),batches:this.manager.list().map(r=>({...r,items:undefined,total:r.items.length,done:r.items.filter(i=>['done','skipped'].includes(i.state)).length})),snapshots:this.activity.store.list(owner).map(s=>({...s,members:undefined,total:s.members.length})),changes:this.activity.store.changes(owner).map(c=>({...c,rows:undefined,total:c.rows.length,added:c.rows.filter(r=>r.type==='added').length,removed:c.rows.filter(r=>r.type==='removed').length,renamed:c.rows.filter(r=>r.type==='renamed').length})),chat:this.chats.state(),busy:this.busy,groupBusy:this.manager.busy,groupCountdown:this.manager.countdown,staged:this.staged?.owner===owner?this.staged.ids:[]}}
 async command(method:string,p:any){if(method==='orgState')return this.state();const owner=this.owner(p);
  switch(method){
   case 'orgPause':this.pause();return true;
   case 'orgRefresh':await this.idle();this.owner(p);await this.activity.start(p.kind);return true;
   case 'orgResume':await this.idle();this.owner(p);await this.activity.resume(p.verified===true,p.kind);return true;
   case 'orgGroupsRefresh':await this.idle();this.owner(p);return this.groups.refresh();
   case 'orgGroupsVerified':await this.idle();this.owner(p);await this.groups.verified();return true;
   case 'orgBatch':return this.manager.get(owner,String(p.id));
   case 'orgPreview':await this.idle();this.owner(p);return this.manager.preview(cleanIds(p.ids),p.operation,cleanIds(p.source),cleanIds(p.target));
   case 'orgExecute':{
    await this.idle();this.owner(p);const r=this.manager.get(owner,String(p.id));if(!r||r.nonce!==p.nonce)throw Error('预览失效');const labels={add:'加入分组',copy:'复制到分组',move:'移动分组',remove:'移出分组'};
    const answer=await dialog.showMessageBox(this.window(),{type:'warning',title:'确认分组操作',message:labels[r.operation],detail:`登录 UID：${owner}\n来源：${r.source.map(g=>r.names[g]).join('、')||'所选账号'}\n目标：${r.target.map(g=>r.names[g]).join('、')||'无'}\n固定名单 ${r.items.length} 人，将逐人修改抖音分组并回读。`,buttons:['返回预览','确认执行'],defaultId:0,cancelId:0,noLink:true});this.owner(p);if(answer.response!==1)return false;await this.idle();this.owner(p);await this.manager.execute(r.id,r.nonce,p.verified===true);return true;
   }
   case 'orgStage':{const s=this.store.snapshot(),rows=[...s.rows,...s.group_rows];const ids=p.scope==='filtered'?selectRows(/^\d+$/.test(String((p.settings||{})['group-filter']))?rows:s.rows,p.settings||s.review.settings,s.review.opened).map(r=>r.uid):rows.filter(r=>s.review.selected.includes(r.uid)).map(r=>r.uid);if(!ids.length)throw Error('没有可以加入分组的账号');this.staged={owner,ids};return true;}
   case 'orgClearStage':this.staged=null;return true;
   case 'orgRows':return this.manager.rows(p.includeIgnored===true);
   case 'orgProfile':{const uid=String(p.uid),sec=String(p.sec||'');if(!/^[A-Za-z0-9_-]{8,200}$/.test(sec))throw Error('该成员暂无可靠主页地址');const row=this.manager.rows(true).find(r=>r.uid===uid&&r.sec_uid===sec)||this.activity.store.list(owner).flatMap(s=>s.members).find(r=>r.uid===uid&&r.sec_uid===sec);if(!row)throw Error('目标不在当前账号名单中');await this.open(uid,sec,row.nickname||uid);return true;}
   case 'orgIgnore':{const ids=new Set(cleanIds(p.ids)),rows=this.manager.rows().filter(r=>ids.has(r.uid));this.store.tools.ignore(owner,rows);this.changed();return rows.length;}
   case 'orgUnfollow':{const state=this.groups.state();if(!state.checked_at||state.error)throw Error('请先完整刷新分组');const ids=new Set(cleanIds(p.ids)),rows=this.manager.rows().filter(r=>ids.has(r.uid));if(!rows.length||rows.length!==ids.size)throw Error('选择名单已变化');return this.store.tools.create(owner,'unfollow','分组管家所选成员（已冻结 UID 名单）',actionItems(rows));}
   case 'orgCompare':this.activity.store.sync(owner);return this.activity.store.compare(owner,String(p.before),String(p.after));
   case 'orgExport':{
    if(!['json','xlsx'].includes(p.format))throw Error('请选择 JSON 或 Excel');let data:any,columns:string[],values:string[][],name:string;
    if(p.type==='groups'){const ids=new Set(cleanIds(p.ids)),rows=this.manager.rows(p.includeIgnored===true).filter(r=>ids.has(r.uid));if(!rows.length)throw Error('请选择成员');data={format:'douyin-follow-group-members',version:1,owner,exported_at:new Date().toISOString(),groups:this.store.groups.state(owner),members:rows};name='分组成员';columns=['UID','sec_uid','昵称','抖音号','私密账号','分组 ID','分组名称','归属完整性'];values=rows.map(r=>[r.uid,r.sec_uid,r.nickname,r.account,r.is_private===true?'是':r.is_private===false?'否':'未知',(Array.isArray(r.groups)?r.groups:[]).map((g:any)=>g.id).join(','),(Array.isArray(r.groups)?r.groups:[]).map((g:any)=>g.name).join('、'),r.groups_status==='known'&&!r.groups_stale?'已核实':'未知或未更新'])}
    else{const c=this.activity.store.compare(owner,String(p.before),String(p.after));data={format:'douyin-membership-changes',version:1,...c,snapshots:[c.before,c.after].map(id=>{const s=this.activity.store.get(owner,id)!;return {id:s.id,origin:s.origin,complete:s.complete,reason:s.reason,total:s.members.length,collected_at:s.at,started_at:s.started_at}}),note:'变化发生在两次采集之间；不代表准确时间或减少原因'};name=c.kind==='chat'?'群成员变动':'关注动态';columns=['UID','sec_uid','昵称','抖音号','群昵称','变化','原昵称','原群昵称','来源'];values=c.rows.map(r=>[r.uid,r.sec_uid||'',r.nickname||'',r.account||'',r.alias||'',changeLabels(r.type),r.before?.nickname||'',r.before?.alias||'',r.operation||'两次完整名单比较'])}
    const pick=await dialog.showSaveDialog(this.window(),{defaultPath:name+'.'+p.format,filters:[{name:p.format.toUpperCase(),extensions:[p.format]}]});if(pick.canceled||!pick.filePath)return false;this.owner(p);
    if(p.format==='json')writeFileSync(pick.filePath,JSON.stringify(data,null,2));else{const book=new ExcelJS.Workbook(),info=book.addWorksheet('比较与来源');info.addRow(['项目','值']);const meta=p.type==='groups'?{owner,exported_at:data.exported_at,checked_at:data.groups.checked_at,error:data.groups.error}:Object.fromEntries(Object.entries(data).filter(([k])=>k!=='rows'));for(const [k,v] of Object.entries(meta))info.addRow([k,typeof v==='object'?JSON.stringify(v):String(v??'')]);const sheet=book.addWorksheet(p.type==='groups'?'成员':'变化记录');sheet.addRow(columns);for(const row of values)sheet.addRow(row.map(String));sheet.columns.forEach(c=>{c.numFmt='@';c.width=22});const bytes=await book.xlsx.writeBuffer();this.owner(p);writeFileSync(pick.filePath,Buffer.from(bytes))}return true;
   }
   default:throw Error('不支持的分组或动态操作');
  }
 }
}
