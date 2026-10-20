import {cleanUser,count} from './domain';
import {fanWebUser,FanSearchPage} from './fanclub';
import {CollectError} from './transport';
export function parseAccountSearch(data:any,offset=0):FanSearchPage{
  if(!data||!Array.isArray(data.user_list))throw new CollectError('SCHEMA','用户搜索没有返回可识别的账号列表');
  const users:FanSearchPage['users']=[];
  for(const item of data.user_list){try{const u=cleanUser(item.user_info);if(!users.some(x=>x.uid===u.uid))users.push(fanWebUser(u))}catch{throw new CollectError('SCHEMA','用户搜索的账号身份不完整，请稍后重试')}}
  if(![true,false,0,1].includes(data.has_more))throw new CollectError('SCHEMA','用户搜索分页状态异常');
  const more=Boolean(data.has_more),cursor=count(data.cursor)??offset+data.user_list.length;
  if(more&&cursor<=offset)throw new CollectError('SCHEMA','用户搜索分页未前进');
  return {users,cursor,more,...(typeof data.search_id==='string'&&/^[A-Za-z0-9_-]{1,200}$/.test(data.search_id)?{search_id:data.search_id}:{})};
}
