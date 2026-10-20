// A user may switch tools before the initial dashboard has finished loading.
// Chromium cancels the earlier load with ERR_ABORTED; only a superseded load is benign.
export class LocalNavigation {
 private revision=0;
 constructor(private loadURL:(url:string)=>Promise<unknown>){}
 async load(url:string){const revision=++this.revision;try{await this.loadURL(url)}catch(e:any){if(revision!==this.revision&&(e?.code==='ERR_ABORTED'||e?.errno===-3))return;throw e}}
}
