import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RemoteFiles, type SftpSession, type SshConnection } from '@btterm/core';
import { describeSftpContract } from '@btterm/core/testing';
import { Ssh2Transport } from './Ssh2Transport';

// test/sshd/compose.yml 의 target 서비스. 스위트마다 홈 아래 빈 폴더를 만들어 쓰고 지운다.
const env = { host: '127.0.0.1', port: 2222, username: 'btterm', keepaliveSec: 0 };

describeSftpContract('ssh2 + Docker sshd', async () => {
  const conn: SshConnection = await new Ssh2Transport().connect(
    env,
    [{ kind: 'password', password: 'btterm-pw' }],
    { verifyHostKey: async () => true },
  );
  const sftp = await conn.openSftp();
  const workDir = `btterm-contract-${randomUUID()}`;
  await sftp.mkdir(workDir);
  return {
    sftp,
    workDir,
    cleanup: async () => {
      const files = new RemoteFiles(() => conn.openSftp());
      await files.remove(workDir);
      files.close();
      conn.end();
    },
  };
});

/** 컨테이너 안에서 btterm 사용자로 셸 명령을 실행한다(SFTP 포트에 없는 심볼릭 링크 만들기 등) */
function sh(script: string): string {
  return execFileSync(
    'docker',
    ['exec', '-u', 'btterm', 'btterm-test-target-1', 'sh', '-c', script],
    {
      encoding: 'utf8',
    },
  );
}

describe('Ssh2Sftp 링크 rc 권한 (F4.5)', () => {
  let conn: SshConnection;
  let sftp: SftpSession;
  let dir: string;
  let home: string;

  beforeAll(async () => {
    conn = await new Ssh2Transport().connect(env, [{ kind: 'password', password: 'btterm-pw' }], {
      verifyHostKey: async () => true,
    });
    sftp = await conn.openSftp();
    const workDir = `btterm-link-${randomUUID()}`;
    await sftp.mkdir(workDir);
    dir = await sftp.realpath(workDir);
    home = await sftp.realpath('.');
  });

  afterAll(async () => {
    const files = new RemoteFiles(() => conn.openSftp());
    await files.remove(dir);
    files.close();
    sftp.close();
    conn.end();
  });

  it('F4.5 링크를 원자적으로 바꾸면 링크는 두고 대상(600)의 권한을 그대로 둔다', async () => {
    await sftp.createFile(`${dir}/real-rc`, new TextEncoder().encode('export TOKEN=1\n'), 0o600);
    sh(`ln -s real-rc '${dir}/rc'`);
    await sftp.writeFileAtomic(`${dir}/rc`, new TextEncoder().encode('export TOKEN=2\n'));
    expect((await sftp.stat(`${dir}/rc`))?.type).toBe('link');
    expect((await sftp.stat(`${dir}/real-rc`))?.mode).toBe(0o600);
    expect(new TextDecoder().decode(await sftp.readFile(`${dir}/real-rc`))).toBe(
      'export TOKEN=2\n',
    );
    expect((await sftp.list(dir)).map((e) => e.name)).toEqual(['rc', 'real-rc']);
  });

  it('F4.5 ~/.bashrc가 600 파일을 가리키는 링크여도 셸 통합의 백업·교체 파일이 600이다', async () => {
    const saved = `.bashrc.saved-${randomUUID()}`;
    sh(
      `cd '${home}' && { [ -e .bashrc ] || [ -L .bashrc ]; } && mv .bashrc ${saved}; ` +
        `rm -f .bashrc.btterm-backup; printf 'export TOKEN=1\\n' > '${dir}/bashrc' && ` +
        `chmod 600 '${dir}/bashrc' && ln -s '${dir}/bashrc' .bashrc`,
    );
    const files = new RemoteFiles(() => conn.openSftp());
    try {
      await files.installShellIntegration();
      expect((await sftp.stat(`${home}/.bashrc`))?.type).toBe('link');
      expect((await sftp.stat(`${dir}/bashrc`))?.mode).toBe(0o600);
      expect((await sftp.stat(`${home}/.bashrc.btterm-backup`))?.mode).toBe(0o600);
      await files.uninstallShellIntegration();
      expect((await sftp.stat(`${dir}/bashrc`))?.mode).toBe(0o600);
      expect((await sftp.stat(`${home}/.bashrc.btterm-backup`))?.mode).toBe(0o600);
    } finally {
      files.close();
      sh(
        `cd '${home}' && rm -f .bashrc .bashrc.btterm-backup; ` +
          `{ [ -e ${saved} ] || [ -L ${saved} ]; } && mv ${saved} .bashrc; true`,
      );
    }
  });
});
