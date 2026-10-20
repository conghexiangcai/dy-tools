const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),legacy=path.resolve(root,'../douyin-screening-2026-09-22');
fs.mkdirSync(path.join(root,'resources'),{recursive:true});
for(const [source,dest] of [['screening-results-v3.json','seed.json'],['unfollow-zero-nonmutual-2026-09-24.json','unfollow-history.json'],['report-template-v3.html','report-template.html']]){
  const out=path.join(root,'resources',dest);if(fs.existsSync(path.join(legacy,source)))fs.copyFileSync(path.join(legacy,source),out);else if(!fs.existsSync(out))throw Error('缺少首次导入数据：'+source);
}
const template=fs.readFileSync(path.join(root,'resources/report-template.html'),'utf8');
let css=template.match(/<style>([\s\S]*?)<\/style>/)[1];
css+='\n.appbar{margin:18px 30px 0;background:white;border:1px solid var(--line);border-radius:10px;padding:14px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.appbar .status{width:100%;font-size:13px;color:#526958}.appbar .error{width:100%;margin:0}progress{height:10px;accent-color:var(--green);width:180px}.appbar .spacer{flex:1}.appbar small{color:var(--muted)}';
fs.writeFileSync(path.join(root,'public/style.css'),css);
const domain=require('../dist/domain.js');
fs.writeFileSync(path.join(root,'public/rules.js'),'window.filterDefaults='+JSON.stringify(domain.settingsDefaults)+';\nwindow.classifyRow='+domain.classify.toString()+';\n');
const toolbar=`<section class="appbar"><button id="login">登录抖音</button><button id="connect">连接检查</button><button id="refresh" class="primary">更新数据</button><button id="pause">暂停</button><button id="resume">继续</button><button id="verified" hidden>已完成验证</button><span class="spacer"></span><button id="import-review">导入使用记录</button><button id="export-review">导出使用记录</button><select id="export-format" aria-label="导出格式"><option value="html">HTML</option><option value="json">JSON</option><option value="md">Markdown</option></select><button id="export">导出名单</button><div class="status"><progress id="progress" value="0" max="1"></progress> <span id="task-status">正在读取本地数据…</span></div><div id="app-error" class="error" role="alert" hidden></div></section>`;
let body=template.slice(template.indexOf('<body>')+6,template.indexOf('<script id="data"'));
body=body.replace('</header>','</header>'+toolbar).replace('勾选与打开进度保存在当前浏览器。','勾选与打开进度保存在本机，按抖音账号分别保存。');
body=body.replace(/<button[^>]+id="export-usage"[^>]*>[\s\S]*?<\/button>/,'');
const html=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'"><title>抖音关注清单</title><link rel="stylesheet" href="style.css"></head><body>${body}<script src="rules.js"></script><script src="renderer.js"></script></body></html>`;
fs.writeFileSync(path.join(root,'public/index.html'),html);
