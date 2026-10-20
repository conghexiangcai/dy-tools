import ExcelJS from 'exceljs';
import {readFileSync,statSync} from 'node:fs';
import path from 'node:path';
import {losslessJSON} from './groups';
import {ChatSnapshot,ChatResult,ChatBundle,PendingRow,parseChatJSON,reliableUID,safeGroupID,textValue} from './chat-domain';
export type Mapping={sheet:string;uid:string;account?:string;nickname?:string;alias?:string;sec_uid?:string;group_id?:string;group_name?:string;single_id?:string;single_name?:string};
export type ImportFile={source:string;payload?:{snapshots:ChatSnapshot[];unresolved:PendingRow[]};sheets?:{name:string;headers:string[];rows:unknown[][]}[]};
const columns=['快照ID','群ID','群名','类型','声明人数','来源','扫描时间','完整','说明'];
const memberColumns=['快照ID','群ID','UID','sec_uid','昵称','群昵称'];
function value(c:ExcelJS.Cell):unknown{const v=c.value;if(typeof v==='string'||typeof v==='number'||typeof v==='boolean'||v===null)return v;if(v&&typeof v==='object'&&'richText' in v)return v.richText.map(x=>x.text).join('');return null}
export async function readChatFile(file:string):Promise<ImportFile>{
 if(statSync(file).size>50_000_000)throw Error('文件超过 50 MB，请拆分导入');const source=path.basename(file);
 if(path.extname(file).toLowerCase()==='.json')return {source,payload:parseChatJSON(losslessJSON(readFileSync(file,'utf8')),source)};
 if(path.extname(file).toLowerCase()!=='.xlsx')throw Error('仅支持 JSON 或 XLSX');
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(file);let count=0;
 const sheets=book.worksheets.map(s=>{if(s.actualColumnCount>100||s.rowCount>300001)throw Error('表格过大：每表最多 300,000 行、100 列');const headers=Array.from({length:s.actualColumnCount},(_,i)=>String(value(s.getRow(1).getCell(i+1))??''));const rows:unknown[][]=[];s.eachRow((r,n)=>{if(n===1)return;if(++count>300000)throw Error('一次导入最多 300,000 行');rows.push(headers.map((_,i)=>value(r.getCell(i+1))))});return {name:s.name,headers,rows}});
 const groups=sheets.find(s=>s.name==='群信息'),members=sheets.find(s=>s.name==='成员');
 if(groups&&members&&columns.every(c=>groups.headers.includes(c))&&memberColumns.every(c=>members.headers.includes(c))){
  const gs=groups.rows.map(r=>Object.fromEntries(groups.headers.map((h,i)=>[h,r[i]]))),ms=members.rows.map(r=>Object.fromEntries(members.headers.map((h,i)=>[h,r[i]]))),seen=new Set<string>();
  const data=gs.map(g=>{const sid=safeGroupID(g['快照ID']);if(!sid||seen.has(sid))throw Error('快照 ID 缺失或重复');seen.add(sid);return {group:{id:g['群ID'],name:g['群名'],kind:g['类型'],expected:typeof g['声明人数']==='number'?g['声明人数']:null},source:g['来源'],collected_at:g['扫描时间'],complete:g['完整']==='是',reason:g['说明'],members:ms.filter(m=>m['快照ID']===sid).map(m=>{if(m['群ID']!==g['群ID'])throw Error('群信息与成员群 ID 不一致');return {uid:m['UID'],sec_uid:m.sec_uid,nickname:m['昵称'],alias:m['群昵称'],account:m['抖音号']}})}});
  if(ms.some(m=>!seen.has(String(m['快照ID']))))throw Error('成员表包含群信息表中不存在的快照');return {source,payload:parseChatJSON({snapshots:data},source)};
 }
 if(!sheets.length)throw Error('Excel 没有工作表');return {source,sheets};
}
export function mapChatFile(file:ImportFile,map:Mapping){
 if(file.payload)return file.payload;const sheet=file.sheets?.find(s=>s.name===map.sheet);if(!sheet)throw Error('请选择工作表');
 // Column indices, not header text, distinguish duplicate or blank external headers.
 const index=(key?:string)=>key!==undefined&&/^\d+$/.test(key)&&Number(key)<sheet.headers.length?Number(key):-1;
 if(index(map.uid)<0)throw Error('请选择可靠 UID 所在列');const get=(row:unknown[],key?:string)=>row[index(key)];
 const groups=new Map<string,any>(),unresolved:PendingRow[]=[];const defaultID=safeGroupID(map.single_id);
 if(index(map.group_id)<0&&!defaultID)throw Error('请选择群 ID 列，或填写这份名单的群 ID');
 for(const [n,row] of sheet.rows.entries()){
  const uid=reliableUID(get(row,map.uid)),id=index(map.group_id)>=0?safeGroupID(get(row,map.group_id)):defaultID;
  if(!uid||!id){unresolved.push({sheet:sheet.name,row:n+2,reason:!uid?'缺少可靠 UID，公式或超过 15 位的数值 ID 不用于匹配':'缺少可靠群 ID',values:row.map(v=>String(v??'').slice(0,300))});continue}
  if(!groups.has(id))groups.set(id,{id,name:textValue(get(row,map.group_name))||map.single_name||id,complete:false,source:file.source,members:[]});
  groups.get(id).members.push({uid,sec_uid:get(row,map.sec_uid),nickname:get(row,map.nickname),alias:get(row,map.alias),account:get(row,map.account)});
 }
 const parsed=parseChatJSON({groups:[...groups.values()]},file.source);return {snapshots:parsed.snapshots,unresolved:[...unresolved,...parsed.unresolved]};
}
export function chatBundle(snapshots:ChatSnapshot[],unresolved:PendingRow[]=[]):ChatBundle{return {format:'douyin-chat-members',version:1,exported_at:new Date().toISOString(),snapshots,unresolved}}
function sheet(book:ExcelJS.Workbook,name:string,headers:string[]){const s=book.addWorksheet(name);s.addRow(headers);s.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};s.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF215C4D'}};s.views=[{state:'frozen',ySplit:1}];s.columns.forEach((c,i)=>{c.width=i===0?38:24;c.numFmt='@'});s.autoFilter={from:{row:1,column:1},to:{row:1,column:headers.length}};return s}
export async function chatWorkbook(snapshots:ChatSnapshot[],result?:ChatResult,unresolved:PendingRow[]=[]):Promise<Buffer>{
 const book=new ExcelJS.Workbook();book.creator='抖音整理箱';const g=sheet(book,'群信息',columns),m=sheet(book,'成员',[...memberColumns,'抖音号']);
 for(const s of snapshots){g.addRow([s.id,s.group.id,s.group.name,s.group.kind,s.group.expected,s.source,s.collected_at,s.complete?'是':'否',s.reason]);for(const u of s.members)m.addRow([s.id,s.group.id,u.uid,u.sec_uid,u.nickname,u.alias,u.account||''])}
 if(result){const r=sheet(book,'检索结果',['UID','sec_uid','昵称','群昵称','抖音号','分类','所属群','群数','查询时间','范围说明']);for(const u of result.rows)r.addRow([u.uid,u.sec_uid,u.nickname,u.alias,u.account||'',u.category||result.status||'重复成员',u.groups.map(g=>(g.side?g.side+'：':'')+g.name+' ['+g.id+']').join('；'),String(new Set(u.groups.map(g=>g.id)).size),result.queried_at,result.note]);const info=sheet(book,'检索说明',['项目','值']);for(const pair of [['模式',result.kind],['目标 UID',result.target_uid||''],['查询时间',result.queried_at],['结果人数',String(result.rows.length)],['状态',result.status||''],['范围',result.note]])info.addRow(pair)}
 if(unresolved.length){const s=sheet(book,'待处理',['工作表','原行号','原因','原值']);for(const r of unresolved)s.addRow([r.sheet,String(r.row),r.reason,r.values.join(' | ')])}
 return Buffer.from(await book.xlsx.writeBuffer());
}
