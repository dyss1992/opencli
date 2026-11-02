import {it, expect, vi} from 'vitest';
import {EventEmitter} from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
const calls = vi.hoisted(() => [] as string[]);
vi.mock('./browser/profile.js', () => ({resolveProfileSelection: () => ({contextId:'gumo-studio'}), loadProfileConfig: () => ({aliases:{'gumo-studio':'gumo-studio'}})}));
vi.mock('./browser/daemon-client.js', () => ({sendCommandFull: () => {throw Error('unexpected browser command');}}));
vi.mock('node:child_process', () => ({spawn: (_bin: string, args: string[]) => {
  const child = Object.assign(new EventEmitter(), {stdout:new EventEmitter(), stderr:new EventEmitter(), stdin:new EventEmitter() as any});
  child.stdin.end = (input: string) => queueMicrotask(() => {
    const payload = JSON.parse(input);
    calls.push(args[1]+':'+(payload.channel ?? payload.purpose ?? '')); 
    child.stdout.emit('data', JSON.stringify(args[1] === 'check' ? {error:'paused',code:'MANUAL_VERIFICATION'} : {status:'resumed'}));
    child.emit('close', args[1] === 'check' ? 1 : 0);
  });
  return child;
}}));
import {preparePlatformAccess} from './platform-quota.js';
import {createSlidexGuard} from './slidex-auto-try.js';
it.each(['order-page','product-page','write','failed','invalid','verification'])('paused %s executes only its existing safe read', async name => {
  calls.length = 0;
  const directory = fs.mkdtempSync(path.join(os.tmpdir(),'slidex-min-'));
  const channel = name==='product-page' || name==='write' ? 'publish' : 'order';
  if (channel==='publish') process.env.PLATFORM_QUOTA_PURPOSE = 'publish';
  else delete process.env.PLATFORM_QUOTA_PURPOSE;
  const key = createHash('sha256').update('Gumo Studio').digest('hex');
  fs.writeFileSync(path.join(directory,key+'.'+channel+'.paused.json'),'{}');
  fs.writeFileSync(path.join(directory,key+'.'+channel+'.retained.json'),'{}');
  try {
    const prepare = preparePlatformAccess({site:'qn',name:['failed','invalid','verification'].includes(name)?'order-page':name,access:name==='write'?'write':'read'}, {}, 'gumo-studio');
    if (name==='write') {await expect(prepare).rejects.toThrow('paused'); return;}
    const access = (await prepare)!;
    const solve = vi.fn(() => {throw Error('must not retry solver');});
    const guard = createSlidexGuard({getActivePage:()=> 'old',wait:async()=>{},evaluate:async()=>name==='invalid'?{ret:['FAIL_SYS_SERVICE_FAULT']}:{visible:true}} as any,
      {profile:'gumo-studio',session:'old',entry:'qn/'+(['failed','invalid','verification'].includes(name)?'order-page':name),access:'read'}, {directory,solve});
    expect(access.cached).toBeUndefined();
    if (name==='failed') {await expect(guard.run(()=>guard.page.wait({time:1}))).rejects.toThrow('仍需手动'); await expect(access.finish(undefined,Error('failed'))).rejects.toThrow('自动请求已暂停');}
    else {
      if (name==='verification') access.markVerification();
      const read = guard.run(async()=>name==='invalid'?await guard.page.evaluate('existing request'):name==='product-page'?[{'商品ID':'12345'}]:[]);
      const finished = read.then(value=>access.finish(value),error=>access.finish(undefined,error));
      if (['invalid','verification'].includes(name)) await expect(finished).rejects.toThrow('自动请求已暂停');
      else await finished;
    }
    expect(solve).not.toHaveBeenCalled();
    expect(calls).toEqual(['failed','invalid','verification'].includes(name)?['check:'+channel]:['check:'+channel,'resume:'+channel]);
    expect(fs.existsSync(path.join(directory,key+'.'+channel+'.retained.json'))).toBe(true);
  } finally {delete process.env.PLATFORM_QUOTA_PURPOSE; fs.rmSync(directory,{recursive:true,force:true});}
});
