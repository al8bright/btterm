import { readdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { ResolveInclude, SshConfigFile } from '@btterm/core';

const MAX_INCLUDE_FILES = 64;

/** 사용자 ~/.ssh/config와 Include 해석기(F1.4). 읽기만 한다. */
export async function loadSshConfig(
  home: string = homedir(),
): Promise<{ files: SshConfigFile[]; resolveInclude: ResolveInclude }> {
  const sshDir = join(home, '.ssh');
  const path = join(sshDir, 'config');
  const files: SshConfigFile[] = [];
  try {
    files.push({ path, text: await readFile(path, 'utf8') });
  } catch {
    // 설정 파일이 없으면 가져올 것이 없다.
  }
  return { files, resolveInclude: (pattern) => resolveInclude(pattern, home, sshDir) };
}

/** OpenSSH처럼 상대 경로는 ~/.ssh 기준. 와일드카드는 마지막 경로 요소에서만 지원한다. */
function resolveInclude(pattern: string, home: string, sshDir: string): SshConfigFile[] {
  const expanded = pattern.startsWith('~/') ? join(home, pattern.slice(2)) : pattern;
  const full = isAbsolute(expanded) ? expanded : join(sshDir, expanded);
  const dir = dirname(full);
  const name = basename(full);
  let names: string[];
  try {
    names = /[*?]/.test(name)
      ? readdirSync(dir)
          .filter((entry) => globToRegExp(name).test(entry))
          .sort()
      : [name];
  } catch {
    return [];
  }
  return names.slice(0, MAX_INCLUDE_FILES).flatMap((entry) => {
    const path = join(dir, entry);
    try {
      return [{ path, text: readFileSync(path, 'utf8') }];
    } catch {
      return [];
    }
  });
}

function globToRegExp(glob: string): RegExp {
  const source = glob
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`);
}
