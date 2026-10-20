import {ChatMember,mergeMember} from './chat-domain';
import {FanConnection} from './fanclub-service';
import {CollectError} from './transport';

// Identity-checked profile reads enrich display data, never historical membership snapshots.
export async function enrichChatMembers(rows:ChatMember[],connection:FanConnection,options:{check:()=>void;save:(m:ChatMember)=>void;progress:(done:number,total:number,failed:number)=>void;sleep?:(ms:number)=>Promise<void>}){
 const pending=rows.filter(r=>!r.nickname||!r.account),sleep=options.sleep||((ms:number)=>new Promise<void>(r=>setTimeout(r,ms)));let done=0,failed=0,consecutive=0;
 for(const row of pending){
  options.check();options.progress(done,pending.length,failed);
  try{
   let user;
   for(let attempt=0;;attempt++){
    await sleep(attempt?2000*attempt:1000);options.check();
    try{user=(await connection.resolve(row.sec_uid||row.uid)).user;break}catch(e:any){if(!['NETWORK','TIMEOUT','EMPTY'].includes(e.code)||attempt>=2)throw e}
   }
   await connection.assert();options.check();if(user.uid!==row.uid)throw new CollectError('IDENTITY','返回资料与成员 UID 不匹配，补全已暂停');
   const data=mergeMember({...row,nickname:user.nickname,sec_uid:user.sec_uid,account:user.account===user.uid?'':user.account},row);options.save(data);consecutive=0;
  }catch(e:any){options.check();if(['LOGIN','CAPTCHA','RATE_LIMIT','IDENTITY','ACCOUNT_CHANGED','PAUSED'].includes(e.code))throw e;failed++;if(++consecutive>=3)throw new CollectError('NETWORK','连续三个成员资料读取失败，已保留补全结果，请稍后继续')}
  done++;options.progress(done,pending.length,failed);
 }
 return {done,total:pending.length,failed};
}
