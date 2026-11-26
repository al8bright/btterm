import { appendFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { maskForLog, maskSecretsInText } from '@btterm/core';

type Level = 'debug' | 'info' | 'warn' | 'error';

interface AppLoggerOptions {
  now?: () => number;
  retentionDays?: number;
}

const FILE = /^app-(\d{4}-\d{2}-\d{2})\.log$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 앱 로그(F6.4). userData/logs/app-YYYY-MM-DD.log 에 JSON 줄로 남기고, 모든 값은 기록 전에
 * 마스킹한다(SEC-4). 열 때 보관 기간이 지난 파일을 지운다.
 */
export class AppLogger {
  private constructor(
    private readonly dir: string,
    private readonly now: () => number,
  ) {}

  static async open(dir: string, options: AppLoggerOptions = {}): Promise<AppLogger> {
    const now = options.now ?? Date.now;
    const retentionDays = options.retentionDays ?? 7;
    await mkdir(dir, { recursive: true });
    const cutoff = dayOf(now() - retentionDays * DAY_MS);
    for (const name of await readdir(dir)) {
      const match = FILE.exec(name);
      if (match && match[1]! < cutoff) await rm(join(dir, name), { force: true });
    }
    return new AppLogger(dir, now);
  }

  debug(message: string, data?: unknown): Promise<void> {
    return this.#write('debug', message, data);
  }

  info(message: string, data?: unknown): Promise<void> {
    return this.#write('info', message, data);
  }

  warn(message: string, data?: unknown): Promise<void> {
    return this.#write('warn', message, data);
  }

  error(message: string, data?: unknown): Promise<void> {
    return this.#write('error', message, data);
  }

  async #write(level: Level, message: string, data: unknown): Promise<void> {
    const time = this.now();
    const line = JSON.stringify({
      time: new Date(time).toISOString(),
      level,
      message: maskSecretsInText(message),
      ...(data === undefined ? {} : { data: maskForLog(data) }),
    });
    await appendFile(join(this.dir, `app-${dayOf(time)}.log`), `${line}\n`, 'utf8');
  }
}

function dayOf(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}
