import { describe, expect, it } from 'vitest';
import { removalDialogOptions } from './removalDialog';

describe('알려진 호스트 삭제 확인창 (TR6 보안 리뷰 M-1)', () => {
  it('기본 버튼과 Esc는 취소이고, 지울 호스트·형식·지문을 보여 준다', () => {
    const options = removalDialogOptions({
      hosts: '[db-01]:2222',
      keyType: 'ssh-ed25519',
      fingerprint: 'SHA256:abc',
    });
    expect(options.buttons).toEqual(['취소', '지우기']);
    expect(options.defaultId).toBe(0);
    expect(options.cancelId).toBe(0);
    expect(options.type).toBe('warning');
    expect(options.detail).toContain('[db-01]:2222');
    expect(options.detail).toContain('ssh-ed25519 SHA256:abc');
  });

  it('해시된 이름은 그렇다고 적는다', () => {
    expect(
      removalDialogOptions({ hosts: null, keyType: 'ssh-rsa', fingerprint: 'SHA256:x' }).detail,
    ).toContain('(해시된 이름)');
  });
});
