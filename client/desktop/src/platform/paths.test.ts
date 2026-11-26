import { describe, expect, it } from 'vitest';
import { isWindowsNetworkPath, plainTextEditor } from './paths';

describe('plainTextEditor (F4.8 로컬 편집)', () => {
  it('Windows는 메모장을 인자 없이 실행한다', () => {
    expect(plainTextEditor('win32', 'D:\\Win')).toEqual({
      command: 'D:\\Win\\System32\\notepad.exe',
      args: [],
    });
  });

  it('macOS는 open -e로 TextEdit에 연다(셸 없이 인자 배열)', () => {
    expect(plainTextEditor('darwin')).toEqual({ command: '/usr/bin/open', args: ['-e'] });
  });

  it('그 밖의 OS는 열 편집기가 없다', () => {
    expect(plainTextEditor('linux')).toBeNull();
  });
});

describe('isWindowsNetworkPath (보안 리뷰 S-2 L4)', () => {
  it('Windows에서 UNC·장치 경로를 알아본다', () => {
    for (const path of [
      '\\\\host\\share\\id',
      '\\\\?\\C:\\k',
      '\\\\.\\pipe\\x',
      '//host/share/id',
    ]) {
      expect(isWindowsNetworkPath(path, 'win32')).toBe(true);
    }
    expect(isWindowsNetworkPath('C:\\Users\\me\\.ssh\\id', 'win32')).toBe(false);
    expect(isWindowsNetworkPath('~/.ssh/id', 'win32')).toBe(false);
  });

  it('macOS에서는 막지 않는다', () => {
    expect(isWindowsNetworkPath('//host/share', 'darwin')).toBe(false);
  });
});
