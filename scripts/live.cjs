// Development-only harness. It is excluded from the executable package.
const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output');
fs.mkdirSync(out,{recursive:true});
const input=path.join(out,'live-command.json'),output=path.join(out,'live-result.json');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[root,'--login',...(process.argv.includes('--resume')?['--resume']:[])],timeout:45000});
 let dashboard;for(let i=0;i<100;i++){dashboard=app.windows().find(p=>p.url()==='app://local/index.html');if(dashboard)break;await delay(100)}
 if(!dashboard)throw Error('主界面未启动');await dashboard.waitForSelector('#total');
 console.log('软件已打开，等待手动登录。');fs.writeFileSync(output,JSON.stringify({ready:true}));
 let last='';let closed=false;app.on('close',()=>{closed=true});
 while(!closed){
  if(fs.existsSync(input)){
   const req=JSON.parse(fs.readFileSync(input,'utf8'));
   if(req.id!==last){last=req.id;try{let result;
    if(['probe','state','start','pause','resume'].includes(req.method))result=await dashboard.evaluate(method=>window.desktop.call(method),req.method);
    else if(req.method==='videos'){
     const remote=app.windows().find(p=>p.url().startsWith('https://www.douyin.com'));
     if(!remote)throw Error('请先打开软件内的抖音窗口');
     result=await remote.evaluate(async()=>{const u=new URL('/aweme/v1/web/aweme/post/',location.origin);u.search=new URLSearchParams({device_platform:'webapp',aid:'6383',channel:'channel_pc_web',version_code:'170400',version_name:'17.4.0',update_version_code:'170400',pc_client_type:'1',platform:'PC',sec_user_id:'MS4wLjABAAAA_SYNTHETIC_ARCHIVE_USER',max_cursor:'0',count:'20'});const r=await fetch(u,{credentials:'include'});const d=await r.json();return {status:d.status_code,has_more:d.has_more,max_cursor:d.max_cursor,videos:d.aweme_list?.map(v=>({id:v.aweme_id,created:v.create_time,pinned:v.is_top,author:v.author?.uid})),keys:Object.keys(d)}});
    }
    else if(req.method==='ui'){result={text:await dashboard.locator('body').innerText()};await dashboard.screenshot({path:path.join(out,'playwright','live.png'),fullPage:true})}
    else if(req.method==='window'){result=await app.evaluate(({webContents})=>webContents.getAllWebContents().map(w=>({url:w.getURL(),title:w.getTitle()})))}
    else if(req.method==='remote'){result=await app.evaluate(async({webContents})=>{const w=webContents.getAllWebContents().find(w=>w.getURL().startsWith('https://www.douyin.com'));return w?{text:(await w.executeJavaScript("document.body?.innerText||''")).slice(0,14000)}:{error:'抖音页未打开'}})}
    else if(req.method==='close'){await app.close();result={closed:true}}
    else throw Error('不支持的开发命令');
    fs.writeFileSync(output,JSON.stringify({id:last,ok:true,result},null,2));console.log('已执行 '+req.method);
   }catch(e){fs.writeFileSync(output,JSON.stringify({id:last,ok:false,error:e.message},null,2));console.log('命令失败：'+e.message)}}
  }await delay(300);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
