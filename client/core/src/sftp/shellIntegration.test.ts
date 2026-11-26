import { describe, expect, it } from 'vitest';
import {
  addRcBlock,
  hasRcBlock,
  removeRcBlock,
  RC_BLOCK,
  SHELL_SCRIPT,
  sourcesBashrc,
} from './shellIntegration';

describe('셸 통합 rc 블록(F4.5, D10)', () => {
  it('마커로 감싼 source 한 줄을 끝에 덧붙이고, 이미 있으면 바꾸지 않는다(멱등)', () => {
    const once = addRcBlock('alias ll="ls -al"\n');
    expect(once.changed).toBe(true);
    expect(once.text).toBe(`alias ll="ls -al"\n\n${RC_BLOCK}\n`);
    expect(addRcBlock(once.text)).toEqual({ text: once.text, changed: false });
    expect(hasRcBlock(once.text)).toBe(true);
  });

  it('끝 개행이 없는 rc와 빈 rc도 처리한다', () => {
    expect(addRcBlock('export A=1').text).toBe(`export A=1\n\n${RC_BLOCK}\n`);
    expect(addRcBlock('').text).toBe(`${RC_BLOCK}\n`);
  });

  it('제거하면 블록만 빠지고 나머지는 그대로다', () => {
    const original = 'export A=1\n';
    expect(removeRcBlock(addRcBlock(original).text)).toEqual({ text: original, changed: true });
    expect(removeRcBlock(original)).toEqual({ text: original, changed: false });
  });

  it('스크립트는 OSC 7을 내보내고 기존 PROMPT_COMMAND를 지우지 않는다', () => {
    expect(SHELL_SCRIPT).toContain(']7;file://');
    expect(SHELL_SCRIPT).toContain('PROMPT_COMMAND');
    expect(SHELL_SCRIPT).toContain('${PROMPT_COMMAND');
    expect(SHELL_SCRIPT).toContain('add-zsh-hook');
    expect(SHELL_SCRIPT).toContain('& 255'); // 한글 등 UTF-8 바이트 인코딩
  });

  it('로그인 셸 파일이 .bashrc를 읽는지 확인한다', () => {
    expect(sourcesBashrc('if [ -f ~/.bashrc ]; then . ~/.bashrc; fi')).toBe(true);
    expect(sourcesBashrc('[ -r "$HOME/.bashrc" ] && source "$HOME/.bashrc"')).toBe(true);
    expect(sourcesBashrc('export PATH=$PATH:~/bin')).toBe(false);
  });
});
