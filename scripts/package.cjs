const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const pkg=require('../package.json');
const root=path.resolve(__dirname,'..'),release=path.join(root,'release'),name='抖音整理箱-'+pkg.version+'-win-x64',dest=path.join(release,name);
fs.mkdirSync(release,{recursive:true});
// Do not remove previous distributions. A second build uses a timestamped directory.
const target=fs.existsSync(dest)?dest+'-'+Date.now():dest;
fs.cpSync(path.dirname(require('electron')),target,{recursive:true});
fs.renameSync(path.join(target,'electron.exe'),path.join(target,'抖音整理箱.exe'));
const bundle=path.join(target,'resources','app');fs.mkdirSync(bundle,{recursive:true});
const templates=['report-template.html','desktop-report-template.html'];
for(const folder of ['dist','public'])fs.cpSync(path.join(root,folder),path.join(bundle,folder),{recursive:true,filter:src=>!src.split(path.sep).includes('tests')});
fs.mkdirSync(path.join(bundle,'resources'));for(const file of templates)fs.copyFileSync(path.join(root,'resources',file),path.join(bundle,'resources',file));
fs.writeFileSync(path.join(bundle,'package.json'),JSON.stringify({name:pkg.name,productName:pkg.productName,version:pkg.version,main:pkg.main}));
fs.copyFileSync(path.join(root,'README.md'),path.join(target,'使用说明.md'));
fs.copyFileSync(path.join(root,'VERIFICATION-'+pkg.version+'.md'),path.join(target,'验证说明.md'));
fs.copyFileSync(path.join(root,'LICENSE-NOTICE.md'),path.join(target,'许可说明.md'));
const sourceBase=path.join(release,'抖音整理箱-'+pkg.version+'-源码');const source=fs.existsSync(sourceBase)?sourceBase+'-'+Date.now():sourceBase;fs.mkdirSync(source);
for(const file of ['src','public','package.json','package-lock.json','tsconfig.json','README.md','VERIFICATION-'+pkg.version+'.md','LICENSE-NOTICE.md','.gitignore'])fs.cpSync(path.join(root,file),path.join(source,file),{recursive:true});
fs.mkdirSync(path.join(source,'scripts'));for(const file of ['assets.cjs','package.cjs','smoke.cjs','group-smoke.cjs','group-fixture.cjs','fanclub-smoke.cjs','fanclub-fixture.cjs','toolbox-smoke.cjs'])fs.copyFileSync(path.join(root,'scripts',file),path.join(source,'scripts',file));
fs.mkdirSync(path.join(source,'resources'));for(const file of templates)fs.copyFileSync(path.join(root,'resources',file),path.join(source,'resources',file));
// Copy only explicit source folders; databases, login sessions, output and node_modules are excluded.
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
for(const folder of [target,source]){
 const zip=folder+'.zip';
 const result=cp.spawnSync('powershell.exe',['-NoProfile','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory(${quote(folder)},${quote(zip)},[System.IO.Compression.CompressionLevel]::Optimal,$true)`],{stdio:'inherit',windowsHide:true});
 if(result.status!==0)throw Error('压缩失败');
}
fs.writeFileSync(path.join(release,'latest.json'),JSON.stringify({directory:target,executable:path.join(target,'抖音整理箱.exe'),zip:target+'.zip',sourceZip:source+'.zip'},null,2));
console.log(JSON.stringify({directory:target,zip:target+'.zip',sourceZip:source+'.zip'},null,2));
