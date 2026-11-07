import {it, expect, vi} from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {createHash} from 'node:crypto';
import type {IPage} from './types.js';
const send = vi.hoisted(() => vi.fn());
vi.mock('./browser/daemon-client.js', () => ({sendCommandFull: send}));
vi.mock('./browser/profile.js', () => ({loadProfileConfig: () => ({aliases:{}})}));
import {createSlidexGuard} from './slidex-auto-try.js';
it('uses ordinary borrowing for cached inventory pages and reads the business result once', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'inventory-borrow-'));
  const store = 'deep-toys';
  const key = createHash('sha256').update('Deep Toys').digest('hex');
  fs.writeFileSync(path.join(directory, key+'.qn-product-page.page.json'), JSON.stringify({page:'cached-page'}));
  let active = '';
  const evaluate = vi.fn(async () => ({visible:false, url:'https://qn.taobao.com/home.htm/SellManage/all'}));
  const raw = {getActivePage:()=>active,setActivePage:(page:string)=>{active=page;},evaluate} as unknown as IPage;
  send.mockImplementation(async (action, args) => {
    if (action === 'close-window') return {};
    expect(action).toBe('tabs');
    expect(args.op).toBe('borrow');
    expect(args.page).toBe('cached-page');
    return {page:'cached-page',data:{url:'https://qn.taobao.com/home.htm/SellManage/all'}};
  });
  try {
    const solve=vi.fn(), notify=vi.fn();
    const guard=createSlidexGuard(raw,{profile:store,session:'inventory-batch',entry:'qn/product-page',access:'read'}, {directory,solve,notify});
    const businessRead=vi.fn(async()=>[{id:'exact-item',stock:2}]);
    await expect(guard.run(businessRead)).resolves.toEqual([{id:'exact-item',stock:2}]);
    expect(businessRead).toHaveBeenCalledTimes(1);
    expect(solve).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
    expect(evaluate).toHaveBeenCalledTimes(1);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
it('still tries a real visible challenge once, notifies, and blocks subsequent shop reads', async () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'inventory-real-challenge-'));
  const raw={getActivePage:()=> 'exact-challenge',evaluate:async()=>({visible:true,url:'https://myseller.taobao.com/',key:'one-challenge'}),wait:async()=>{}} as unknown as IPage;
  const solve=vi.fn(async()=>({passed:false,return_code:300})),notify=vi.fn(async()=>true),retain=vi.fn(async()=>({}));
  const context={profile:'deep-toys',session:'one',entry:'taobao/product-sku-matrix',access:'read' as const};
  try {
    const guard=createSlidexGuard(raw,context,{directory,solve,notify,retain});
    await expect(guard.run(()=>guard.page.wait({time:1}))).rejects.toThrow('已暂停');
    const second=createSlidexGuard(raw,context,{directory,solve,notify,retain});
    const businessRead=vi.fn();
    await expect(second.run(businessRead)).rejects.toThrow('已暂停');
    expect(solve).toHaveBeenCalledTimes(1);expect(notify).toHaveBeenCalledTimes(1);
    expect(businessRead).not.toHaveBeenCalled();expect(retain).toHaveBeenCalledTimes(1);
  } finally {fs.rmSync(directory,{recursive:true,force:true});}
});
