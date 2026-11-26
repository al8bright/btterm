import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppLogger } from './AppLogger';

let dir: string;
const DAY = 24 * 60 * 60 * 1000;
const at = (iso: string) => new Date(iso).getTime();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'btterm-log-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('AppLogger', () => {
  it('날짜별 파일에 JSON 줄로 기록한다', async () => {
    const logger = await AppLogger.open(dir, { now: () => at('2026-10-20T09:00:00Z') });
    await logger.info('세션 열림', { host: 'web-01' });
    const text = await readFile(join(dir, 'app-2026-10-20.log'), 'utf8');
    expect(JSON.parse(text.trim())).toMatchObject({
      level: 'info',
      message: '세션 열림',
      data: { host: 'web-01' },
    });
  });

  it('SEC-4 비밀 키와 텍스트 속 비밀을 가린다', async () => {
    const logger = await AppLogger.open(dir, { now: () => at('2026-10-20T09:00:00Z') });
    await logger.error('연결 실패 mysql -psecret123', {
      password: 'hunter2',
      opts: { passphrase: 'x' },
    });
    const text = await readFile(join(dir, 'app-2026-10-20.log'), 'utf8');
    expect(text).not.toContain('hunter2');
    expect(text).not.toContain('secret123');
    expect(text).toContain('[masked]');
  });

  it('보관 기간(기본 7일)보다 오래된 로그 파일을 지운다', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'app-2026-10-10.log'), 'old\n');
    await writeFile(join(dir, 'app-2026-10-15.log'), 'recent\n');
    await writeFile(join(dir, 'other.txt'), 'keep\n');
    await AppLogger.open(dir, { now: () => at('2026-10-20T09:00:00Z') - 0 * DAY });
    expect((await readdir(dir)).sort()).toEqual(['app-2026-10-15.log', 'other.txt']);
  });

  it('로그 폴더가 없으면 만든다', async () => {
    const nested = join(dir, 'logs');
    const logger = await AppLogger.open(nested, { now: () => at('2026-10-20T09:00:00Z') });
    await logger.warn('x');
    expect(await readdir(nested)).toEqual(['app-2026-10-20.log']);
  });
});
