import type { FixedCommand } from '../ssh/SshTransport';

/**
 * 서버 상태 줄(F3.18). 같은 SSH 연결의 exec 채널로 고정 스크립트를 돌려 얻은 출력을 해석한다.
 * 원격 출력은 신뢰하지 않는다(SEC-5): 숫자만 받아들이고 문자열은 제어 문자를 지우고 길이를 제한한다.
 */

/** 표본 하나(누적 카운터 그대로). */
export interface StatsSample {
  os: string | null;
  user: string | null;
  /** /proc/stat 첫 줄의 누적 jiffies */
  cpu: { total: number; idle: number } | null;
  mem: { totalBytes: number; availableBytes: number } | null;
  /** lo를 뺀 인터페이스 누적 바이트 합 */
  net: { rxBytes: number; txBytes: number } | null;
  uptimeSec: number | null;
  /** 루트(/) 파일 시스템 */
  disk: { totalBytes: number; usedBytes: number } | null;
}

/** 화면에 보이는 값. CPU%·네트워크 속도는 이전 표본이 있어야 나온다. */
export interface ServerStats {
  os: string | null;
  user: string | null;
  cpuPercent: number | null;
  mem: { usedBytes: number; totalBytes: number } | null;
  net: { rxPerSec: number; txPerSec: number } | null;
  uptimeSec: number | null;
  disk: { usedBytes: number; totalBytes: number } | null;
}

const SECTIONS = [
  ['uname', 'uname -s'],
  ['os', 'cat /etc/os-release'],
  ['cpu', 'head -n 1 /proc/stat'],
  ['mem', 'cat /proc/meminfo'],
  ['net', 'cat /proc/net/dev'],
  ['uptime', 'cat /proc/uptime'],
  ['user', 'id -un'],
  ['disk', 'df -kP /'],
] as const;

type Section = (typeof SECTIONS)[number][0];

/**
 * 고정된 읽기 전용 스크립트(ST1). 로그인 셸 종류와 상관없게 sh로 감싸고, 안에는 작은따옴표를 쓰지 않는다.
 * 사용자·원격 입력을 이어 붙이지 않는다.
 */
export const STATS_SCRIPT = `sh -c '${[
  'export LC_ALL=C',
  ...SECTIONS.map(([name, command]) => `echo @@${name}; ${command} 2>/dev/null`),
].join('; ')}'` as FixedCommand;

/** exec 출력 상한(ST5) */
export const STATS_MAX_BYTES = 64 * 1024;

const OS_MAX = 128;
const USER_MAX = 64;

/** 제어 문자·bidi·폭 0 문자를 지우고 코드 포인트 단위로 자른다(SEC-5). */
function sanitize(value: string, max: number): string | null {
  const clean = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]/gu, '')
    .trim();
  return clean === '' ? null : Array.from(clean).slice(0, max).join('');
}

/** 안전한 정수 범위 안의 0 이상 수만 받는다. */
function safe(n: number): number | null {
  return Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER ? n : null;
}

function toNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\d+(\.\d+)?$/.test(value)) return null;
  return safe(Number(value));
}

/** kB 값을 바이트로. 넘치면 null. */
function kbToBytes(kb: number | null): number | null {
  return kb === null ? null : safe(kb * 1024);
}

function splitSections(text: string): Map<Section, string[]> {
  const sections = new Map<Section, string[]>();
  let current: string[] | null = null;
  for (const line of text.split(/\r?\n/)) {
    const marker = /^@@(\w+)$/.exec(line.trim());
    const name = marker?.[1];
    if (name && SECTIONS.some(([known]) => known === name)) {
      current = [];
      sections.set(name as Section, current);
    } else {
      current?.push(line);
    }
  }
  return sections;
}

function parseOs(lines: string[] | undefined, uname: string[] | undefined): string | null {
  const fields = new Map<string, string>();
  for (const line of lines ?? []) {
    const match = /^([A-Z_]+)=(.*)$/.exec(line.trim());
    if (match) fields.set(match[1]!, match[2]!.replace(/^"(.*)"$/, '$1'));
  }
  const pretty = fields.get('PRETTY_NAME');
  const named = [fields.get('NAME'), fields.get('VERSION_ID')].filter(Boolean).join(' ');
  return sanitize(pretty || named || uname?.[0] || '', OS_MAX);
}

function parseCpu(lines: string[] | undefined): StatsSample['cpu'] {
  const fields = lines?.[0]?.trim().split(/\s+/);
  if (fields?.[0] !== 'cpu') return null;
  // user nice system idle iowait irq softirq steal (guest는 user에 이미 포함)
  const values = fields.slice(1, 9).map((v) => toNumber(v));
  if (values.length < 4 || values.some((v) => v === null)) return null;
  const numbers = values as number[];
  const total = numbers.reduce((a, b) => a + b, 0);
  return { total, idle: numbers[3]! + (numbers[4] ?? 0) };
}

function parseMem(lines: string[] | undefined): StatsSample['mem'] {
  const kb = new Map<string, number>();
  for (const line of lines ?? []) {
    const match = /^(\w+):\s+(\d+)\s*kB$/.exec(line.trim());
    if (match) kb.set(match[1]!, Number(match[2]));
  }
  const totalBytes = kbToBytes(kb.get('MemTotal') ?? null);
  const availableBytes = kbToBytes(
    kb.get('MemAvailable') ??
      (kb.get('MemFree') ?? 0) + (kb.get('Buffers') ?? 0) + (kb.get('Cached') ?? 0),
  );
  if (totalBytes === null || availableBytes === null || availableBytes > totalBytes) return null;
  return { totalBytes, availableBytes };
}

function parseNet(lines: string[] | undefined): StatsSample['net'] {
  let rxBytes = 0;
  let txBytes = 0;
  let found = false;
  for (const line of lines ?? []) {
    const match = /^\s*([^:\s]+):\s*(.*)$/.exec(line);
    if (!match || match[1] === 'lo') continue;
    const fields = match[2]!.trim().split(/\s+/);
    const rx = toNumber(fields[0]);
    const tx = toNumber(fields[8]);
    if (rx === null || tx === null) continue;
    rxBytes += rx;
    txBytes += tx;
    found = true;
  }
  return found && safe(rxBytes) !== null && safe(txBytes) !== null ? { rxBytes, txBytes } : null;
}

function parseDisk(lines: string[] | undefined): StatsSample['disk'] {
  // 머리글 다음 줄: Filesystem 1024-blocks Used Available Capacity Mounted-on
  const fields = lines?.[1]?.trim().split(/\s+/);
  const totalBytes = kbToBytes(toNumber(fields?.[1]));
  const usedBytes = kbToBytes(toNumber(fields?.[2]));
  if (totalBytes === null || usedBytes === null || usedBytes > totalBytes) return null;
  return { totalBytes, usedBytes };
}

/** 어느 항목도 읽지 못했는지(표지가 없는 출력: 비 POSIX 셸·강제 명령 등) */
export function isEmptySample(sample: StatsSample): boolean {
  return Object.values(sample).every((value) => value === null);
}

/** 고정 스크립트 출력을 표본으로 해석한다. 모르는 항목은 null. */
export function parseStatsOutput(text: string): StatsSample {
  const sections = splitSections(text);
  const uptime = toNumber(sections.get('uptime')?.[0]?.trim().split(/\s+/)[0]);
  return {
    os: parseOs(sections.get('os'), sections.get('uname')),
    user: sanitize(sections.get('user')?.[0] ?? '', USER_MAX),
    cpu: parseCpu(sections.get('cpu')),
    mem: parseMem(sections.get('mem')),
    net: parseNet(sections.get('net')),
    uptimeSec: uptime === null ? null : Math.floor(uptime),
    disk: parseDisk(sections.get('disk')),
  };
}

/** 이번 표본과 이전 표본(at = ms)으로 화면 값을 만든다. */
export function computeStats(
  previous: { sample: StatsSample; at: number } | null,
  current: StatsSample,
  at: number,
): ServerStats {
  const seconds = previous ? (at - previous.at) / 1000 : 0;
  let cpuPercent: number | null = null;
  const prevCpu = previous?.sample.cpu;
  if (prevCpu && current.cpu) {
    const total = current.cpu.total - prevCpu.total;
    const idle = current.cpu.idle - prevCpu.idle;
    if (total > 0 && idle >= 0) {
      cpuPercent = Math.min(100, Math.max(0, Math.round((1 - idle / total) * 100)));
    }
  }
  let net: ServerStats['net'] = null;
  const prevNet = previous?.sample.net;
  if (prevNet && current.net && seconds > 0) {
    const rx = current.net.rxBytes - prevNet.rxBytes;
    const tx = current.net.txBytes - prevNet.txBytes;
    if (rx >= 0 && tx >= 0) {
      net = { rxPerSec: Math.round(rx / seconds), txPerSec: Math.round(tx / seconds) };
    }
  }
  return {
    os: current.os,
    user: current.user,
    cpuPercent,
    mem: current.mem
      ? {
          usedBytes: current.mem.totalBytes - current.mem.availableBytes,
          totalBytes: current.mem.totalBytes,
        }
      : null,
    net,
    uptimeSec: current.uptimeSec,
    disk: current.disk,
  };
}
