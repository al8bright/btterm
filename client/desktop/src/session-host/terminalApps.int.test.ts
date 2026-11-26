import { afterEach, describe, expect, it } from 'vitest';
import { Terminal } from '@xterm/headless';
import { HostSession, ResourceTracker, type FramePort, type SessionState } from '@btterm/core';
import { nodeClock } from '../shared/nodeClock';
import { Ssh2Transport } from './ssh/Ssh2Transport';

// 실제 데이터 경로: ssh2 → HostSession(병합·흐름 제어) → 포트 → xterm(headless) → ACK.
// 터미널 화면은 픽셀이 아니라 xterm 버퍼로 단언한다(AGENTS §6).

interface Harness {
  term: Terminal;
  send(data: string): void;
  /** renderer가 보내는 프레임(resize 등)을 그대로 보낸다 */
  frame(raw: unknown): void;
  session: HostSession;
  states: SessionState[];
  tracker: ResourceTracker;
}

let current: Harness | null = null;

afterEach(() => {
  if (!current) return;
  current.session.close();
  current.tracker.assertAllDisposed();
  current.term.dispose();
  current = null;
});

async function connect(): Promise<Harness> {
  const term = new Terminal({ cols: 80, rows: 24, allowProposedApi: true });
  let toHost: ((raw: unknown) => void) | undefined;
  const port: FramePort = {
    post: (frame) => {
      if (frame.t !== 'data') return;
      term.write(frame.data, () => toHost?.({ t: 'ack', bytes: frame.data.length }));
    },
    onFrame: (listener) => {
      toHost = listener;
      return { dispose: () => (toHost = undefined) };
    },
    close: () => undefined,
  };
  const tracker = new ResourceTracker();
  const states: SessionState[] = [];
  const session = new HostSession({
    transport: new Ssh2Transport(),
    clock: nodeClock,
    tracker,
    port,
    reportState: (state) => states.push(state),
    verifyHostKey: async () => true,
  });
  await session.open({
    host: '127.0.0.1',
    port: 2222,
    username: 'btterm',
    keepaliveSec: 0,
    auth: [{ kind: 'password', password: 'btterm-pw' }],
    size: { cols: 80, rows: 24 },
  });
  current = {
    term,
    send: (data) => toHost?.({ t: 'input', data }),
    frame: (raw) => toHost?.(raw),
    session,
    states,
    tracker,
  };
  await until(() => promptVisible(term), 'prompt');
  return current;
}

function screen(term: Terminal): string {
  const buffer = term.buffer.active;
  const lines: string[] = [];
  for (let i = buffer.viewportY; i < buffer.viewportY + term.rows; i++) {
    lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
  }
  return lines.join('\n');
}

function promptVisible(term: Terminal): boolean {
  return term.buffer.active.type === 'normal' && /[$#] *$/m.test(screen(term).trimEnd());
}

async function until(predicate: () => boolean, label: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`시간 초과: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe('터미널 호환 (실제 sshd)', () => {
  it('AC1 vim은 대체 화면으로 들어갔다가 :q! 후 원래 화면과 프롬프트로 돌아온다', async () => {
    const { term, send } = await connect();
    send('vim /tmp/ac1.txt\r');
    await until(() => term.buffer.active.type === 'alternate', 'vim 대체 화면');
    send('\x1b:q!\r');
    await until(() => promptVisible(term), 'vim 종료 후 프롬프트');
    expect(term.buffer.active.type).toBe('normal');
  });

  it('AC2 top 화면이 갱신되고 q로 프롬프트에 돌아온다', async () => {
    const { term, send } = await connect();
    send('top\r');
    await until(() => /load average|Load average|Tasks:/.test(screen(term)), 'top 화면');
    send('q');
    await until(() => promptVisible(term), 'top 종료 후 프롬프트');
  });

  it('AC3 실행 중인 명령을 Ctrl+C로 2초 안에 중단하고 세션은 유지된다', async () => {
    const { term, send, states } = await connect();
    send('sleep 100\r');
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    send('\x03');
    await until(() => /\^C/.test(screen(term)) && promptVisible(term), 'Ctrl+C 후 프롬프트', 2000);
    expect(Date.now() - started).toBeLessThan(2000);
    send('echo alive-$((1+1))\r');
    await until(() => screen(term).includes('alive-2'), '세션 유지');
    expect(states.at(-1)).toBe('ready');
  });

  it('AC4 80x24에서 120x40으로 리사이즈하면 원격 stty size가 40 120', async () => {
    const h = await connect();
    h.term.resize(120, 40);
    h.frame({ t: 'resize', cols: 120, rows: 40 });
    h.send('stty size\n');
    await until(() => /^40 120\s*$/m.test(screen(h.term)), 'stty size 40 120');
  });

  it('AC5 한글 출력이 깨지지 않고 셀 폭이 2로 계산된다', async () => {
    const { term, send } = await connect();
    send('echo 안녕하세요-$((1+1))\r');
    await until(() => screen(term).includes('안녕하세요-2'), '한글 출력');
    const buffer = term.buffer.active;
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      const text = line?.translateToString(true) ?? '';
      if (!text.startsWith('안녕하세요-2')) continue;
      expect(line?.getCell(0)?.getChars()).toBe('안');
      expect(line?.getCell(0)?.getWidth()).toBe(2);
      expect(line?.getCell(2)?.getChars()).toBe('녕');
      return;
    }
    throw new Error('한글 출력 줄을 찾지 못했습니다');
  });
});

describe('서버 상태 줄 (실제 sshd)', () => {
  it('AC34 고정 스크립트로 OS·아이디·RAM·디스크·가동을 읽고, 두 번째에 CPU%·네트워크 속도를 낸다', async () => {
    const { session } = await connect();
    const first = await session.readStats();
    if (first.status !== 'ok') throw new Error('상태를 읽지 못했습니다');
    expect(first.stats.os).toMatch(/\w/);
    expect(first.stats.user).toBe('btterm');
    expect(first.stats.mem?.totalBytes).toBeGreaterThan(0);
    expect(first.stats.disk?.totalBytes).toBeGreaterThan(0);
    expect(first.stats.uptimeSec).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 2100));
    const second = await session.readStats();
    if (second.status !== 'ok') throw new Error('상태를 읽지 못했습니다');
    expect(second.stats.cpuPercent).not.toBeNull();
    expect(second.stats.net).not.toBeNull();
  });
});
