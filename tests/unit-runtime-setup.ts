import {afterAll} from 'vitest';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

// Plugin management tests must never operate on installed user plugins.
const previous = process.env.OPENCLI_CONFIG_DIR;
const directory = mkdtempSync(join(tmpdir(), 'opencli-unit-runtime-'));
process.env.OPENCLI_CONFIG_DIR = directory;
afterAll(() => {
  if (previous === undefined) delete process.env.OPENCLI_CONFIG_DIR;
  else process.env.OPENCLI_CONFIG_DIR = previous;
  rmSync(directory, {recursive: true, force: true});
});
