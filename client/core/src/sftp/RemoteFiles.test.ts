import { describe, expect, it } from 'vitest';
import { FakeRemoteFs, FakeSftp } from '../testing/FakeSftp';
import { RemoteFiles } from './RemoteFiles';
import { RC_BLOCK, SHELL_SCRIPT } from './shellIntegration';

function setup() {
  const fs = new FakeRemoteFs('/home/u');
  const opened: FakeSftp[] = [];
  const files = new RemoteFiles(async () => {
    const sftp = new FakeSftp(fs);
    opened.push(sftp);
    return sftp;
  });
  return { fs, files, opened };
}

describe('RemoteFiles (F4.1, F4.2)', () => {
  it('목록은 실제 경로와 폴더 먼저 이름순 항목을 돌려준다', async () => {
    const { fs, files } = setup();
    fs.writeText('b.txt', 'b');
    fs.writeText('a.txt', 'a');
    await (await files.session()).mkdir('zdir');
    const listing = await files.list('.');
    expect(listing.path).toBe('/home/u');
    expect(listing.entries.map((e) => e.name)).toEqual(['zdir', 'a.txt', 'b.txt']);
  });

  it('채널은 한 번만 열고 close에서 닫는다', async () => {
    const { files, opened } = setup();
    await files.list('.');
    await files.list('/');
    expect(opened).toHaveLength(1);
    files.close();
    expect(opened[0]?.closed).toBe(true);
  });

  it('폴더를 내용째 지운다', async () => {
    const { fs, files } = setup();
    const sftp = await files.session();
    await sftp.mkdir('d');
    await sftp.mkdir('d/e');
    fs.writeText('d/e/f.txt', 'x');
    await files.remove('/home/u/d');
    expect((await files.list('.')).entries).toEqual([]);
  });
});

describe('RemoteFiles 셸 통합(F4.5, D10)', () => {
  it('설치: shell.sh를 만들고 .bashrc를 백업한 뒤 마커 블록을 넣는다(멱등)', async () => {
    const { fs, files } = setup();
    fs.writeText('.bashrc', 'export A=1\n');
    fs.writeText('.profile', '. "$HOME/.bashrc"\n');
    await files.installShellIntegration();
    await files.installShellIntegration();
    expect(fs.readText('.config/btterm/shell.sh')).toBe(SHELL_SCRIPT);
    expect(fs.readText('.bashrc')).toBe(`export A=1\n\n${RC_BLOCK}\n`);
    expect(fs.readText('.bashrc.btterm-backup')).toBe('export A=1\n');
    // .profile이 .bashrc를 읽으므로 로그인 파일은 건드리지 않는다.
    expect(fs.readText('.profile')).toBe('. "$HOME/.bashrc"\n');
    expect(await files.shellIntegrationStatus()).toEqual({
      installed: true,
      rcFiles: ['.bashrc'],
      loginCovered: true,
    });
  });

  it('.zshrc가 있으면 거기에도 넣는다', async () => {
    const { fs, files } = setup();
    fs.writeText('.zshrc', 'setopt x\n');
    await files.installShellIntegration();
    expect(fs.readText('.zshrc')).toContain(RC_BLOCK);
  });

  it('SSH 로그인 셸은 .bashrc를 읽지 않으므로, 로그인 파일이 없으면 .bash_profile에도 넣는다', async () => {
    const { fs, files } = setup();
    await files.installShellIntegration();
    expect(fs.readText('.bashrc')).toBe(`${RC_BLOCK}\n`);
    expect(fs.readText('.bash_profile')).toBe(`${RC_BLOCK}\n`);
    expect((await files.shellIntegrationStatus()).loginCovered).toBe(true);
  });

  it('로그인 파일이 .bashrc를 읽지 않으면 그 파일에도 넣는다(백업 후)', async () => {
    const { fs, files } = setup();
    fs.writeText('.bashrc', '');
    fs.writeText('.bash_profile', 'export PATH=$PATH:~/bin\n');
    expect((await files.shellIntegrationStatus()).loginCovered).toBe(false);
    await files.installShellIntegration();
    expect(fs.readText('.bash_profile')).toContain(RC_BLOCK);
    expect(fs.readText('.bash_profile.btterm-backup')).toBe('export PATH=$PATH:~/bin\n');
    expect(await files.shellIntegrationStatus()).toEqual({
      installed: true,
      rcFiles: ['.bashrc', '.bash_profile'],
      loginCovered: true,
    });
  });

  it('제거: 모든 파일에서 블록과 shell.sh를 지운다', async () => {
    const { fs, files } = setup();
    fs.writeText('.bashrc', 'export A=1\n');
    fs.writeText('.profile', 'umask 022\n');
    await files.installShellIntegration();
    await files.uninstallShellIntegration();
    expect(fs.readText('.profile')).toBe('umask 022\n');
    expect(fs.readText('.bashrc')).toBe('export A=1\n');
    expect(fs.readText('.config/btterm/shell.sh')).toBeUndefined();
    expect((await files.shellIntegrationStatus()).installed).toBe(false);
  });
});

describe('RemoteFiles.run', () => {
  it('IPC 파일 작업을 실행한다', async () => {
    const { fs, files } = setup();
    fs.writeText('a.txt', 'a');
    await files.run({ kind: 'mkdir', path: 'd' });
    await files.run({ kind: 'rename', from: 'a.txt', to: 'd/b.txt' });
    await files.run({ kind: 'chmod', path: 'd/b.txt', mode: 0o600 });
    const listing = (await files.run({ kind: 'list', path: 'd' })) as { entries: unknown[] };
    expect(listing.entries).toEqual([
      { name: 'b.txt', type: 'file', size: 1, mtimeMs: 0, mode: 0o600 },
    ]);
    await files.run({ kind: 'remove', path: 'd' });
    expect((await files.list('.')).entries).toEqual([]);
  });
});

describe('RemoteFiles 셸 통합 안전성(보안 리뷰 #3·#5)', () => {
  class TrackingSftp extends FakeSftp {
    readonly atomic: string[] = [];
    readonly plain: string[] = [];
    override async writeFileAtomic(path: string, data: Uint8Array): Promise<void> {
      this.atomic.push(path);
      await super.writeFileAtomic(path, data);
    }
    override async writeFile(path: string, data: Uint8Array): Promise<void> {
      this.plain.push(path);
      await super.writeFile(path, data);
    }
  }

  function tracked() {
    const fs = new FakeRemoteFs('/home/u');
    const sftp = new TrackingSftp(fs);
    return { fs, sftp, files: new RemoteFiles(async () => sftp) };
  }

  it('rc·로그인 파일·스크립트는 원자적으로 쓴다', async () => {
    const { fs, sftp, files } = tracked();
    fs.writeText('.bashrc', 'export A=1\n');
    await files.installShellIntegration();
    expect(sftp.atomic).toEqual(
      expect.arrayContaining(['.config/btterm/shell.sh', '.bashrc', '.bash_profile']),
    );
    expect(sftp.plain.filter((p) => !p.endsWith('.btterm-backup'))).toEqual([]);
  });

  it('제거하기 전에도 바꾸기 직전 내용을 백업한다', async () => {
    const { fs, files } = tracked();
    fs.writeText('.bashrc', 'export A=1\n');
    await files.installShellIntegration();
    const installed = fs.readText('.bashrc');
    await files.uninstallShellIntegration();
    expect(fs.readText('.bashrc.btterm-backup')).toBe(installed);
  });

  it('비정상적으로 큰 rc 파일은 읽지도 바꾸지도 않는다', async () => {
    const { fs, files } = tracked();
    fs.writeText('.bashrc', 'x'.repeat(2 * 1024 * 1024));
    await expect(files.installShellIntegration()).rejects.toMatchObject({ code: 'failure' });
    expect(fs.readText('.bashrc')?.length).toBe(2 * 1024 * 1024);
  });
});

describe('RemoteFiles 공개키 등록 (F7.8, 결정 TR5)', () => {
  const KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIBtt3rm btterm';

  it('~/.ssh(700)와 authorized_keys(600)를 만들고 키를 넣는다', async () => {
    const { fs, files } = setup();
    expect(await files.installPublicKey(KEY)).toEqual({ added: true });
    const sftp = await files.session();
    expect((await sftp.stat('.ssh'))?.mode).toBe(0o700);
    expect((await sftp.stat('.ssh/authorized_keys'))?.mode).toBe(0o600);
    expect(fs.readText('.ssh/authorized_keys')).toBe(`${KEY}
`);
  });

  it('이미 있으면 쓰지 않고, 기존 키는 그대로 둔다', async () => {
    const { fs, files } = setup();
    const sftp = await files.session();
    await sftp.mkdir('.ssh');
    fs.writeText(
      '.ssh/authorized_keys',
      `ssh-rsa AAAAB3 old
${KEY}
`,
    );
    expect(await files.installPublicKey(KEY)).toEqual({ added: false });
    await files.installPublicKey('ssh-ed25519 AAAAnew');
    expect(fs.readText('.ssh/authorized_keys')).toBe(
      `ssh-rsa AAAAB3 old
${KEY}
ssh-ed25519 AAAAnew
`,
    );
  });

  it('기존 파일은 바꿔 넣지 않고 끝에 덧붙인다: 권한 유지(보안 리뷰 M1·M2)', async () => {
    const { fs, files } = setup();
    const sftp = await files.session();
    await sftp.mkdir('.ssh');
    fs.writeText('.ssh/authorized_keys', 'ssh-rsa AAAAB3 old');
    await sftp.chmod('.ssh/authorized_keys', 0o644);
    await files.installPublicKey(KEY);
    expect(fs.readText('.ssh/authorized_keys')).toBe(`ssh-rsa AAAAB3 old
${KEY}
`);
    expect((await sftp.stat('.ssh/authorized_keys'))?.mode).toBe(0o644);
  });

  it('쓰기 금지된 authorized_keys는 건드리지 않는다(보안 리뷰 L3)', async () => {
    const { fs, files } = setup();
    const sftp = await files.session();
    await sftp.mkdir('.ssh');
    fs.writeText('.ssh/authorized_keys', '');
    await sftp.chmod('.ssh/authorized_keys', 0o400);
    await expect(files.installPublicKey(KEY)).rejects.toMatchObject({ code: 'denied' });
    expect(fs.readText('.ssh/authorized_keys')).toBe('');
  });

  it('.ssh가 폴더가 아니면 아무것도 바꾸지 않는다', async () => {
    const { fs, files } = setup();
    fs.writeText('.ssh', 'oops');
    await expect(files.installPublicKey(KEY)).rejects.toMatchObject({ code: 'failure' });
    expect(fs.readText('.ssh')).toBe('oops');
  });

  it('공개키 줄 형식이 아니면 거부한다', async () => {
    const { files } = setup();
    await expect(files.installPublicKey('command="x" ' + KEY)).rejects.toMatchObject({
      code: 'failure',
    });
  });
});
