import type {App,Session,WebContents} from 'electron';

const apps=new WeakSet<App>(),sessions=new WeakSet<Session>(),pages=new WeakSet<WebContents>();
// Navigation events alone do not cover every Chromium external-protocol launch.
// Deny openExternal at the session boundary too, including child frames and new sessions.
export function protectSession(ses:Session){
 if(sessions.has(ses))return;sessions.add(ses);
 ses.setPermissionRequestHandler((_wc,permission,done)=>done(permission==='fullscreen'));
 ses.setPermissionCheckHandler((_wc,permission)=>permission==='fullscreen');
}
export function isWebNavigation(raw:string){
 try{return ['https:','about:','blob:','data:','app:'].includes(new URL(raw).protocol)}catch{return false}
}
export function protectNavigation(wc:WebContents){
 protectSession(wc.session);if(pages.has(wc))return;pages.add(wc);
 const stop=(event:{url?:string;preventDefault:()=>void},url?:string)=>{if(!isWebNavigation(event.url||url||''))event.preventDefault()};
 wc.on('will-navigate',stop);wc.on('will-redirect',stop);wc.on('will-frame-navigate',stop);
}
export function guardExternalLaunches(app:App){
 if(apps.has(app))return;apps.add(app);
 app.on('session-created',protectSession);
 app.on('web-contents-created',(_event,wc)=>protectNavigation(wc));
}
