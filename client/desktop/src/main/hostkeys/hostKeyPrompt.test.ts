import { describe, expect, it } from 'vitest';
import { PromptSchema } from '@btterm/core';
import { hostKeyPrompt } from './hostKeyPrompt';
import { fingerprintOf } from './KnownHostsStore';

const presented = { host: 'web-01', port: 22, keyType: 'ssh-rsa', fingerprint: 'SHA256:new' };

describe('hostKeyPrompt', () => {
  it('AC9 처음 보는 호스트는 unknown 확인 창', () => {
    const prompt = hostKeyPrompt(presented, { verdict: 'unknown' });
    expect(prompt).toEqual({ kind: 'hostKey', verdict: 'unknown', ...presented });
    expect(PromptSchema.safeParse(prompt).success).toBe(true);
  });

  it('AC10 같은 종류의 키가 바뀌면 key-changed와 저장된 지문을 보낸다', () => {
    const prompt = hostKeyPrompt(presented, {
      verdict: 'mismatch',
      reason: 'key-changed',
      known: [{ keyType: 'ssh-rsa', key: 'AAAA1' }],
    });
    expect(prompt).toEqual({
      kind: 'hostKey',
      verdict: 'mismatch',
      ...presented,
      mismatchReason: 'key-changed',
      knownFingerprints: [fingerprintOf('AAAA1')],
    });
    expect(PromptSchema.safeParse(prompt).success).toBe(true);
  });

  it('SEC-3 AC10 다른 종류만 알려진 호스트는 other-type-known과 알려진 종류를 보낸다', () => {
    const prompt = hostKeyPrompt(presented, {
      verdict: 'mismatch',
      reason: 'other-type-known',
      known: [
        { keyType: 'ssh-ed25519', key: 'AAAA1' },
        { keyType: 'ssh-ed25519', key: 'AAAA2' },
        { keyType: 'ecdsa-sha2-nistp256', key: '!!!bad' },
      ],
    });
    expect(prompt).toMatchObject({
      verdict: 'mismatch',
      mismatchReason: 'other-type-known',
      knownKeyTypes: ['ssh-ed25519', 'ecdsa-sha2-nistp256'],
      knownFingerprints: [fingerprintOf('AAAA1'), fingerprintOf('AAAA2'), '(잘못된 키)'],
    });
    expect(PromptSchema.safeParse(prompt).success).toBe(true);
  });
});
