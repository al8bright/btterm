import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultAppSettings } from '@btterm/core';
import { SettingsRepository } from './SettingsRepository';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-settings-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SettingsRepository (F6.7)', () => {
  it('파일이 없으면 기본값', async () => {
    const repo = await SettingsRepository.open(join(dir, 'settings.json'));
    expect(repo.current).toEqual(defaultAppSettings());
  });

  it('부분 변경을 합쳐 저장하고 다시 열면 유지된다', async () => {
    const path = join(dir, 'settings.json');
    const repo = await SettingsRepository.open(path);
    await repo.update({ terminal: { fontSize: 16 }, ui: { toolPanel: 'history' } });
    const reopened = await SettingsRepository.open(path);
    expect(reopened.current.terminal.fontSize).toBe(16);
    expect(reopened.current.terminal.themeId).toBe('btterm-dark');
    expect(reopened.current.ui.toolPanel).toBe('history');
  });

  it('F6.7 창 상태는 main 전용 메서드로 저장하고, renderer 패치는 건드리지 않는다', async () => {
    const path = join(dir, 'settings.json');
    const repo = await SettingsRepository.open(path);
    const window = { bounds: { x: 10, y: 20, width: 1400, height: 900 }, maximized: true };
    await repo.saveWindow(window);
    await repo.update({ ui: { sidebarOpen: false } });
    const reopened = await SettingsRepository.open(path);
    expect(reopened.current.window).toEqual(window);
    expect(reopened.current.ui.sidebarOpen).toBe(false);
  });

  it('F6.7 읽지 못한 설정 파일은 종료 때 창 상태 저장으로 덮어쓰지 않는다(보안 리뷰 M1)', async () => {
    const path = join(dir, 'settings.json');
    await writeFile(path, '{"schemaVersion":99,"terminal":{"fontSize":"big"}}');
    const repo = await SettingsRepository.open(path);
    await repo.saveWindow({ bounds: { x: 1, y: 2, width: 1000, height: 700 }, maximized: false });
    expect(await readFile(path, 'utf8')).toContain('"schemaVersion":99');
    expect(repo.current.window?.bounds.width).toBe(1000);
  });

  it('창 상태 저장과 설정 변경이 겹쳐도 둘 다 남는다(쓰기 직렬화, 보안 리뷰 L2)', async () => {
    const path = join(dir, 'settings.json');
    const repo = await SettingsRepository.open(path);
    await Promise.all([
      repo.update({ ui: { sidebarOpen: false } }),
      repo.saveWindow({ bounds: { x: 1, y: 2, width: 1000, height: 700 }, maximized: true }),
    ]);
    const reopened = await SettingsRepository.open(path);
    expect(reopened.current.ui.sidebarOpen).toBe(false);
    expect(reopened.current.window?.maximized).toBe(true);
  });

  it('형식이 깨진 파일은 기본값으로 시작하고 원본을 덮어쓰지 않는다', async () => {
    const path = join(dir, 'settings.json');
    await writeFile(path, '{"schemaVersion":1,"terminal":{"fontSize":"big"}}');
    const repo = await SettingsRepository.open(path);
    expect(repo.current).toEqual(defaultAppSettings());
    expect(await readFile(path, 'utf8')).toContain('"big"');
  });
});
