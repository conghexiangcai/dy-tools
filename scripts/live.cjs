// Development-only harness. It is excluded from the executable package.
const {_electron}=require('playwright-core');
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'output');
fs.mkdirSync(out,{recursive:true});
const input=path.join(out,'live-command.json'),output=path.join(out,'live-result.json');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const app=await _electron.launch({executablePath:require('electron'),args:[root,'--login'],timeout:45000});
 let dashboard;for(let i=0;i<100;i++){dashboard=app.windows().find(p=>p.url()==='app://local/index.html');if(dashboard)break;await delay(100)}
 if(!dashboard)throw Error('主界面未启动');await dashboard.waitForSelector('#total');
 console.log('软件已打开，等待手动登录。');fs.writeFileSync(output,JSON.stringify({ready:true}));
 let last='';let closed=false;app.on('close',()=>{closed=true});
 while(!closed){
  if(fs.existsSync(input)){
   const req=JSON.parse(fs.readFileSync(input,'utf8'));
   if(req.id!==last){last=req.id;try{let result;
    if(['probe','state','start','pause','resume'].includes(req.method))result=await dashboard.evaluate(method=>window.desktop.call(method),req.method);
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
