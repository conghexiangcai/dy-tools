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
// Include only the production dependency graph; never ship development sessions or Electron twice.
const copied=new Set();
function dependency(name,from,optional=false){
 let base=from,dir;
 for(;;){const candidate=path.join(base,'node_modules',name);if(fs.existsSync(path.join(candidate,'package.json'))){dir=candidate;break}const parent=path.dirname(base);if(parent===base)break;base=parent}
 if(!dir){if(optional)return;throw Error('Missing production dependency: '+name)}
 const relative=path.relative(root,dir);if(relative.startsWith('..')||path.isAbsolute(relative))throw Error('Dependency outside project: '+name);
 if(copied.has(dir))return;copied.add(dir);fs.cpSync(dir,path.join(bundle,relative),{recursive:true,filter:src=>!src.split(path.sep).includes('.git')});
 const manifest=JSON.parse(fs.readFileSync(path.join(dir,'package.json'),'utf8'));for(const child of Object.keys(manifest.dependencies||{}))dependency(child,dir,!!manifest.optionalDependencies?.[child]);for(const child of Object.keys(manifest.optionalDependencies||{}))dependency(child,dir,true);
}
for(const name of Object.keys(pkg.dependencies||{}))dependency(name,root);
fs.mkdirSync(path.join(bundle,'resources'));for(const file of templates)fs.copyFileSync(path.join(root,'resources',file),path.join(bundle,'resources',file));
fs.writeFileSync(path.join(bundle,'package.json'),JSON.stringify({name:pkg.name,productName:pkg.productName,version:pkg.version,main:pkg.main}));
fs.copyFileSync(path.join(root,'README.md'),path.join(target,'使用说明.md'));
fs.copyFileSync(path.join(root,'VERIFICATION-'+pkg.version+'.md'),path.join(target,'验证说明.md'));
fs.copyFileSync(path.join(root,'LICENSE-NOTICE.md'),path.join(target,'许可说明.md'));
const sourceBase=path.join(release,'抖音整理箱-'+pkg.version+'-源码');const source=fs.existsSync(sourceBase)?sourceBase+'-'+Date.now():sourceBase;fs.mkdirSync(source);
for(const file of ['src','public','server','package.json','package-lock.json','tsconfig.json','README.md','VERIFICATION-'+pkg.version+'.md','LICENSE-NOTICE.md','.gitignore'])fs.cpSync(path.join(root,file),path.join(source,file),{recursive:true});
fs.mkdirSync(path.join(source,'scripts'));for(const file of ['assets.cjs','package.cjs','smoke.cjs','group-smoke.cjs','group-fixture.cjs','fanclub-smoke.cjs','fanclub-fixture.cjs','toolbox-smoke.cjs','chat-smoke.cjs','checkin-smoke.cjs','organization-smoke.cjs'])fs.copyFileSync(path.join(root,'scripts',file),path.join(source,'scripts',file));
fs.mkdirSync(path.join(source,'resources'));for(const file of templates)fs.copyFileSync(path.join(root,'resources',file),path.join(source,'resources',file));
const serverBase=path.join(release,'粉丝团打卡-'+pkg.version+'-服务器');const server=fs.existsSync(serverBase)?serverBase+'-'+Date.now():serverBase;fs.mkdirSync(server);
for(const module of ['cli','wire','domain','schedule','service','store'])fs.copyFileSync(path.join(root,'dist','checkin-'+module+'.js'),path.join(server,'checkin-'+module+'.js'));
for(const file of ['README.md','使用说明.md','config.example.json','credentials.example.json','checkin.service.example'])fs.copyFileSync(path.join(root,'server',file),path.join(server,file));
fs.writeFileSync(path.join(server,'package.json'),JSON.stringify({name:'douyin-fanclub-checkin',version:pkg.version,private:true,engines:{node:'>=24'},scripts:{check:'node checkin-cli.js --check-auth',inspect:'node checkin-cli.js --inspect',once:'node checkin-cli.js --once',start:'node checkin-cli.js --daemon'}},null,2));
// Copy only explicit source folders; databases, login sessions, output and node_modules are excluded.
const quote=s=>"'"+s.replace(/'/g,"''")+"'";
for(const folder of [target,source,server]){
 const zip=folder+'.zip';
 // Explicit slash-separated entries also unzip correctly on Linux server hosts.
 const result=cp.spawnSync('powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $packageRoot=${quote(folder)}; $archive=[IO.Compression.ZipFile]::Open(${quote(zip)},[IO.Compression.ZipArchiveMode]::Create); try { Get-ChildItem -LiteralPath $packageRoot -Recurse -File | ForEach-Object { $entryName=${quote(path.basename(folder))}+'/'+$_.FullName.Substring($packageRoot.Length+1).Replace('\\','/'); [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive,$_.FullName,$entryName,[IO.Compression.CompressionLevel]::Optimal) | Out-Null } } finally { $archive.Dispose() }`],{stdio:'inherit',windowsHide:true});
 if(result.status!==0)throw Error('压缩失败');
}
fs.writeFileSync(path.join(release,'latest.json'),JSON.stringify({directory:target,executable:path.join(target,'抖音整理箱.exe'),zip:target+'.zip',sourceZip:source+'.zip',serverDirectory:server,serverZip:server+'.zip'},null,2));
console.log(JSON.stringify({directory:target,zip:target+'.zip',sourceZip:source+'.zip',serverZip:server+'.zip'},null,2));
