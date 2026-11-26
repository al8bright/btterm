import { describe, expect, it } from 'vitest';
import {
  historyFromFile,
  MAX_HISTORY_COMMAND_LENGTH,
  MAX_HISTORY_ENTRIES,
  normalizeHistory,
  parseBashHistory,
  parseZshHistory,
  searchHistory,
  type HistoryEntry,
} from './shellHistory';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const cmds = (entries: HistoryEntry[]): string[] => entries.map((e) => e.command);
const plain = (...commands: string[]): HistoryEntry[] =>
  commands.map((command) => ({ command, timestamp: null }));

describe('parseBashHistory', () => {
  it('평문 기록은 줄마다 한 항목이고 시각은 null', () => {
    expect(parseBashHistory('ls -la\ncd /tmp\n')).toEqual(plain('ls -la', 'cd /tmp'));
  });

  it('빈 줄과 CRLF를 처리한다', () => {
    expect(cmds(parseBashHistory('a\r\n\r\nb\r\n'))).toEqual(['a', 'b']);
  });

  it('HISTTIMEFORMAT: #epoch 줄이 다음 명령의 시각(ms)이다', () => {
    expect(parseBashHistory('#1700000000\nls\n#1700000060\npwd\n')).toEqual([
      { command: 'ls', timestamp: 1700000000000 },
      { command: 'pwd', timestamp: 1700000060000 },
    ]);
  });

  it('lithist 여러 줄 명령은 다음 #숫자 줄 전까지 한 항목이다', () => {
    const text = '#1700000000\nfor i in 1 2; do\n  echo $i\ndone\n#1700000010\nls\n';
    expect(parseBashHistory(text)).toEqual([
      { command: 'for i in 1 2; do\n  echo $i\ndone', timestamp: 1700000000000 },
      { command: 'ls', timestamp: 1700000010000 },
    ]);
  });

  it('타임스탬프가 없는 파일에서 #숫자 아닌 주석 줄은 명령으로 남는다', () => {
    expect(cmds(parseBashHistory('# note\nls\n'))).toEqual(['# note', 'ls']);
  });

  it('빈 입력은 항목 0개', () => {
    expect(parseBashHistory('')).toEqual([]);
  });
});

describe('parseZshHistory', () => {
  it('extended 형식 ": epoch:dur;cmd"를 읽는다', () => {
    const entries = parseZshHistory(enc(': 1700000000:0;ls -la\n: 1700000005:2;pwd\n'));
    expect(entries).toEqual([
      { command: 'ls -la', timestamp: 1700000000000 },
      { command: 'pwd', timestamp: 1700000005000 },
    ]);
  });

  it('extended가 아닌 평문 줄도 허용한다', () => {
    expect(parseZshHistory(enc('ls\n: 1700000000:0;pwd\n'))).toEqual([
      { command: 'ls', timestamp: null },
      { command: 'pwd', timestamp: 1700000000000 },
    ]);
  });

  it('줄 끝 백슬래시는 다음 줄로 이어지며 개행을 유지한다', () => {
    const entries = parseZshHistory(enc(': 1700000000:0;echo a\\\necho b\n: 1700000001:0;ls\n'));
    expect(entries).toEqual([
      { command: 'echo a\necho b', timestamp: 1700000000000 },
      { command: 'ls', timestamp: 1700000001000 },
    ]);
  });

  it('metafy된 한글을 되돌린다 (0x83 다음 바이트는 ^32)', () => {
    // '안녕' = EC 95 88 EB 85 95 → 0x95,0x88,0x85,0x95가 메타 범위
    const metafied = Uint8Array.from([
      ...enc(': 1700000000:0;echo '),
      0xec,
      0x83,
      0xb5,
      0x83,
      0xa8,
      0xeb,
      0x83,
      0xa5,
      0x83,
      0xb5,
      0x0a,
    ]);
    expect(parseZshHistory(metafied)).toEqual([{ command: 'echo 안녕', timestamp: 1700000000000 }]);
  });

  it('UTF-8이 아니면 EUC-KR로 다시 해석한다', () => {
    // '안녕' EUC-KR = BE C8 B3 E7
    const bytes = Uint8Array.from([...enc('echo '), 0xbe, 0xc8, 0xb3, 0xe7, 0x0a]);
    expect(cmds(parseZshHistory(bytes))).toEqual(['echo 안녕']);
  });

  it('빈 입력은 항목 0개', () => {
    expect(parseZshHistory(new Uint8Array())).toEqual([]);
  });
});

describe('normalizeHistory', () => {
  it('SEC-10 AC30b: 공백으로 시작하는 명령은 버린다 (trim 전 원문 기준)', () => {
    const out = normalizeHistory(plain(' secret-cmd', '\tother', 'visible'));
    expect(cmds(out)).toEqual(['visible']);
  });

  it('SEC-10 AC30b: 비밀 인자를 마스킹한다', () => {
    const out = normalizeHistory(plain('mysql -u root -psecret db'));
    expect(out[0]?.command).toBe('mysql -u root -p[masked] db');
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('제어문자를 제거하고 탭은 공백으로 바꾼다', () => {
    const out = normalizeHistory(plain('ls\t-la\u0007\u001b[31m\u0085'));
    expect(cmds(out)).toEqual(['ls -la[31m']);
  });

  it('여러 줄 명령의 개행은 공백으로 바꿔 실행 위험을 없앤다', () => {
    expect(cmds(normalizeHistory(plain('echo a\necho b')))).toEqual(['echo a echo b']);
  });

  it('앞뒤 공백을 trim하고 빈 명령을 버린다', () => {
    expect(cmds(normalizeHistory(plain('ls   ', '', '\u0007')))).toEqual(['ls']);
  });

  it('같은 명령은 가장 최근 것만 남기고 최신이 먼저 온다', () => {
    const out = normalizeHistory([
      { command: 'a', timestamp: 1 },
      { command: 'b', timestamp: 2 },
      { command: 'a', timestamp: 3 },
    ]);
    expect(out).toEqual([
      { command: 'a', timestamp: 3 },
      { command: 'b', timestamp: 2 },
    ]);
  });

  it('마스킹 후 같아지는 명령도 중복으로 합친다', () => {
    expect(cmds(normalizeHistory(plain('mysql -pone', 'mysql -ptwo')))).toEqual([
      'mysql -p[masked]',
    ]);
  });
});

describe('searchHistory', () => {
  const entries = plain('git status', 'docker ps', 'grep -i token', 'go test ./...');

  it('빈 query는 앞에서 limit개', () => {
    expect(cmds(searchHistory(entries, '', 2))).toEqual(['git status', 'docker ps']);
  });

  it('대소문자 무시 부분일치', () => {
    expect(cmds(searchHistory(entries, 'DOCKER'))).toEqual(['docker ps']);
  });

  it('부분일치가 퍼지(부분열) 일치보다 먼저 나온다', () => {
    const list = plain('g_i_t', 'git status');
    expect(cmds(searchHistory(list, 'git'))).toEqual(['git status', 'g_i_t']);
  });

  it('부분열 퍼지 일치', () => {
    expect(cmds(searchHistory(entries, 'gts'))).toEqual(['git status', 'go test ./...']);
  });

  it('일치가 없으면 빈 배열, limit을 지킨다', () => {
    expect(searchHistory(entries, 'zzz')).toEqual([]);
    expect(searchHistory(entries, 'g', 2)).toHaveLength(2);
  });
});

describe('historyFromFile', () => {
  it('파일 끝만 읽어 잘렸으면 첫 줄(부분 줄)을 버린다', () => {
    const bytes = new TextEncoder().encode('tail-of-old-command\nls\npwd\n');
    expect(historyFromFile('bash', bytes, true).map((e) => e.command)).toEqual(['pwd', 'ls']);
    expect(historyFromFile('bash', bytes, false).map((e) => e.command)).toEqual([
      'pwd',
      'ls',
      'tail-of-old-command',
    ]);
  });

  it('bash 기록이 UTF-8이 아니면 EUC-KR로 읽는다', () => {
    const eucKr = Uint8Array.from([0x65, 0x63, 0x68, 0x6f, 0x20, 0xc7, 0xd1, 0xb1, 0xdb, 0x0a]);
    expect(historyFromFile('bash', eucKr, false)[0]?.command).toBe('echo 한글');
  });

  it('항목 수에 상한을 둔다', () => {
    const text = Array.from({ length: 6000 }, (_, i) => `cmd-${i}`).join('\n');
    expect(historyFromFile('bash', new TextEncoder().encode(text), false)).toHaveLength(
      MAX_HISTORY_ENTRIES,
    );
  });
});

describe('historyFromFile 길이 상한(보안 리뷰 #4)', () => {
  it('아주 긴 명령은 계약 상한(8192자)으로 자른다', () => {
    const long = 'x'.repeat(10_000);
    const [entry] = historyFromFile('bash', new TextEncoder().encode(long), false);
    expect(entry?.command.length).toBe(MAX_HISTORY_COMMAND_LENGTH);
  });
});
