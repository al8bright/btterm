import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  parseOsc7,
  RemoteFiles,
  ResourceTracker,
  TransferQueue,
  type SshConnection,
  type TransferStatus,
} from '@btterm/core';
import { nodeClock } from '../../shared/nodeClock';
import { Ssh2Transport } from '../ssh/Ssh2Transport';
import { createTransferEndpoints } from './transferEndpoints';
import { blackhole, resetSshProxy, SSH_PROXY } from '../../../test/toxiproxy';

// test/sshd/compose.yml 의 target 서비스(btterm 사용자, 로그인 셸 bash)
const env = { host: '127.0.0.1', port: 2222, username: 'btterm', keepaliveSec: 0 };

async function connect(): Promise<SshConnection> {
  return new Ssh2Transport().connect(env, [{ kind: 'password', password: 'btterm-pw' }], {
    verifyHostKey: async () => true,
  });
}

/** 로그인 셸에서 명령을 치고 출력에서 OSC 7 보고를 모은다. */
async function osc7After(conn: SshConnection, command: string): Promise<string[]> {
  const shell = await conn.openShell({ cols: 120, rows: 30 });
  let out = '';
  shell.onData((chunk) => (out += new TextDecoder().decode(chunk)));
  await new Promise((resolve) => setTimeout(resolve, 800));
  shell.write(`${command}\n`);
  await new Promise((resolve) => setTimeout(resolve, 800));
  shell.close();
  // eslint-disable-next-line no-control-regex -- 터미널 출력에서 OSC 7(ESC ] 7 ; ... BEL|ST)을 찾는다
  return [...out.matchAll(/\u001b\]7;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g)].map(
    (m) => parseOsc7(m[1]!)?.path ?? 'INVALID',
  );
}

describe('셸 통합 실제 bash(F4.5, AC16)', () => {
  let conn: SshConnection;
  let files: RemoteFiles;

  beforeAll(async () => {
    conn = await connect();
    files = new RemoteFiles(() => conn.openSftp());
    await files.uninstallShellIntegration();
  });

  afterAll(async () => {
    // 다른 테스트가 보는 셸 출력을 바꾸지 않도록 되돌린다.
    await files.uninstallShellIntegration();
    files.close();
    conn.end();
  });

  it('설치 전에는 OSC 7이 없고, 설치하면 새 로그인 셸이 cd마다 현재 폴더를 알린다(한글 포함)', async () => {
    expect(await osc7After(conn, 'cd /tmp')).toEqual([]);
    const status = await files.installShellIntegration();
    expect(status).toMatchObject({ installed: true, loginCovered: true });

    const dir = `/tmp/btterm 한글-${randomUUID().slice(0, 8)}`;
    const reports = await osc7After(conn, `mkdir -p '${dir}' && cd '${dir}'`);
    expect(reports.at(-1)).toBe(dir);
    expect(reports).not.toContain('INVALID');
  });
});

describe('전송 실제 SFTP(AC11)', () => {
  let conn: SshConnection;
  let dir: string;

  beforeAll(async () => {
    conn = await connect();
    dir = await mkdtemp(join(tmpdir(), 'btterm-ac11-'));
  });

  afterAll(async () => {
    conn.end();
    await rm(dir, { recursive: true, force: true });
  });

  it('AC11 대용량 업로드를 취소하면 1초 안에 멈추고 원격에 부분 파일이 남지 않는다', async () => {
    const local = join(dir, 'big.bin');
    await writeFile(local, Buffer.alloc(200 * 1024 * 1024, 7));
    const statuses: TransferStatus[] = [];
    const tracker = new ResourceTracker();
    const sftp = await conn.openSftp();
    const queue = new TransferQueue({
      endpoints: createTransferEndpoints(async () => sftp),
      clock: nodeClock,
      tracker,
      platform: 'windows',
      ids: { next: () => randomUUID() },
      askConflict: async () => ({ decision: 'overwrite' }),
      onStatus: (s) => statuses.push(s),
    });
    const remoteName = `big-${randomUUID()}.bin`;
    queue.enqueue({
      id: 't1',
      sessionId: 's1',
      direction: 'upload',
      sourcePath: local,
      targetDir: '/tmp',
      name: remoteName,
    });
    await expect.poll(() => statuses.some((s) => s.bytes > 0), { timeout: 10_000 }).toBe(true);

    const started = Date.now();
    queue.cancel('t1');
    await expect.poll(() => statuses.at(-1)?.state, { timeout: 2000 }).toBe('cancelled');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await sftp.stat(`/tmp/${remoteName}`)).toBeNull();

    queue.dispose();
    sftp.close();
    tracker.assertAllDisposed();
  });

  it('AC12 전송 중 네트워크가 끊기면 keepalive 간격 × 3 + 2초 안에 전송을 실패로 끝낸다', async () => {
    await resetSshProxy();
    const keepaliveSec = 1;
    const proxied = await new Ssh2Transport().connect(
      { ...env, host: SSH_PROXY.host, port: SSH_PROXY.port, keepaliveSec },
      [{ kind: 'password', password: 'btterm-pw' }],
      { verifyHostKey: async () => true },
    );
    const local = join(dir, 'drop.bin');
    await writeFile(local, Buffer.alloc(200 * 1024 * 1024, 1));
    const statuses: TransferStatus[] = [];
    const tracker = new ResourceTracker();
    const sftp = await proxied.openSftp();
    const queue = new TransferQueue({
      endpoints: createTransferEndpoints(async () => sftp),
      clock: nodeClock,
      tracker,
      platform: 'windows',
      ids: { next: () => randomUUID() },
      askConflict: async () => ({ decision: 'overwrite' }),
      onStatus: (s) => statuses.push(s),
    });
    queue.enqueue({
      id: 'drop',
      sessionId: 's1',
      direction: 'upload',
      sourcePath: local,
      targetDir: '/tmp',
      name: `drop-${randomUUID()}.bin`,
    });
    await expect.poll(() => statuses.some((s) => s.bytes > 0), { timeout: 10_000 }).toBe(true);

    await blackhole();
    const started = Date.now();
    await expect
      .poll(() => statuses.at(-1)?.state, { timeout: (keepaliveSec * 3 + 2) * 1000 })
      .toBe('failed');
    expect(Date.now() - started).toBeLessThan((keepaliveSec * 3 + 2) * 1000);

    queue.dispose();
    proxied.end();
    tracker.assertAllDisposed();
    await resetSshProxy();
  });
});

describe('덮어쓰기 업로드는 원격 권한을 지킨다(F4.8, 결정 TR3)', () => {
  it('실행 권한(755)이 있는 스크립트를 덮어써도 권한이 그대로다', async () => {
    const conn = await connect();
    const sftp = await conn.openSftp();
    const dir = await mkdtemp(join(tmpdir(), 'btterm-tr3-'));
    const name = `run-${randomUUID().slice(0, 8)}.sh`;
    await sftp.writeFile(`/tmp/${name}`, new TextEncoder().encode('echo old\n'));
    await sftp.chmod(`/tmp/${name}`, 0o755);
    await writeFile(join(dir, name), 'echo new\n');

    const statuses: TransferStatus[] = [];
    const tracker = new ResourceTracker();
    const queue = new TransferQueue({
      endpoints: createTransferEndpoints(async () => sftp),
      clock: nodeClock,
      tracker,
      platform: 'windows',
      ids: { next: () => randomUUID() },
      askConflict: async () => ({ decision: 'skip' }),
      onStatus: (s) => statuses.push(s),
    });
    queue.enqueue({
      id: 'u1',
      sessionId: 's1',
      direction: 'upload',
      sourcePath: join(dir, name),
      targetDir: '/tmp',
      name,
      overwrite: true,
    });
    await expect.poll(() => statuses.at(-1)?.state, { timeout: 10_000 }).toBe('done');
    expect(new TextDecoder().decode(await sftp.readFile(`/tmp/${name}`))).toBe('echo new\n');
    expect((await sftp.stat(`/tmp/${name}`))?.mode).toBe(0o755);

    queue.dispose();
    sftp.close();
    conn.end();
    tracker.assertAllDisposed();
    await rm(dir, { recursive: true, force: true });
  });
});

describe('이어받기 실제 SFTP(F4.7, 결정 TR2)', () => {
  it('업로드 중 연결이 끊겨 실패하면 부분 파일을 남기고, 다시 연결해 다시 시도하면 그 지점부터 이어 같은 내용이 된다', async () => {
    await resetSshProxy();
    const dir = await mkdtemp(join(tmpdir(), 'btterm-tr2-'));
    const local = join(dir, 'resume.bin');
    const data = Buffer.alloc(120 * 1024 * 1024);
    for (let i = 0; i < data.length; i += 4096) data.writeUInt32LE(i, i);
    await writeFile(local, data);
    const connectProxied = () =>
      new Ssh2Transport().connect(
        { ...env, host: SSH_PROXY.host, port: SSH_PROXY.port, keepaliveSec: 1 },
        [{ kind: 'password', password: 'btterm-pw' }],
        { verifyHostKey: async () => true },
      );
    let conn = await connectProxied();
    let sftp = await conn.openSftp();
    const statuses: TransferStatus[] = [];
    const tracker = new ResourceTracker();
    const queue = new TransferQueue({
      endpoints: createTransferEndpoints(async () => sftp),
      clock: nodeClock,
      tracker,
      platform: 'windows',
      ids: { next: () => randomUUID() },
      askConflict: async () => ({ decision: 'overwrite' }),
      onStatus: (s) => statuses.push(s),
    });
    const name = `resume-${randomUUID()}.bin`;
    queue.enqueue({
      id: 'r1',
      sessionId: 's1',
      direction: 'upload',
      sourcePath: local,
      targetDir: '/tmp',
      name,
    });
    await expect
      .poll(() => statuses.some((s) => s.bytes > 8 * 1024 * 1024), { timeout: 20_000 })
      .toBe(true);
    await blackhole();
    await expect.poll(() => statuses.at(-1)?.state, { timeout: 10_000 }).toBe('failed');
    const failedAt = statuses.at(-1)!.bytes;
    conn.end();

    await resetSshProxy();
    conn = await connectProxied();
    sftp = await conn.openSftp();
    expect((await sftp.stat(`/tmp/${name}.btterm-part`))?.size).toBeGreaterThan(0);
    expect(await sftp.stat(`/tmp/${name}`)).toBeNull();

    const before = statuses.length;
    queue.retry('r1');
    await expect.poll(() => statuses.at(-1)?.state, { timeout: 60_000 }).toBe('done');
    const firstAfter = statuses.slice(before).find((s) => s.state === 'running')!;
    expect(firstAfter.bytes).toBeGreaterThan(0);
    // 마지막 쓰기는 서버에 닿고 응답만 끊길 수 있어 부분 파일이 센 바이트보다 클 수 있다(순서대로 써서 앞부분은 같다)
    expect(firstAfter.bytes).toBeGreaterThanOrEqual(failedAt);
    const copy = Buffer.from(await sftp.readFile(`/tmp/${name}`));
    expect(copy.equals(data)).toBe(true);
    expect(await sftp.stat(`/tmp/${name}.btterm-part`)).toBeNull();

    queue.dispose();
    sftp.close();
    conn.end();
    tracker.assertAllDisposed();
    await rm(dir, { recursive: true, force: true });
  }, 120_000);
});

describe('폴더째 전송 실제 SFTP(F4.7, 결정 TR1)', () => {
  let conn: SshConnection;
  let dir: string;

  beforeAll(async () => {
    conn = await connect();
    dir = await mkdtemp(join(tmpdir(), 'btterm-tr1-'));
  });

  afterAll(async () => {
    conn.end();
    await rm(dir, { recursive: true, force: true });
  });

  it('로컬 폴더(한글·하위 폴더)를 올렸다 다시 내려받으면 같은 트리와 내용이다', async () => {
    const name = `트리-${randomUUID().slice(0, 8)}`;
    const local = join(dir, name);
    await mkdir(join(local, 'sub', '깊은'), { recursive: true });
    await writeFile(join(local, 'a.txt'), '가나다');
    await writeFile(join(local, 'sub', 'b.bin'), Buffer.alloc(300 * 1024, 3));
    await writeFile(join(local, 'sub', '깊은', 'c.md'), '# c');

    const statuses: TransferStatus[] = [];
    const tracker = new ResourceTracker();
    const sftp = await conn.openSftp();
    const queue = new TransferQueue({
      endpoints: createTransferEndpoints(async () => sftp),
      clock: nodeClock,
      tracker,
      platform: 'windows',
      ids: { next: () => randomUUID() },
      askConflict: async () => ({ decision: 'overwrite' }),
      onStatus: (s) => statuses.push(s),
    });
    queue.enqueue({
      id: 'up',
      sessionId: 's1',
      direction: 'upload',
      sourcePath: local,
      targetDir: '/tmp',
      name,
    });
    await expect
      .poll(() => statuses.filter((s) => s.id === 'up').at(-1)?.state, { timeout: 20_000 })
      .toBe('done');
    expect(statuses.filter((s) => s.id === 'up').at(-1)).toMatchObject({
      folder: true,
      bytes: 3,
      total: 3,
    });

    const back = join(dir, 'back');
    await mkdir(back);
    queue.enqueue({
      id: 'down',
      sessionId: 's1',
      direction: 'download',
      sourcePath: `/tmp/${name}`,
      targetDir: back,
      name,
    });
    await expect
      .poll(() => statuses.filter((s) => s.id === 'down').at(-1)?.state, { timeout: 20_000 })
      .toBe('done');

    const copy = join(back, name);
    expect(await readFile(join(copy, 'a.txt'), 'utf8')).toBe('가나다');
    expect((await readFile(join(copy, 'sub', 'b.bin'))).length).toBe(300 * 1024);
    expect(await readFile(join(copy, 'sub', '깊은', 'c.md'), 'utf8')).toBe('# c');
    expect((await readdir(copy)).sort()).toEqual(['a.txt', 'sub']);

    queue.dispose();
    sftp.close();
    tracker.assertAllDisposed();
  });

  it('폴더 안 심볼릭 링크는 따라가지 않고 건너뛴다(순환 방지)', async () => {
    const name = `링크-${randomUUID().slice(0, 8)}`;
    const sftp = await conn.openSftp();
    await sftp.mkdir(`/tmp/${name}`);
    await sftp.writeFile(`/tmp/${name}/real.txt`, new TextEncoder().encode('real'));
    // 원격에 자기 자신을 가리키는 링크(순환)
    execFileSync('docker', [
      'exec',
      '-u',
      'btterm',
      'btterm-test-target-1',
      'ln',
      '-s',
      `/tmp/${name}`,
      `/tmp/${name}/loop`,
    ]);

    const statuses: TransferStatus[] = [];
    const tracker = new ResourceTracker();
    const queue = new TransferQueue({
      endpoints: createTransferEndpoints(async () => sftp),
      clock: nodeClock,
      tracker,
      platform: 'windows',
      ids: { next: () => randomUUID() },
      askConflict: async () => ({ decision: 'overwrite' }),
      onStatus: (s) => statuses.push(s),
    });
    const back = join(dir, `back-${name}`);
    await mkdir(back);
    queue.enqueue({
      id: 'down',
      sessionId: 's1',
      direction: 'download',
      sourcePath: `/tmp/${name}`,
      targetDir: back,
      name,
    });
    await expect
      .poll(() => statuses.filter((s) => s.id === 'down').at(-1)?.state, { timeout: 20_000 })
      .toBe('done');
    expect(await readdir(join(back, name))).toEqual(['real.txt']);

    queue.dispose();
    sftp.close();
    tracker.assertAllDisposed();
  });
});
