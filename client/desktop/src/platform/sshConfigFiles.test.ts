import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadSshConfig } from './sshConfigFiles';

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'btterm-sshcfg-'));
  await mkdir(join(home, '.ssh', 'config.d'), { recursive: true });
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

describe('loadSshConfig', () => {
  it('설정 파일이 없으면 빈 목록', async () => {
    await rm(join(home, '.ssh'), { recursive: true });
    expect((await loadSshConfig(home)).files).toEqual([]);
  });

  it('~/.ssh 기준 상대 경로와 * 패턴 Include를 이름순으로 읽는다', async () => {
    const ssh = join(home, '.ssh');
    await writeFile(join(ssh, 'config'), 'Include config.d/*\n');
    await writeFile(join(ssh, 'config.d', 'b.conf'), 'Host b\n');
    await writeFile(join(ssh, 'config.d', 'a.conf'), 'Host a\n');
    const { files, resolveInclude } = await loadSshConfig(home);
    expect(files.map((f) => f.text)).toEqual(['Include config.d/*\n']);
    expect(resolveInclude('config.d/*', files[0]!.path).map((f) => f.text)).toEqual([
      'Host a\n',
      'Host b\n',
    ]);
    expect(resolveInclude('~/.ssh/config.d/a.conf', files[0]!.path)).toHaveLength(1);
    expect(resolveInclude('missing/*', files[0]!.path)).toEqual([]);
  });
});
