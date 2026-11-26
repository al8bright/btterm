import { describe, expect, it } from 'vitest';
import { addAuthorizedKey, isPublicKeyLine } from './authorizedKeys';

const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBtt3rm';

describe('authorized_keys 편집 (F7.8, 결정 TR5)', () => {
  it('없으면 끝에 한 줄 덧붙이고 줄바꿈을 맞춘다', () => {
    expect(addAuthorizedKey('', KEY)).toEqual({ text: `${KEY}\n`, changed: true });
    expect(addAuthorizedKey('ssh-rsa AAAAB3 old', KEY)).toEqual({
      text: `ssh-rsa AAAAB3 old\n${KEY}\n`,
      changed: true,
    });
  });

  it('같은 키(형식+본문)가 이미 있으면 바꾸지 않는다. 옵션·주석이 달라도 같은 키다', () => {
    const text = `# mine\nfrom="10.0.0.0/8",no-pty ${KEY} laptop@home\n`;
    expect(addAuthorizedKey(text, `${KEY} other-comment`)).toEqual({ text, changed: false });
  });

  it('주석 처리된 줄의 키는 등록된 것으로 보지 않는다', () => {
    expect(addAuthorizedKey(`# ${KEY}\n`, KEY).changed).toBe(true);
  });

  it('등록할 수 있는 공개키 줄만 받는다(형식·base64·한 줄)', () => {
    expect(isPublicKeyLine(KEY)).toBe(true);
    expect(isPublicKeyLine(`${KEY} comment with spaces`)).toBe(true);
    expect(isPublicKeyLine('ecdsa-sha2-nistp256 AAAAE2Vj')).toBe(true);
    expect(isPublicKeyLine('ssh-dss AAAAB3')).toBe(false);
    expect(isPublicKeyLine(`command="rm -rf ~" ${KEY}`)).toBe(false);
    expect(isPublicKeyLine(`${KEY}\nssh-rsa AAAAB3`)).toBe(false);
    expect(isPublicKeyLine('ssh-ed25519 not*base64')).toBe(false);
  });
});
