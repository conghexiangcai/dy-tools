// Adds a user-operated export button without reading browser storage or modifying its contents.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const dir=path.resolve(__dirname,'../../douyin-screening-2026-09-22');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const handler=`
$('export-usage').onclick=()=>{const settings=Object.fromEntries(ids.map(id=>[id,$(id).type==='checkbox'?$(id).checked:$(id).value]));const payload={version:1,account_uid:summary.account_uid,exported_at:new Date().toISOString(),review:{selected:[...selected],opened:[...opened],lastBatch,settings}};const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='抖音使用记录-'+summary.account_uid+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000)};
`;
for(const name of ['report-template-v3.html','筛选名单-v3.html']){
 const file=path.join(dir,name);let html=fs.readFileSync(file,'utf8');if(html.includes('id="export-usage"')){console.log(name+' 已有导出按钮');continue}
 const data=html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1];
 html=html.replace('<p class="small" id="storage-info">','<button class="reset" id="export-usage">导出使用记录</button><p class="small" id="storage-info">');
 const at=html.lastIndexOf('</script>');html=html.slice(0,at)+handler+html.slice(at);
 if(hash(data)!==hash(html.match(/<script id="data" type="application\/json">([\s\S]*?)<\/script>/)[1]))throw Error('内嵌账号数据发生变化，拒绝写入');
 fs.writeFileSync(file,html);console.log(name+'：已添加按钮，账号数据未改动');
}
