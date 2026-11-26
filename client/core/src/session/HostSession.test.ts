import { describe, expect, it } from 'vitest';
import { HostSession, type FramePort } from './HostSession';
import { FakeSshTransport } from '../testing/FakeSshTransport';
import { FakeClock } from '../time/FakeClock';
import { newTestTracker } from '../testing/trackers';
import type { HostToRendererFrame, SessionState } from '../ipc/contracts';
import type { Disposable } from '../resource/ResourceTracker';
import { STATS_SCRIPT } from '../stats/serverStats';

class FakePort implements FramePort {
  frames: HostToRendererFrame[] = [];
  closed = false;
  #listener: ((raw: unknown) => void) | null = null;
  post(frame: HostToRendererFrame): void {
    this.frames.push(frame);
  }
  onFrame(listener: (raw: unknown) => void): Disposable {
    this.#listener = listener;
    return { dispose: () => (this.#listener = null) };
  }
  close(): void {
    this.closed = true;
  }
  send(raw: unknown): void {
    this.#listener?.(raw);
  }
  text(): string {
    return this.frames
      .flatMap((f) => (f.t === 'data' ? [new TextDecoder().decode(f.data)] : []))
      .join('');
  }
}

function setup(
  options: {
    accept?: boolean;
    high?: number;
    low?: number;
    files?: Record<string, string | Uint8Array | 'denied'>;
    exec?: (command: string) => string | null;
  } = {},
) {
  const transport = new FakeSshTransport({
    users: { alice: 'pw' },
    files: options.files ?? {},
    ...(options.exec ? { exec: options.exec } : {}),
  });
  const clock = new FakeClock();
  const port = new FakePort();
  const states: Array<[SessionState, string | undefined]> = [];
  const session = new HostSession({
    transport,
    clock,
    tracker: newTestTracker(),
    port,
    reportState: (state, errorCode) => states.push([state, errorCode]),
    verifyHostKey: async () => options.accept ?? true,
    flow: { highWaterMark: options.high ?? 1024 * 1024, lowWaterMark: options.low ?? 1024 },
  });
  const open = () =>
    session.open({
      host: 'h',
      port: 22,
      username: 'alice',
      keepaliveSec: 0,
      auth: [{ kind: 'password', password: 'pw' }],
      size: { cols: 80, rows: 24 },
    });
  return { transport, clock, port, states, session, open };
}

describe('HostSession', () => {
  it('접속에 성공하면 connecting → authenticating → ready 순으로 보고한다', async () => {
    const { states, session, open } = setup();
    await open();
    expect(states.map(([s]) => s)).toEqual(['connecting', 'authenticating', 'ready']);
    session.close();
  });

  it('AC9 호스트 키를 거부하면 failed(host-key-rejected)를 보고하고 자원을 해제한다', async () => {
    const { states, port, open } = setup({ accept: false });
    await open();
    expect(states.at(-1)).toEqual(['failed', 'host-key-rejected']);
    expect(port.closed).toBe(true);
  });

  it('연결 중에 닫은 세션은 호스트 키 확인 뒤 늦게 성립한 연결을 바로 끊는다(고아 연결 방지)', async () => {
    const transport = new FakeSshTransport({ users: { alice: 'pw' }, files: {} });
    let answer: (ok: boolean) => void = () => undefined;
    const session = new HostSession({
      transport,
      clock: new FakeClock(),
      tracker: newTestTracker(),
      port: new FakePort(),
      reportState: () => undefined,
      verifyHostKey: () => new Promise<boolean>((resolve) => (answer = resolve)),
      flow: { highWaterMark: 1024 * 1024, lowWaterMark: 1024 },
    });
    const opening = session.open({
      host: 'h',
      port: 22,
      username: 'alice',
      keepaliveSec: 0,
      auth: [{ kind: 'password', password: 'pw' }],
      size: { cols: 80, rows: 24 },
    });
    await Promise.resolve();
    session.close();
    answer(true);
    await opening;
    expect(transport.openConnections).toBe(0);
  });

  it('F6.11 셸이 준비되면 연결 직후 명령을 한 번 입력하고 Enter', async () => {
    const { clock, port, session, states } = setup();
    await session.open({
      host: 'h',
      port: 22,
      username: 'alice',
      keepaliveSec: 0,
      auth: [{ kind: 'password', password: 'pw' }],
      size: { cols: 80, rows: 24 },
      startupCommand: 'echo started-$((40+2))',
    });
    clock.advance(16);
    expect(states.at(-1)?.[0]).toBe('ready');
    expect(port.text()).toContain('echo started-$((40+2))\r\n');
    session.close();
  });

  it('셸 출력을 병합해 data 프레임으로 보낸다', async () => {
    const { transport, clock, port, session, open } = setup();
    await open();
    transport.emitShellOutput('hello ');
    transport.emitShellOutput('world');
    expect(port.frames).toEqual([]);
    clock.advance(16);
    expect(port.text()).toBe('hello world');
    session.close();
  });

  it('input 프레임을 셸에 쓴다', async () => {
    const { clock, port, session, open } = setup();
    await open();
    port.send({ t: 'input', data: 'echo hi\n' });
    clock.advance(16);
    expect(port.text()).toContain('hi\r\n');
    session.close();
  });

  it('AC4 resize 프레임을 PTY 크기로 전달한다', async () => {
    const { transport, port, session, open } = setup();
    await open();
    port.send({ t: 'resize', cols: 120, rows: 40 });
    expect(transport.lastPtySize).toEqual({ cols: 120, rows: 40 });
    session.close();
  });

  it('스키마에 맞지 않는 프레임은 무시한다', async () => {
    const { transport, port, session, open } = setup();
    await open();
    port.send({ t: 'resize', cols: 0, rows: 0 });
    port.send({ t: 'exec', cmd: 'rm -rf /' });
    port.send('garbage');
    expect(transport.lastPtySize).toEqual({ cols: 80, rows: 24 });
    session.close();
  });

  it('AC17 미확인 바이트가 HIGH를 넘으면 셸을 멈추고 ACK 후 재개한다', async () => {
    const { transport, clock, port, session, open } = setup({ high: 8, low: 2 });
    await open();
    transport.emitShellOutput('0123456789');
    clock.advance(16);
    const sent = port.text().length;
    transport.emitShellOutput('paused-data');
    clock.advance(16);
    expect(port.text().length).toBe(sent);
    port.send({ t: 'ack', bytes: sent });
    clock.advance(16);
    expect(port.text()).toContain('paused-data');
    session.close();
  });

  it('AC12 연결이 끊기면 failed(closed)를 보고하고 모든 자원을 해제한다', async () => {
    const { transport, states, port, open } = setup();
    await open();
    transport.dropConnection();
    expect(states.at(-1)).toEqual(['failed', 'closed']);
    expect(port.frames.at(-1)).toEqual({ t: 'exit' });
    expect(port.closed).toBe(true);
  });

  it('AC13 close() 하면 exit 프레임을 보내고 closed를 보고하며 자원을 해제한다', async () => {
    const { states, port, session, open } = setup();
    await open();
    session.close();
    expect(states.at(-1)).toEqual(['closed', undefined]);
    expect(port.frames.at(-1)).toEqual({ t: 'exit' });
    expect(port.closed).toBe(true);
  });

  it('F2.1 keyboard-interactive 프롬프트에 답하면 접속하고, 답을 주지 않으면 auth-failed', async () => {
    const transport = new FakeSshTransport({
      users: {},
      keyboardInteractive: { prompt: 'Verification code: ', answer: '123456' },
    });
    const run = async (answer: string | null) => {
      const states: Array<[SessionState, string | undefined]> = [];
      const asked: string[] = [];
      const session = new HostSession({
        transport,
        clock: new FakeClock(),
        tracker: newTestTracker(),
        port: new FakePort(),
        reportState: (state, code) => states.push([state, code]),
        verifyHostKey: async () => true,
        keyboardInteractive: async (request) => {
          asked.push(...request.prompts.map((p) => p.prompt));
          return answer === null ? [] : [answer];
        },
      });
      await session.open({
        host: 'h',
        port: 22,
        username: 'alice',
        keepaliveSec: 0,
        auth: [],
        size: { cols: 80, rows: 24 },
      });
      session.close();
      return { states, asked };
    };
    const ok = await run('123456');
    expect(ok.asked).toEqual(['Verification code: ']);
    expect(ok.states.map(([s]) => s)).toContain('ready');
    const bad = await run(null);
    expect(bad.states.find(([s]) => s === 'failed')).toEqual(['failed', 'auth-failed']);
  });

  it('F6.6 probe: 살아 있으면 true, 응답이 없으면 연결을 끊고 failed(closed)', async () => {
    const { transport, states, session, open } = setup();
    await open();
    expect(await session.probe(1000)).toBe(true);
    transport.freezeConnection();
    expect(await session.probe(1000)).toBe(false);
    expect(states.at(-1)).toEqual(['failed', 'closed']);
  });

  it('F3.17a 원격 ~/.bash_history를 읽어 정리·마스킹한 항목을 최신순으로 돌려준다', async () => {
    const env = setup({
      files: {
        '.bash_history':
          'ls\n mysql -p secret\ncurl -H "Authorization: Bearer abc123"\nls\ngit status\n',
      },
    });
    await env.open();
    const result = await env.session.readHistory();
    expect(result.status).toBe('ok');
    expect(result.entries.map((e) => e.command)).toEqual([
      'git status',
      'ls',
      expect.stringContaining('Authorization: Bearer'),
    ]);
    expect(JSON.stringify(result)).not.toContain('abc123');
    env.session.close();
  });

  it('F3.17a bash 기록이 없으면 zsh 기록을, 둘 다 없으면 missing', async () => {
    const zsh = setup({ files: { '.zsh_history': ': 1700000000:0;echo zsh\n' } });
    await zsh.open();
    expect(await zsh.session.readHistory()).toEqual({
      status: 'ok',
      entries: [{ command: 'echo zsh', timestamp: 1700000000000 }],
    });
    zsh.session.close();

    const none = setup();
    await none.open();
    expect(await none.session.readHistory()).toEqual({ status: 'missing', entries: [] });
    none.session.close();

    const denied = setup({ files: { '.bash_history': 'denied' } });
    await denied.open();
    expect((await denied.session.readHistory()).status).toBe('denied');
    denied.session.close();
  });

  it('AC34 고정 스크립트로 서버 상태를 읽고, 두 번째부터 CPU%·네트워크 속도를 낸다', async () => {
    let tick = 0;
    const sample = () =>
      [
        '@@os',
        'PRETTY_NAME="Alpine Linux v3.20"',
        '@@cpu',
        tick === 0 ? 'cpu 100 0 0 900 0 0 0 0' : 'cpu 150 0 0 950 0 0 0 0',
        '@@net',
        tick === 0 ? ' eth0: 1000 0 0 0 0 0 0 0 500 0' : ' eth0: 4000 0 0 0 0 0 0 0 2000 0',
        '@@user',
        'alice',
      ].join('\n');
    const env = setup({ exec: () => sample() });
    await env.open();
    const first = await env.session.readStats();
    expect(first).toMatchObject({
      status: 'ok',
      stats: { os: 'Alpine Linux v3.20', user: 'alice', cpuPercent: null, net: null },
    });
    expect(env.transport.execCommands).toEqual([STATS_SCRIPT]);
    tick = 1;
    env.clock.advance(3000);
    const second = await env.session.readStats();
    expect(second).toMatchObject({
      status: 'ok',
      stats: { cpuPercent: 50, net: { rxPerSec: 1000, txPerSec: 500 } },
    });
    env.session.close();
  });

  it('AC34 상태 요청이 겹치면 exec는 한 번만 한다', async () => {
    const env = setup({ exec: () => '@@user\nalice' });
    await env.open();
    const [a, b] = await Promise.all([env.session.readStats(), env.session.readStats()]);
    expect(a).toEqual(b);
    expect(env.transport.execCommands).toHaveLength(1);
    env.session.close();
  });

  it('AC34 최소 간격(2초) 안의 요청은 직전 결과를 돌려준다(보안 리뷰 #6)', async () => {
    const env = setup({ exec: () => '@@user\nalice' });
    await env.open();
    await env.session.readStats();
    env.clock.advance(1000);
    await env.session.readStats();
    expect(env.transport.execCommands).toHaveLength(1);
    env.clock.advance(1500);
    await env.session.readStats();
    expect(env.transport.execCommands).toHaveLength(2);
    env.session.close();
  });

  it('AC34 표지가 없는 출력이나 실패가 3번 이어지면 그 세션은 수집을 멈춘다(보안 리뷰 #2)', async () => {
    const env = setup({ exec: () => 'Microsoft Windows [Version 10]' });
    await env.open();
    for (let i = 0; i < 5; i++) {
      expect(await env.session.readStats()).toEqual({ status: 'unavailable' });
      env.clock.advance(3000);
    }
    expect(env.transport.execCommands).toHaveLength(3);
    env.session.close();
  });

  it('AC34 exec가 실패하거나 연결 전이면 unavailable', async () => {
    const before = setup();
    expect(await before.session.readStats()).toEqual({ status: 'unavailable' });
    before.session.close();
    const failing = setup({ exec: () => null });
    await failing.open();
    expect(await failing.session.readStats()).toEqual({ status: 'unavailable' });
    failing.session.close();
  });

  it('F3.17a 연결 전이면 unavailable', async () => {
    const env = setup();
    expect(await env.session.readHistory()).toEqual({ status: 'unavailable', entries: [] });
    env.session.close();
  });

  it('AC15 인증 실패는 failed(auth-failed)', async () => {
    const { states, session } = setup();
    await session.open({
      host: 'h',
      port: 22,
      username: 'alice',
      keepaliveSec: 0,
      auth: [{ kind: 'password', password: 'wrong' }],
      size: { cols: 80, rows: 24 },
    });
    expect(states.at(-1)).toEqual(['failed', 'auth-failed']);
  });
});

describe('HostSession SFTP', () => {
  it('F4.1 연결된 세션은 SFTP 채널을 열고, 연결 전에는 실패한다', async () => {
    const env = setup();
    await expect(env.session.openSftp()).rejects.toMatchObject({ code: 'failure' });
    await env.open();
    const sftp = await env.session.openSftp();
    expect(await sftp.realpath('.')).toBe('/home/user');
    sftp.close();
    env.session.close();
  });
});
