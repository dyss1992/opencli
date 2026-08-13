import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runCredentialFillOnTabMock } = vi.hoisted(() => ({
  runCredentialFillOnTabMock: vi.fn(),
}));

vi.mock('./credential-fill', async () => {
  const actual = await vi.importActual<typeof import('./credential-fill')>('./credential-fill');
  return { ...actual, runCredentialFillOnTab: runCredentialFillOnTabMock };
});

import { createPassiveAutofill } from './passive-autofill';

describe('passive credential autofill', () => {
  beforeEach(() => {
    runCredentialFillOnTabMock.mockReset();
    runCredentialFillOnTabMock.mockResolvedValue({
      frameId: 0,
      result: {
        ok: true,
        host: 'login.taobao.com',
        username_filled: true,
        password_filled: true,
        submitted: false,
      },
    });
  });

  it('requests the current profile credential and never passively submits', async () => {
    const send = vi.fn((_payload: unknown) => true);
    const controller = createPassiveAutofill({
      connect: vi.fn(async () => {}),
      getContextId: vi.fn(async () => 'work-profile'),
      isSocketOpen: () => true,
      send,
    });

    const fill = controller.triggerForTab(7, 'https://login.taobao.com/member/login.jhtml');
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const request = send.mock.calls[0][0] as { requestId: string; contextId: string };
    expect(request.contextId).toBe('work-profile');

    expect(controller.handleDaemonMessage({
      type: 'autofill-response',
      requestId: request.requestId,
      ok: true,
      credential: {
        username: 'seller',
        password: 'secret',
        allowedHosts: ['taobao.com'],
        submit: true,
      },
    })).toBe(true);
    await fill;

    expect(runCredentialFillOnTabMock).toHaveBeenCalledWith(7, expect.objectContaining({
      username: 'seller',
      password: 'secret',
      submit: false,
    }));
  });

  it('ignores pages outside the configured login hosts', async () => {
    const send = vi.fn((_payload: unknown) => true);
    const controller = createPassiveAutofill({
      connect: vi.fn(async () => {}),
      getContextId: vi.fn(async () => 'work-profile'),
      isSocketOpen: () => true,
      send,
    });

    await controller.triggerForTab(7, 'https://example.com/login');

    expect(send).not.toHaveBeenCalled();
    expect(runCredentialFillOnTabMock).not.toHaveBeenCalled();
  });
});
