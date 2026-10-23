import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect,it} from 'vitest';
import {PKG_VERSION} from './version.js';
it('runs the Gumo entry through an npm-style executable symlink',()=>{
 const dir=mkdtempSync(join(tmpdir(),'gumo-entry-'));
 try {
  const link=join(dir,'opencli');symlinkSync(fileURLToPath(new URL('../bin/opencli-gumo',import.meta.url)),link);
  expect(execFileSync(process.execPath,[link,'--version'],{encoding:'utf8'}).trim()).toBe(PKG_VERSION);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
