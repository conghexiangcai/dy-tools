import {uidValid} from './domain';
export type ActivityKind='following'|'followers'|'chat';
export type ActivityMember={uid:string;sec_uid?:string;nickname?:string;alias?:string;account?:string};
export type ActivitySnapshot={id:string;owner:string;kind:ActivityKind;scope:string;name:string;at:string|null;started_at?:string;complete:boolean;reason:string;origin:'scan'|'import';members:ActivityMember[]};
export type ChangeRow=ActivityMember&{type:'added'|'removed'|'renamed';before?:ActivityMember;after?:ActivityMember;operation?:string};
export type ChangeSet={id:string;owner:string;kind:ActivityKind;scope:string;name:string;before:string;after:string;from:string;to:string;detected_at:string;complete:true;rows:ChangeRow[]};
export function memberMap(rows:ActivityMember[]){const result=new Map<string,ActivityMember>();for(const u of rows){if(!uidValid(u.uid))throw Error('成员缺少可靠 UID');result.set(u.uid,u)}return result}
export function compareSnapshots(a:ActivitySnapshot,b:ActivitySnapshot):ChangeSet{
 if(a.owner!==b.owner||a.kind!==b.kind||a.scope!==b.scope)throw Error('只能比较同一账号、同一名单或同一群');
 if(a.id===b.id)throw Error('请选择两个不同的历史版本');
 if(!a.complete||!b.complete||!a.at||!b.at||!Number.isFinite(Date.parse(a.at))||!Number.isFinite(Date.parse(b.at)))throw Error('需要两份有采集时间的完整名单；不完整名单不能确认减少');
 if(Date.parse(a.at)>=Date.parse(b.at))throw Error('前一版本时间必须早于后一版本');
 const left=memberMap(a.members),right=memberMap(b.members),rows:ChangeRow[]=[];
 for(const [uid,u] of right){const old=left.get(uid);if(!old)rows.push({...u,type:'added',after:u});else if(a.kind==='chat'&&(['nickname','alias'] as const).some(k=>!!old[k]&&!!u[k]&&old[k]!==u[k]))rows.push({...u,type:'renamed',before:old,after:u})}
 for(const [uid,u] of left)if(!right.has(uid))rows.push({...u,type:'removed',before:u});
 return {id:JSON.stringify([a.id,b.id]),owner:a.owner,kind:a.kind,scope:a.scope,name:b.name,before:a.id,after:b.id,from:a.at,to:b.at,detected_at:new Date().toISOString(),complete:true,rows};
}
export function changeLabels(t:string){return ({added:'新增',removed:'减少',renamed:'资料变化'} as Record<string,string>)[t]||t}
