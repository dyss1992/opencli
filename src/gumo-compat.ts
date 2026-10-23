export function formatGumoSuccess(data: unknown): unknown {
  return process.env.OPENCLI_GUMO_COMPAT === '1' ? data : { ok: true, data: data ?? null };
}

export function normalizeGumoBrowserArgv(argv: string[], browserCommandNames: ReadonlySet<string>): string[] {
  if (process.env.OPENCLI_GUMO_COMPAT !== '1') return argv;

  let browserIndex = 2;
  while (browserIndex < argv.length) {
    const token = argv[browserIndex];
    if (token === '--profile') browserIndex += 2;
    else if (token.startsWith('--profile=')) browserIndex += 1;
    else break;
  }
  if (argv[browserIndex] !== 'browser') return argv;

  const terminator = argv.indexOf('--', browserIndex + 1);
  const optionsEnd = terminator === -1 ? argv.length : terminator;
  const sessionOptions = argv.slice(browserIndex + 1, optionsEnd)
    .filter(token => token === '--session' || token.startsWith('--session=')).length;
  const ambiguousSession = () => Object.assign(
    new Error('Browser session is ambiguous. Use one --session option.'),
    { code: 'usage_error' },
  );
  if (sessionOptions > 1) throw ambiguousSession();

  let sessionIndex = browserIndex + 1;
  while (sessionIndex < optionsEnd) {
    const token = argv[sessionIndex];
    if (token === '--window') sessionIndex += 2;
    else if (token.startsWith('--window=')) sessionIndex += 1;
    else break;
  }
  const session = argv[sessionIndex];
  if (!session || session.startsWith('-') || browserCommandNames.has(session)) return argv;
  if (sessionOptions) throw ambiguousSession();

  let commandIndex = sessionIndex + 1;
  while (commandIndex < optionsEnd) {
    const token = argv[commandIndex];
    if (token === '--window') commandIndex += 2;
    else if (token.startsWith('--window=')) commandIndex += 1;
    else break;
  }
  if (!browserCommandNames.has(argv[commandIndex])) return argv;

  const normalized = argv.slice();
  normalized.splice(sessionIndex, 1);
  normalized.splice(optionsEnd - 1, 0, '--session', session);
  return normalized;
}
