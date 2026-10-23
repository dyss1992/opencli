import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCli } from './cli.js';
import { captureCommandOutput, emitFailure, emitResult } from './command-output.js';
import { formatGumoSuccess, normalizeGumoBrowserArgv } from './gumo-compat.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

describe('Gumo success compatibility', () => {
  it.each([undefined, '', '0', 'true'])('keeps native output when the opt-in is %s', value => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', value);
    expect(formatGumoSuccess(['row'])).toEqual({ ok: true, data: ['row'] });
    expect(formatGumoSuccess(undefined)).toEqual({ ok: true, data: null });
  });

  it.each([[], null, undefined, false, 0, 'text', { ok: false, data: { ok: true } }])(
    'returns business data unchanged with compatibility enabled: %s', data => {
      vi.stubEnv('OPENCLI_GUMO_COMPAT', '1');
      expect(formatGumoSuccess(data)).toBe(data);
    },
  );

  it('wraps business ok/data fields without interpreting them in native mode', () => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', undefined);
    const data = { ok: false, data: ['business'] };
    expect(formatGumoSuccess(data)).toEqual({ ok: true, data });
  });

  it('uses raw success output while preserving captures and failure envelopes', async () => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', '1');
    const output = vi.spyOn(console, 'log').mockImplementation(() => {});
    const data = { ok: false, data: ['business'] };
    const capture: { result?: unknown } = {};
    await captureCommandOutput(capture, async () => emitResult(data));
    expect(capture.result).toBe(data);
    expect(output).toHaveBeenLastCalledWith(JSON.stringify(data));
    emitFailure({ code: 'usage_error', message: 'Invalid input' });
    expect(JSON.parse(output.mock.calls.at(-1)![0])).toMatchObject({
      ok: false, error: { code: 'usage_error', message: 'Invalid input', exitCode: 2 },
    });
    expect(process.exitCode).toBe(2);
  });
});

describe('Gumo browser argument compatibility', () => {
  const commands = new Set(['open', 'eval', 'state', 'tab', 'chrome']);
  const argv = (...parts: string[]) => ['node', 'opencli.js', ...parts];

  it('leaves legacy arguments unchanged by default', () => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', undefined);
    const original = argv('browser', 'work', 'state');
    expect(normalizeGumoBrowserArgv(original, commands)).toBe(original);
  });

  it.each([
    [argv('browser', 'work', 'state'), argv('browser', 'state', '--session', 'work')],
    [argv('--profile', 'shop', 'browser', 'work', '--window', 'background', 'state'),
      argv('--profile', 'shop', 'browser', '--window', 'background', 'state', '--session', 'work')],
    [argv('--profile=shop', 'browser', '--window=background', 'work', 'tab', 'list'),
      argv('--profile=shop', 'browser', '--window=background', 'tab', 'list', '--session', 'work')],
    [argv('browser', 'work', 'eval', '--', '--session'),
      argv('browser', 'eval', '--session', 'work', '--', '--session')],
  ])('rewrites the old session position without mutating input: %s', (original, expected) => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', '1');
    const before = original.slice();
    expect(normalizeGumoBrowserArgv(original, commands)).toEqual(expected);
    expect(original).toEqual(before);
  });

  it.each([
    ['browser', 'state', '--session', 'work'],
    ['browser', '--session=work', 'state'],
    ['browser', 'tab', 'list', '--session', 'state'],
    ['browser', 'open', 'state'],
    ['browser', 'work', 'unknown'],
    ['browser', 'work', '--unknown', 'state'],
    ['taobao', 'browser', 'work', 'state'],
    ['--profile', 'browser', 'taobao', 'work', 'state'],
  ])('preserves native commands, collisions, and unrelated arguments: %s', (...parts) => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', '1');
    const original = argv(...parts);
    expect(normalizeGumoBrowserArgv(original, commands)).toBe(original);
  });

  it.each([
    ['browser', 'work', 'state', '--session', 'other'],
    ['browser', 'work', 'state', '--session=work'],
    ['browser', 'work', '--session', 'other', 'state'],
    ['browser', 'state', '--session', 'work', '--session=other'],
  ])('rejects ambiguous sessions: %s', (...parts) => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', '1');
    expect(() => normalizeGumoBrowserArgv(argv(...parts), commands)).toThrow('Use one --session');
  });

  it('normalizes at the runCli parse boundary using the registered browser commands', async () => {
    vi.stubEnv('OPENCLI_GUMO_COMPAT', '1');
    const original = argv('--profile', 'shop', 'browser', 'work', 'chrome', 'describe');
    const savedArgv = process.argv;
    const parse = vi.spyOn(Command.prototype, 'parseAsync').mockResolvedValue(new Command());
    try {
      process.argv = original;
      await runCli('', '');
      expect(parse).toHaveBeenCalledWith(argv('--profile', 'shop', 'browser', 'chrome', 'describe', '--session', 'work'));
    } finally {
      process.argv = savedArgv;
    }
  });
});
