import {BrowserWindow,dialog} from 'electron';
import {readFileSync,writeFileSync} from 'node:fs';
import {Store} from './store';
import {ActionService} from './action-service';
import {DouyinActionWire} from './action-wire';
import {actionItems,selectRows,parseRosters,duplicateMembers} from './tool-rules';
import {ActionKind} from './tool-store';
import {cleanIds} from './domain';
export class ToolUI {
 busy=false;message='';private stopRead=false;
 constructor(private store:Store,public actions:ActionService,private wire:DouyinActionWire,private window:()=>BrowserWindow,private idle:()=>Promise<void>,private notify:()=>void){}
 state(){const owner=this.store.owner(),s=this.store.snapshot();return {owner,name:s.summary.account_name,busy:this.busy,message:this.message,actions:{...this.actions.state(),runs:this.store.tools.runs(owner).map(({items,nonce,...r})=>({...r,total:items.length,done:items.filter(i=>['done','skipped'].includes(i.state)).length}))},ignored:this.store.tools.ignored(owner),transfers:this.store.tools.transfers().map(({items,...t})=>({...t,total:items.length})),rosters:this.store.tools.rosters(owner).map(({members,...g})=>({...g,total:members.length})),snapshot_at:s.summary.following_snapshot_at}}
 pause(){this.stopRead=true;this.actions.pause()}
 private owner(p:any){const owner=this.store.owner();if(!owner||p?.owner!==owner)throw Error('请连接当前账号后重新操作');return owner}
 async command(method:string,p:any){
  if(method==='toolsState')return this.state();const owner=this.owner(p);
  switch(method){
   case 'toolsIgnore':{const s=this.store.snapshot(),ids=new Set(cleanIds(p.ids)),rows=[...s.rows,...s.group_rows].filter(r=>ids.has(r.uid));this.store.tools.ignore(owner,rows);this.notify();return rows.length}
   case 'toolsRestore':this.store.tools.restore(owner,cleanIds(p.ids));this.notify();return true;
   case 'toolsRun':return this.store.tools.run(owner,String(p.id));
   case 'toolsPause':this.pause();return true;
   case 'toolsExecute':{
    if(this.busy)throw Error('正在读取预览');await this.idle();this.owner(p);const r=this.store.tools.run(owner,String(p.id));if(!r||r.nonce!==p.nonce)throw Error('预览已变化');
    // A native confirmation is bound to the frozen preview, owner and exact item count.
    const answer=await dialog.showMessageBox(this.window(),{type:'warning',title:'确认执行',message:({unfollow:'取消关注',follow:'关注迁移',unlike:'取消点赞',uncollect:'取消收藏作品',unrecommend:'撤销推荐'} as any)[r.kind],detail:`账号 UID：${owner}\n范围：${r.scope}\n预览共 ${r.items.length} 项，剩余 ${r.items.filter(i=>!['done','skipped'].includes(i.state)).length} 项。\n确认后将修改抖音账号，执行结果逐项保存。`,buttons:['返回预览','确认执行'],defaultId:0,cancelId:0,noLink:true});
    this.owner(p);if(answer.response!==1)return false;await this.idle();this.owner(p);await this.actions.execute(r.id,r.nonce,p.verified===true);return true;
   }
   case 'toolsPreview':{
    if(this.busy||this.actions.busy)throw Error('已有任务正在执行');await this.idle();this.owner(p);const s=this.store.snapshot();let rows=s.rows,scope='';
    if(p.scope==='filtered'){const settings=p.settings||s.review.settings;rows=selectRows(/^\d+$/.test(settings['group-filter'])?[...s.rows,...s.group_rows]:s.rows,settings,s.review.opened);scope='当前筛选的全部结果（跨全部分页）'}
    else if(p.scope==='group'){const id=String(p.group||''),g=s.group_catalog.find(g=>g.id===id);if(!g)throw Error('请先选择一个具体分组');const status=this.store.groups.state(owner);if(status.error||!status.checked_at)throw Error('请先完整刷新分组再生成取关名单');rows=[...s.rows,...s.group_rows].filter(r=>r.groups_status==='known'&&!r.groups_stale&&Array.isArray(r.groups)&&r.groups.some((g:any)=>g.id===id));scope='分组「'+g.name+'」全部已同步成员（忽略其他筛选，排除忽视名单）'}
    else throw Error('请选择当前筛选或具体分组');return this.store.tools.create(owner,'unfollow',scope,actionItems(rows));
   }
   case 'toolsFreeze':{const s=this.store.snapshot();if(!s.summary.following_snapshot_at)throw Error('请先完整更新当前关注名单');const sourceRun=this.store.db.prepare('SELECT active_run FROM accounts WHERE uid=?').get(owner) as any;const users=this.store.members(sourceRun.active_run),removed=this.store.tools.removed(owner,s.summary.following_snapshot_at);const rows=users.filter(u=>!removed.has(u.uid)).map(u=>({id:u.uid,sec_uid:u.sec_uid,label:u.nickname||u.uid,account:u.unique_id||u.short_id,url:'https://www.douyin.com/user/'+u.sec_uid,state:'pending' as const}));const r=this.store.tools.transfer(owner,s.summary.account_name,s.summary.following_snapshot_at,rows);this.notify();return r.id}
   case 'toolsMigration':{const t=this.store.tools.transfers().find(t=>t.id===p.id);if(!t)throw Error('迁移清单不存在');if(t.source_uid===owner)throw Error('请先登录另一个账号并点击连接当前账号');return this.store.tools.create(owner,'follow','迁移来自 '+t.source_name+'（UID '+t.source_uid+'）的冻结关注名单',t.items.filter(i=>i.id!==owner))}
   case 'toolsMedia':{
    const kind=p.kind as ActionKind;if(!['unlike','uncollect','unrecommend'].includes(kind))throw Error('无效的清理类型');if(this.busy||this.actions.busy)throw Error('已有任务正在执行');this.busy=true;this.stopRead=false;this.message='正在读取完整列表，只生成预览';this.notify();
    try{await this.idle();const check=()=>{this.owner(p);if(this.stopRead)throw Error('已停止读取，未生成可执行名单')};check();const cx=await this.wire.connect(owner),items=await cx.list(kind,n=>{this.message='已读取 '+n+' 个作品，完整读取后生成预览';this.notify()},check);check();this.message='已读取 '+items.length+' 个作品';return this.store.tools.create(owner,kind,kind==='unlike'?'当前账号全部点赞作品':kind==='uncollect'?'当前账号全部收藏作品（视频和图文，不含音乐、合集等其他收藏类型）':'当前账号主动推荐过的全部作品',items)}catch(e:any){this.message=e.message;if(e.code==='CAPTCHA'||e.code==='LOGIN')this.wire.show();throw e}finally{this.busy=false;this.notify()}
   }
   case 'toolsRosterImport':{const pick=await dialog.showOpenDialog(this.window(),{properties:['openFile'],filters:[{name:'群成员名单 JSON',extensions:['json']}]});if(pick.canceled)return false;this.owner(p);const raw=readFileSync(pick.filePaths[0],'utf8');if(raw.length>50_000_000)throw Error('文件过大');const groups=parseRosters(JSON.parse(raw));this.store.transaction(()=>{for(const g of groups)this.store.tools.putRoster(owner,g)});this.notify();return groups.length}
   case 'toolsRosterRemove':this.store.tools.removeRoster(owner,String(p.id));this.notify();return true;
   case 'toolsDuplicates':{if(!Array.isArray(p.ids)||p.ids.length<2)throw Error('请至少选择两个群');const groups=this.store.tools.rosters(owner).filter(g=>p.ids.includes(g.id));if(groups.length<2)throw Error('请至少选择两个有效群');return {groups:groups.map(({members,...g})=>({...g,total:members.length})),rows:duplicateMembers(groups),queried_at:new Date().toISOString()}}
   case 'toolsExport':{
    let data:any;if(p.type==='run'){data=this.store.tools.run(owner,String(p.id));if(!data)throw Error('任务不存在');data=structuredClone(data);delete data.nonce}else if(p.type==='transfer'){data=this.store.tools.transfers().find(t=>t.id===p.id);if(!data||data.source_uid!==owner)throw Error('请切换到原账号导出')}else if(p.type==='template')data={groups:[{id:'example-group-1',name:'示例群一',source:'请替换为你有权查看的群成员名单',members:[{uid:'10001',nickname:'示例成员'}]},{id:'example-group-2',name:'示例群二',members:[{uid:'10001',nickname:'示例成员'}]}]};else if(p.type==='duplicates'){const groups=this.store.tools.rosters(owner).filter(g=>Array.isArray(p.ids)&&p.ids.includes(g.id));data={account_uid:owner,groups:groups.map(({members,...g})=>({...g,total:members.length})),rows:duplicateMembers(groups),queried_at:new Date().toISOString()}}else throw Error('不支持的导出');
    const save=await dialog.showSaveDialog(this.window(),{defaultPath:'抖音工具箱-'+p.type+'.json',filters:[{name:'JSON',extensions:['json']}]});if(save.canceled||!save.filePath)return false;writeFileSync(save.filePath,JSON.stringify(data,null,2));return true;
   }
   default:throw Error('不支持的工具箱操作');
  }
 }
}
