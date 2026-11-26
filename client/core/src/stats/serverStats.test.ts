import { describe, expect, it } from 'vitest';
import { STATS_SCRIPT, computeStats, parseStatsOutput } from './serverStats';

const LINUX = `@@uname
Linux
@@os
NAME="Ubuntu"
VERSION_ID="22.04"
PRETTY_NAME="Ubuntu 22.04.4 LTS"
@@cpu
cpu  100 0 50 800 50 0 0 0 0 0
@@mem
MemTotal:        4000000 kB
MemFree:          500000 kB
MemAvailable:    3000000 kB
Buffers:          100000 kB
@@net
Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo:  999999     10    0    0    0     0          0         0   999999     10    0    0    0     0       0          0
  eth0:   10000     20    0    0    0     0          0         0     4000     30    0    0    0     0       0          0
  eth1:    5000     20    0    0    0     0          0         0     1000     30    0    0    0     0       0          0
@@uptime
273600.52 1000.00
@@user
deploy
@@disk
Filesystem     1024-blocks     Used Available Capacity Mounted on
/dev/sda1         51475068 12868767  38606301      25% /
`;

describe('serverStats (F3.18)', () => {
  it('고정 스크립트는 sh로 실행하고 작은따옴표를 품지 않는다(ST1)', () => {
    expect(STATS_SCRIPT.startsWith("sh -c '")).toBe(true);
    expect(STATS_SCRIPT.slice(7, -1)).not.toContain("'");
    expect(STATS_SCRIPT).toContain('/proc/stat');
    expect(STATS_SCRIPT).toContain('df -kP /');
  });

  it('AC34 Linux 출력에서 OS·아이디·RAM·디스크·가동 시간을 읽는다', () => {
    const sample = parseStatsOutput(LINUX);
    expect(sample.os).toBe('Ubuntu 22.04.4 LTS');
    expect(sample.user).toBe('deploy');
    expect(sample.mem).toEqual({ totalBytes: 4000000 * 1024, availableBytes: 3000000 * 1024 });
    expect(sample.disk).toEqual({ totalBytes: 51475068 * 1024, usedBytes: 12868767 * 1024 });
    expect(sample.uptimeSec).toBe(273600);
    expect(sample.cpu).toEqual({ total: 1000, idle: 850 });
    // lo는 빼고 나머지 인터페이스를 더한다
    expect(sample.net).toEqual({ rxBytes: 15000, txBytes: 5000 });
  });

  it('AC34 두 표본의 차이로 CPU%와 네트워크 속도를 계산한다', () => {
    const first = parseStatsOutput(LINUX);
    const second = {
      ...first,
      cpu: { total: 1200, idle: 900 },
      net: { rxBytes: 15000 + 6000, txBytes: 5000 + 3000 },
    };
    expect(computeStats(null, first, 0)).toMatchObject({ cpuPercent: null, net: null });
    const stats = computeStats({ sample: first, at: 0 }, second, 3000);
    expect(stats).toEqual({
      os: 'Ubuntu 22.04.4 LTS',
      user: 'deploy',
      cpuPercent: 75,
      mem: { usedBytes: 1000000 * 1024, totalBytes: 4000000 * 1024 },
      net: { rxPerSec: 2000, txPerSec: 1000 },
      uptimeSec: 273600,
      disk: { usedBytes: 12868767 * 1024, totalBytes: 51475068 * 1024 },
    });
  });

  it('카운터가 줄면(재부팅·인터페이스 재시작) 속도는 모른다', () => {
    const first = parseStatsOutput(LINUX);
    const second = { ...first, net: { rxBytes: 10, txBytes: 10 } };
    expect(computeStats({ sample: first, at: 0 }, second, 3000).net).toBeNull();
  });

  it('MemAvailable이 없으면 Free+Buffers+Cached로, os-release가 없으면 uname으로', () => {
    const text = `@@uname\nFreeBSD\n@@mem\nMemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 50 kB\nCached: 150 kB\n@@user\nroot\n`;
    const sample = parseStatsOutput(text);
    expect(sample.os).toBe('FreeBSD');
    expect(sample.mem).toEqual({ totalBytes: 1000 * 1024, availableBytes: 300 * 1024 });
    expect(sample.cpu).toBeNull();
    expect(sample.net).toBeNull();
    expect(sample.disk).toBeNull();
    expect(sample.uptimeSec).toBeNull();
  });

  it('원격 문자열의 제어 문자는 지우고 길이를 제한한다(SEC-5)', () => {
    const text = `@@os\nPRETTY_NAME="Evil\u001b[31m${'x'.repeat(300)}"\n@@user\nro\u0007ot\n`;
    const sample = parseStatsOutput(text);
    expect(sample.os).not.toContain('\u001b');
    expect(sample.os!.length).toBeLessThanOrEqual(128);
    expect(sample.user).toBe('root');
  });

  it('bidi·폭 0 문자도 지우고, 자를 때 서로게이트 쌍을 깨지 않는다(SEC-5)', () => {
    const text = `@@os\nPRETTY_NAME="A\u202eB\u200bC\ufeff"\n@@user\n${'😀'.repeat(70)}\n`;
    const sample = parseStatsOutput(text);
    expect(sample.os).toBe('ABC');
    expect(Array.from(sample.user!)).toHaveLength(64);
    expect(sample.user).not.toMatch(/[\ud800-\udbff]$/);
  });

  it('범위를 벗어난 값(거대값·사용량 > 전체)은 그 항목만 null(보안 리뷰 #4)', () => {
    const huge = '9'.repeat(30);
    const text = `@@mem\nMemTotal: 1000 kB\nMemAvailable: 5000 kB\n@@uptime\n${huge}.0 1\n@@disk\nFilesystem 1024-blocks Used\n/dev/x ${huge} 10\n@@user\nroot\n`;
    const stats = computeStats(null, parseStatsOutput(text), 0);
    expect(stats.mem).toBeNull();
    expect(stats.uptimeSec).toBeNull();
    expect(stats.disk).toBeNull();
    expect(stats.user).toBe('root');
  });

  it('빈 출력이나 깨진 숫자는 모두 null', () => {
    expect(parseStatsOutput('')).toEqual({
      os: null,
      user: null,
      cpu: null,
      mem: null,
      net: null,
      uptimeSec: null,
      disk: null,
    });
    expect(parseStatsOutput('@@cpu\ncpu a b c\n@@uptime\nabc\n').cpu).toBeNull();
  });
});
