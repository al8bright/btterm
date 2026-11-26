import { describe, expect, it } from 'vitest';
import { AppSettingsPatchSchema, applySettingsPatch, defaultAppSettings } from './appSettings';
import { fillSnippet, needsSudoConfirm, SnippetSchema, snippetVars } from './snippets';

describe('스니펫 (F3.14 1단계, 결정 DF7)', () => {
  it('{{변수}}를 처음 나온 순서대로 한 번씩 뽑는다', () => {
    expect(snippetVars('tail -n {{lines}} {{ file }} | grep {{lines}}')).toEqual(['lines', 'file']);
    expect(snippetVars('df -h')).toEqual([]);
  });

  it('변수 값을 채운다. 없는 값은 빈 문자열', () => {
    expect(fillSnippet('tail -n {{lines}} {{ file }}', { lines: '50', file: 'app.log' })).toBe(
      'tail -n 50 app.log',
    );
    expect(fillSnippet('echo {{x}}', {})).toBe('echo ');
  });

  it('production 태그 서버에서 sudo가 들어간 명령만 실행 전 확인', () => {
    expect(needsSudoConfirm('sudo systemctl restart nginx', ['production'])).toBe(true);
    expect(needsSudoConfirm('sudo -i', ['prod'])).toBe(true);
    expect(needsSudoConfirm('sudo ls', ['dev'])).toBe(false);
    expect(needsSudoConfirm('echo pseudo', ['production'])).toBe(false);
    expect(needsSudoConfirm('ls', ['production'])).toBe(false);
  });

  it('이름 80자·명령 4000자, 빈 값 거부', () => {
    const ok = { id: 's1', name: 'disk', command: 'df -h' };
    expect(SnippetSchema.safeParse(ok).success).toBe(true);
    expect(SnippetSchema.safeParse({ ...ok, name: ' ' }).success).toBe(false);
    expect(SnippetSchema.safeParse({ ...ok, name: 'x'.repeat(81) }).success).toBe(false);
    expect(SnippetSchema.safeParse({ ...ok, command: 'x'.repeat(4001) }).success).toBe(false);
  });

  it('설정 패치는 스니펫 목록을 통째로 바꾼다(최대 200개)', () => {
    const list = [{ id: 's1', name: 'disk', command: 'df -h' }];
    const next = applySettingsPatch(defaultAppSettings(), { snippets: list });
    expect(next.snippets).toEqual(list);
    expect(applySettingsPatch(next, { ui: { sidebarOpen: false } }).snippets).toEqual(list);
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `s${i}`, name: 'n', command: 'c' }));
    expect(AppSettingsPatchSchema.safeParse({ snippets: many }).success).toBe(false);
  });

  it('도구 패널에 스니펫 탭이 있다', () => {
    expect(AppSettingsPatchSchema.safeParse({ ui: { toolPanel: 'snippets' } }).success).toBe(true);
  });
});
