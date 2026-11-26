import { describe, expect, it } from 'vitest';
import { isOpenableUrl, preparePaste, toPromptInput } from './paste';

describe('preparePaste (F3.9, SEC-5)', () => {
  it('제어문자와 ESC 시퀀스를 지우고 탭·개행은 남긴다', () => {
    expect(preparePaste('ls\t-al\u0007\u001b[201~; rm -rf ~\n').text).toBe(
      'ls\t-al[201~; rm -rf ~\n',
    );
  });

  it('CRLF·CR을 LF로 맞추고, 끝 개행 하나는 여러 줄로 세지 않는다', () => {
    expect(preparePaste('a\r\nb\rc').text).toBe('a\nb\nc');
    expect(preparePaste('echo hi\n').multiline).toBe(false);
    expect(preparePaste('echo a\necho b').multiline).toBe(true);
    expect(preparePaste('echo a\necho b').lineCount).toBe(2);
  });
});

describe('toPromptInput', () => {
  it('기록 항목을 한 줄 입력으로 만든다(개행·제어문자 제거, 실행하지 않음)', () => {
    expect(toPromptInput('git log\n--oneline\u001b[A\r')).toBe('git log --oneline[A');
  });
});

describe('isOpenableUrl (SEC-6)', () => {
  it('http·https만 연다', () => {
    expect(isOpenableUrl('https://example.com/a?b=1')).toBe(true);
    expect(isOpenableUrl('http://10.0.0.1:8080')).toBe(true);
    expect(isOpenableUrl('file:///C:/Windows/System32/calc.exe')).toBe(false);
    expect(isOpenableUrl('javascript:alert(1)')).toBe(false);
    expect(isOpenableUrl('ms-settings:')).toBe(false);
    expect(isOpenableUrl('not a url')).toBe(false);
  });
});
