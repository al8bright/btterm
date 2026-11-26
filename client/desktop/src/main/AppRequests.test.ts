import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppRequests } from './AppRequests';
import { SettingsRepository } from './store/SettingsRepository';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-req-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function setup() {
  let clipboard = '';
  const opened: string[] = [];
  const changed: unknown[] = [];
  const requests = new AppRequests({
    onSettingsChanged: (settings) => changed.push(settings),
    settings: await SettingsRepository.open(join(dir, 'settings.json')),
    clipboard: {
      readText: () => clipboard,
      writeText: (text) => {
        clipboard = text;
      },
    },
    openExternal: async (url) => {
      opened.push(url);
      return url.startsWith('https:');
    },
  });
  return { requests, opened, changed, clipboard: () => clipboard };
}

describe('AppRequests', () => {
  it('세션과 무관한 요청만 맡는다', async () => {
    const { requests } = await setup();
    expect(requests.handles({ type: 'settings.get' })).toBe(true);
    expect(requests.handles({ type: 'profiles.get' })).toBe(false);
  });

  it('설정을 읽고 부분 변경한다', async () => {
    const { requests } = await setup();
    const updated = (await requests.handle({
      type: 'settings.update',
      patch: { terminal: { themeId: 'one-dark' } },
    })) as { terminal: { themeId: string } };
    expect(updated.terminal.themeId).toBe('one-dark');
    expect(await requests.handle({ type: 'settings.get' })).toEqual(updated);
  });

  it('설정이 바뀌면 알린다(화면 모드에 맞춰 창 제목 표시줄을 다시 칠함, DESIGN §4.2)', async () => {
    const { requests, changed } = await setup();
    const updated = await requests.handle({
      type: 'settings.update',
      patch: { ui: { theme: 'light' } },
    });
    expect(changed).toEqual([updated]);
  });

  it('SEC-7 클립보드는 main을 거친다', async () => {
    const env = await setup();
    await env.requests.handle({ type: 'clipboard.writeText', text: 'copied' });
    expect(env.clipboard()).toBe('copied');
    expect(await env.requests.handle({ type: 'clipboard.readText' })).toEqual({ text: 'copied' });
  });

  it('SEC-6 링크 열기는 검사 결과를 돌려준다', async () => {
    const { requests, opened } = await setup();
    expect(await requests.handle({ type: 'link.open', url: 'https://a.example' })).toEqual({
      ok: true,
    });
    expect(await requests.handle({ type: 'link.open', url: 'file:///etc/passwd' })).toEqual({
      ok: false,
    });
    expect(opened).toHaveLength(2);
  });
});
