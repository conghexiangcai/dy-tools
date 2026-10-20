import {BrowserWindow,dialog} from 'electron';
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {ChatService} from './chat-service';
import {Store} from './store';
import {FanWire} from './fanclub-service';
import {FanUser,FanSearchPage,lookupKind,accountKeyword} from './fanclub';
import {ChatSnapshot,ChatResult,inspectChats} from './chat-domain';
import {ImportFile,readChatFile,mapChatFile,chatBundle,chatWorkbook} from './chat-files';
import {CollectError} from './transport';
export class ChatUI{
 private reading=false;private revision=0;private preview:{owner:string;token:string;file:ImportFile}|null=null;
 private target:{owner:string;user:FanUser;input:string;mode:string}|null=null;private search:{owner:string;token:string;input:string;page:FanSearchPage}|null=null;
 private result:{owner:string;value:ChatResult;ids:string[];snapshots:ChatSnapshot[]}|null=null;
 private pending:{owner:string;method:string;payload:any}|null=null;
 message='';countdown=0;
 constructor(public service:ChatService,private store:Store,private wire:FanWire,private window:()=>BrowserWindow,private idle:()=>Promise<void>,private changed:()=>void,private open:(u:FanUser)=>Promise<void>){}
 profileMeta(sec:string){return this.target?.owner===this.store.owner()&&this.target.user.sec_uid===sec?this.target.user:undefined}
 get busy(){return this.reading||this.service.busy}
 pause(){this.revision++;this.service.pause()}
 state(){const owner=this.store.owner();this.service.store.migrate(owner,this.store.tools.rosters(owner));return {owner,busy:this.busy,capability:this.service.wire.capability,catalog:this.service.store.catalog(owner),snapshots:this.service.store.snapshots(owner).map(({members,...s})=>({...s,total:members.length})),run:this.service.store.latest(owner),message:this.message||this.service.message,countdown:this.countdown||this.service.countdown,target:this.target?.owner===owner?this.target.user:null,targetMode:this.target?.owner===owner?this.target.mode:null,targetInput:this.target?.owner===owner?this.target.input:null,search:this.search?.owner===owner?this.search:null,pending:this.pending?.owner===owner||this.service.store.catalog(owner)?.status==='waiting_verification',result:this.result?.owner===owner?{...this.result.value,rows:undefined,total:this.result.value.rows.length}:null,imports:this.service.store.imports(owner).map(i=>({at:i.at,total:i.unresolved.length}))}}
 private owner(p:any){const owner=this.store.owner();if(!owner||p?.owner!==owner)throw Error('请连接当前账号后重试');return owner}
 private selected(owner:string,ids:unknown){if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'))throw Error('快照选择无效');return [...new Set<string>(ids)].map(id=>{const s=this.service.store.get(owner,id);if(!s)throw Error('快照不存在或属于其他账号');return s})}
 private async resolve(method:string,p:any){if(this.busy)throw Error('请先暂停当前任务');await this.idle();const owner=this.owner(p),revision=++this.revision;this.reading=true;this.pending=null;this.changed();const check=()=>{this.owner(p);if(revision!==this.revision)throw new CollectError('PAUSED','识别已暂停，请重新识别')};
  try{
   let raw=String(p.input||''),binding:FanUser|undefined;if(method==='chatChoose'){const s=this.search;if(s?.owner!==owner||s.token!==p.token||s.input!==raw.trim())throw Error('搜索条件已变化，请重新识别');binding=s.page.users.find(u=>u.uid===p.uid);if(!binding)throw Error('请选择当前搜索结果');}
   const mode=String(p.mode||'auto'),kind=lookupKind(raw,mode);if(method!=='chatMore')this.target=null;
   const cx=await this.wire.connect(owner);check();let result:any;
   for(let n=0;;n++){try{if(kind==='account'&&!binding){if(!cx.search)throw Error('当前连接不支持搜索');const old=this.search;if(method==='chatMore'&&(old?.owner!==owner||old.token!==p.token||old.input!==raw.trim()||!old.page.more))throw Error('搜索结果已变化');result=await cx.search(accountKeyword(raw),method==='chatMore'?old!.page.cursor:0,method==='chatMore'?old!.page.search_id:undefined)}else result=await cx.resolve(binding?.sec_uid||raw);break}catch(e:any){if(!['NETWORK','TIMEOUT','EMPTY'].includes(e.code)||n>=2)throw e;check();await new Promise(r=>setTimeout(r,(n+1)*2000));check()}}
   await cx.assert();check();if(kind==='account'&&!binding){if(method==='chatMore'){const seen=new Set(this.search!.page.users.map(u=>u.uid));result.users=[...this.search!.page.users,...result.users.filter((u:FanUser)=>!seen.has(u.uid))]}this.search={owner,token:randomUUID(),input:raw.trim(),page:result};this.message='请选择并核对搜索结果'}else{if(binding&&result.user.uid!==binding.uid)throw Error('搜索结果与主页身份不一致');this.target={owner,user:result.user,input:raw.trim(),mode};this.search=null;this.message='账号已识别，请核对后在所选群中查找'}
  }catch(e:any){check();this.message=e.message;if(['LOGIN','CAPTCHA'].includes(e.code)){this.pending={owner,method,payload:p};this.wire.show()}throw e}finally{this.reading=false;this.changed()}}
 async command(method:string,p:any){
  if(method==='chatState')return this.state();const owner=this.owner(p);
  switch(method){
   case 'chatCatalog':await this.idle();this.owner(p);await this.service.catalog();return true;
   case 'chatScan':await this.idle();this.owner(p);await this.service.start(Array.isArray(p.ids)?p.ids:[]);return true;
   case 'chatPause':this.pause();return true;
   case 'chatResume':await this.idle();this.owner(p);await this.service.resume();return true;
   case 'chatVerified':{
    if(this.busy)throw Error('任务仍在处理');await this.idle();const pending=this.pending;if(!pending){await this.service.resume(true);return true}if(pending.owner!==owner)throw Error('验证任务属于其他账号');this.reading=true;const rev=this.revision;
    try{for(let n=5;n>0;n--){this.countdown=n;this.changed();await new Promise(r=>setTimeout(r,1000));this.owner(p);if(rev!==this.revision)throw Error('已暂停')}if(await this.wire.challenge())throw Error('验证码尚未解除，请继续处理')}finally{this.reading=false;this.countdown=0;this.changed()}return this.resolve(pending.method,pending.payload);
   }
   case 'chatResolve':case 'chatChoose':case 'chatMore':await this.resolve(method,p);return true;
   case 'chatProfile':if(this.target?.owner!==owner||this.target.user.uid!==p.uid)throw Error('目标账号已变化');await this.open(this.target.user);return true;
   case 'chatInspect':{
    if(!['duplicates','find','compare'].includes(p.kind))throw Error('检索类型无效');const left=this.selected(owner,p.ids),right=p.kind==='compare'?this.selected(owner,p.other):[];
    if(p.kind==='compare'&&left.some(s=>s.origin!=='import'))throw Error('左侧请选择导入名单');if(p.kind==='find'&&(this.target?.owner!==owner||(this.target.input!==String(p.input||'').trim()||this.target.mode!==String(p.mode||'auto'))))throw Error('输入已变化，请重新识别账号');
    const value=inspectChats(p.kind,left,right,p.kind==='find'?this.target!.user.uid:undefined),ids=[...new Set(value.scope.map(s=>s.snapshot_id))];this.result={owner,value,ids,snapshots:[...new Map([...left,...right].filter(s=>ids.includes(s.id)).map(s=>[s.id,s])).values()]};this.changed();return true;
   }
   case 'chatRows':{
    const result=this.result?.owner===owner?this.result.value:null;if(!result)return {rows:[],total:0};const q=String(p.q||'').trim().toLowerCase(),category=String(p.category||'');const rows=result.rows.filter(r=>(!category||r.category===category)&&(!q||[r.nickname,r.alias,r.uid,...r.groups.map(g=>g.name)].join(' ').toLowerCase().includes(q)));const page=Number.isSafeInteger(p.page)&&p.page>=0?p.page:0;return {rows:rows.slice(page*100,page*100+100),total:rows.length};
   }
   case 'chatImportPreview':{
    const pick=await dialog.showOpenDialog(this.window(),{properties:['openFile'],filters:[{name:'群成员 JSON / Excel',extensions:['json','xlsx']}]});if(pick.canceled)return null;this.owner(p);const file=await readChatFile(pick.filePaths[0]);this.owner(p);this.preview={owner,token:randomUUID(),file};return {token:this.preview.token,source:file.source,payload:file.payload?{groups:file.payload.snapshots.map(s=>({name:s.group.name,total:s.members.length,complete:s.complete})),unresolved:file.payload.unresolved.length}:null,sheets:file.sheets?.map(s=>({name:s.name,headers:s.headers,sample:s.rows.slice(0,5)}))};
   }
   case 'chatImportCommit':{
    const v=this.preview;if(v?.owner!==owner||v.token!==p.token)throw Error('导入预览已失效，请重新选择文件');const parsed=mapChatFile(v.file,p.mapping||{});const ids=this.service.store.import(owner,parsed);this.preview=null;this.message=`已保存 ${ids.length} 份独立快照；${parsed.unresolved.length} 行待处理`;this.changed();return {ids,unresolved:parsed.unresolved.length};
   }
   case 'chatExport':{
    const format=p.format;if(!['json','xlsx'].includes(format))throw Error('请选择 JSON 或 Excel');let snapshots:ChatSnapshot[],result:ChatResult|undefined,unresolved:any[]=[];
    if(p.scope==='result'){if(this.result?.owner!==owner)throw Error('请先进行检索');result=this.result.value;snapshots=this.result.snapshots}else if(p.scope==='unresolved'){snapshots=[];unresolved=this.service.store.imports(owner).flatMap(i=>i.unresolved)}else snapshots=this.selected(owner,p.ids);
    if(!snapshots.length&&!unresolved.length)throw Error('没有可导出的名单或待处理行');const save=await dialog.showSaveDialog(this.window(),{defaultPath:'群成员-'+(p.scope==='result'?'检索结果':p.scope==='unresolved'?'待处理':'名单')+'.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});if(save.canceled||!save.filePath)return false;this.owner(p);
    const content=format==='json'?JSON.stringify({...chatBundle(snapshots,unresolved),...(result?{result}:{})},null,2):await chatWorkbook(snapshots,result,unresolved);this.owner(p);writeFileSync(save.filePath,content);return true;
   }
   default:throw Error('不支持的群成员操作');
  }
 }
}
