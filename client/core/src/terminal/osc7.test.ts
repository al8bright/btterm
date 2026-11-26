import { describe, expect, it } from 'vitest';
import { CwdTracker, parseOsc7 } from './osc7';

describe('parseOsc7', () => {
  it('정상 file URL에서 host와 path를 읽는다', () => {
    expect(parseOsc7('file://web-01/var/log')).toEqual({ host: 'web-01', path: '/var/log' });
  });

  it('한글 퍼센트 인코딩 경로를 디코딩한다', () => {
    expect(parseOsc7('file://web-01/var/log/%ED%95%9C')?.path).toBe('/var/log/한');
  });

  it('공백 인코딩(%20)을 디코딩한다', () => {
    expect(parseOsc7('file://web-01/home/me/my%20docs')?.path).toBe('/home/me/my docs');
  });

  it('SEC-5: file 아닌 스킴은 거부한다', () => {
    expect(parseOsc7('http://web-01/var/log')).toBeNull();
    expect(parseOsc7('javascript://web-01/x')).toBeNull();
  });

  it('상대 경로는 거부한다', () => {
    expect(parseOsc7('file://web-01')).toBeNull();
    expect(parseOsc7('file://web-01relative')).toBeNull();
  });

  it('잘못된 퍼센트 인코딩은 거부한다', () => {
    expect(parseOsc7('file://web-01/var/%E0%A4%A')).toBeNull();
    expect(parseOsc7('file://web-01/var/%ZZ')).toBeNull();
  });

  it('SEC-5: 제어문자와 NUL이 든 경로는 거부한다', () => {
    expect(parseOsc7('file://web-01/var/%00x')).toBeNull();
    expect(parseOsc7('file://web-01/var/%1B[31m')).toBeNull();
    expect(parseOsc7('file://web-01/var/\nx')).toBeNull();
    expect(parseOsc7('file://web-01/var/%7F')).toBeNull();
  });

  it('SEC-5: 4096자를 넘는 페이로드는 거부한다', () => {
    const ok = 'file://h/' + 'a'.repeat(4096 - 'file://h/'.length);
    expect(parseOsc7(ok)).not.toBeNull();
    expect(parseOsc7(ok + 'a')).toBeNull();
  });

  it('host가 비어 있으면 빈 문자열이다', () => {
    expect(parseOsc7('file:///home/me')).toEqual({ host: '', path: '/home/me' });
  });
});

describe('CwdTracker', () => {
  it('처음에는 current와 remoteHost가 null이다', () => {
    const t = new CwdTracker();
    expect(t.current).toBeNull();
    expect(t.remoteHost).toBeNull();
  });

  it('첫 보고의 host를 기억하고 경로를 갱신한다', () => {
    const t = new CwdTracker();
    expect(t.accept({ host: 'web-01', path: '/var' })).toBe(true);
    expect(t.remoteHost).toBe('web-01');
    expect(t.current).toBe('/var');
    expect(t.accept({ host: 'web-01', path: '/etc' })).toBe(true);
    expect(t.current).toBe('/etc');
  });

  it('SEC-5: 중첩 ssh 등 다른 host의 보고는 무시한다', () => {
    const t = new CwdTracker();
    t.accept({ host: 'web-01', path: '/var' });
    expect(t.accept({ host: 'db-02', path: '/data' })).toBe(false);
    expect(t.current).toBe('/var');
    expect(t.remoteHost).toBe('web-01');
  });

  it('host 비교는 대소문자를 구분하지 않는다', () => {
    const t = new CwdTracker();
    t.accept({ host: 'Web-01', path: '/a' });
    expect(t.accept({ host: 'web-01', path: '/b' })).toBe(true);
  });

  it('SEC-5 localhost·빈 host도 기억된 호스트와 다르면 무시한다(출력에 섞인 위조 OSC 7 차단)', () => {
    const t = new CwdTracker();
    t.accept({ host: 'web-01', path: '/a' });
    expect(t.accept({ host: 'localhost', path: '/tmp/x' })).toBe(false);
    expect(t.accept({ host: '', path: '/tmp/y' })).toBe(false);
    expect(t.current).toBe('/a');
  });

  it('빈 host로 시작하면 이후에도 빈 host만 받는다', () => {
    const t = new CwdTracker();
    expect(t.accept({ host: '', path: '/a' })).toBe(true);
    expect(t.accept({ host: '', path: '/b' })).toBe(true);
    expect(t.accept({ host: 'localhost', path: '/c' })).toBe(false);
  });

  it('reset하면 상태를 비우고 새 호스트를 받는다', () => {
    const t = new CwdTracker();
    t.accept({ host: 'web-01', path: '/a' });
    t.reset();
    expect(t.current).toBeNull();
    expect(t.remoteHost).toBeNull();
    expect(t.accept({ host: 'db-02', path: '/b' })).toBe(true);
    expect(t.remoteHost).toBe('db-02');
  });
});
