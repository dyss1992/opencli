import { describe, expect, it } from 'vitest';
import { DAEMON_HOST, DAEMON_PING_URL, DAEMON_WS_URL } from './protocol.js';

describe('extension daemon endpoints', () => {
  it('uses the explicit IPv4 loopback host', () => {
    expect(DAEMON_HOST).toBe('127.0.0.1');
    expect(DAEMON_WS_URL).toBe('ws://127.0.0.1:19825/ext');
    expect(DAEMON_PING_URL).toBe('http://127.0.0.1:19825/ping');
  });
});
