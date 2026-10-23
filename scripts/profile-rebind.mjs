#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function main(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) {
    console.log('Usage: node scripts/profile-rebind.mjs --batch-map <physical-profile-bindings.json> [--timeout-seconds 1800]\nSequential watcher: --mapping <original-profile-map.json>');
    return;
  }
  let mappingPath;
  let batch = false;
  let timeoutSeconds = 1800;
  for (let index = 0; index < argv.length; index++) {
    if ((argv[index] === '--mapping' || argv[index] === '--batch-map') && argv[index + 1] && !mappingPath) { batch = argv[index] === '--batch-map'; mappingPath = argv[++index]; }
    else if (argv[index] === '--timeout-seconds' && argv[index + 1]) timeoutSeconds = Number(argv[++index]);
    else throw new Error('Unknown or incomplete argument. Use --help.');
  }
  if (!mappingPath || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) throw new Error('Provide a public profile map and a positive timeout.');
  const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
  if (!Array.isArray(mapping.profiles)) throw new Error('The public profile map must contain profiles.');
  const knownIds = mapping.profiles.map(profile => profile.contextId);
  const { watchProfileRebind, batchProfileRebind } = await import('../dist/src/profile-rebind.js');
  const request = async (path, body) => {
    const response = await fetch(`http://127.0.0.1:19825${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { 'X-OpenCLI': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('The daemon rejected the request. Stop and inspect; do not retry the rebind.');
    return response.json();
  };
  const receipts = await (batch ? batchProfileRebind : watchProfileRebind)(batch ? mapping.profiles : knownIds, {
    status: () => request('/status'),
    submit: command => request('/command', command),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: Date.now, commandId: randomUUID,
  }, {
    timeoutMs: timeoutSeconds * 1000,
    onReady: () => console.log(JSON.stringify({ event: 'ready', machine: mapping.machine, profiles: knownIds })),
    onVerified: receipt => console.log(JSON.stringify({ event: 'verified', ...receipt })),
  });
  console.log(JSON.stringify({ event: 'complete', verified: receipts.length }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(JSON.stringify({ event: 'stopped', code: error?.code ?? 'profile_rebind_failed', message: error?.message ?? 'Profile rebinding stopped. Inspect before continuing.' }));
    process.exitCode = 1;
  });
}
