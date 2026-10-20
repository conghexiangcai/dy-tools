import test from 'node:test';import assert from 'node:assert/strict';import {LocalNavigation} from '../local-navigation';
test('initial load interrupted by a tool switch is not a startup failure',async()=>{
 let reject:(e:Error)=>void=()=>{};const nav=new LocalNavigation(url=>url==='home'?new Promise((_,r)=>{reject=r}):Promise.resolve());const initial=nav.load('home');await nav.load('chat');reject(Object.assign(Error('loading was replaced'),{code:'ERR_ABORTED',errno:-3}));await initial;
});
test('genuine failures and non-superseded aborts still fail',async()=>{
 const fail=new LocalNavigation(async()=>{throw Object.assign(Error('failed'),{code:'ERR_ABORTED'})});await assert.rejects(fail.load('home'),/failed/);
 let reject:(e:Error)=>void=()=>{};const nav=new LocalNavigation(url=>url==='home'?new Promise((_,r)=>{reject=r}):Promise.resolve());const initial=nav.load('home');await nav.load('chat');reject(Error('missing app resource'));await assert.rejects(initial,/missing app resource/);
});
