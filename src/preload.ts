import {contextBridge,ipcRenderer} from 'electron';
const methods=new Set(['snapshot','state','login','connect','start','pause','resume','verified','review','openProfiles','export','importReview','exportReview','browserState','browserSelect','browserClose','showDashboard','probe','groupRefresh','groupOpen','groupDialogState','groupSave','groupCancel','groupVerified','fanOpen','fanState','fanLogin','fanConnect','fanResolve','fanAdd','fanEdit','fanRemove','fanStart','fanPause','fanResume','fanRetry','fanVerified','fanProfile','fanExport']);
contextBridge.exposeInMainWorld('desktop',{
  call:(method:string,payload?:unknown)=>{if(!methods.has(method))return Promise.reject(Error('不支持的操作'));return ipcRenderer.invoke('desktop:command',method,payload).then((r:any)=>{if(!r.ok)throw Error(r.error);return r.data;});},
  onChange:(callback:(event:any)=>void)=>{const listener=(_:unknown,event:any)=>callback(event);ipcRenderer.on('desktop:change',listener);return ()=>ipcRenderer.removeListener('desktop:change',listener);}
});
