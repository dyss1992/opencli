import {it,expect,vi} from 'vitest';
import {createExtensionReloader} from './extension-reload';
const fixture=()=>{const deps={ready:vi.fn(async()=>{}),isIdle:vi.fn(()=>true),reload:vi.fn(),schedule:vi.fn()};return {deps,guard:createExtensionReloader(deps)};};
it('reloads once after ACK, with no profile or page writes',async()=>{
 const {deps,guard}=fixture();const reply=await guard.prepare({id:'one',action:'chrome-call',chromeMethod:'runtime.reload'});
 expect(reply).toMatchObject({ok:true,data:{reloading:true}});expect(deps.reload).not.toHaveBeenCalled();expect(deps.schedule).not.toHaveBeenCalled();
 guard.acknowledge(reply,true);guard.acknowledge(reply,true);expect(deps.schedule).toHaveBeenCalledTimes(1);deps.schedule.mock.calls[0][0]();expect(deps.reload).toHaveBeenCalledTimes(1);
 expect((await guard.prepare({id:'two',action:'chrome-call'})).ok).toBe(false);
});
it('does not reload while a command is in flight',async()=>{
 const {deps,guard}=fixture();deps.isIdle.mockReturnValue(false);
 expect(await guard.prepare({id:'one',action:'chrome-call'})).toMatchObject({ok:false,errorCode:'extension_reload_busy'});expect(guard.isPending()).toBe(false);expect(deps.reload).not.toHaveBeenCalled();expect(deps.schedule).not.toHaveBeenCalled();
});
it('a lost ACK releases the latch without reloading',async()=>{
 const {deps,guard}=fixture();const reply=await guard.prepare({id:'one',action:'chrome-call'});guard.acknowledge(reply,false);
 expect(guard.isPending()).toBe(false);expect(deps.schedule).not.toHaveBeenCalled();expect(deps.reload).not.toHaveBeenCalled();
});
