import { maskSecretsInText } from '../security/maskForLog';

export interface HistoryEntry {
  command: string;
  /** epoch ms. 기록에 시각이 없으면 null. */
  timestamp: number | null;
}

const BASH_TIMESTAMP = /^#(\d+)$/;
const ZSH_EXTENDED = /^: (\d+):\d+;([\s\S]*)$/;
const ZSH_META = 0x83;

/** bash 기록 텍스트를 읽는다. HISTTIMEFORMAT(`#epoch` 줄)이 있으면 여러 줄 명령을 한 항목으로 묶는다. */
export function parseBashHistory(text: string): HistoryEntry[] {
  const lines = text.split(/\r?\n/);
  if (!lines.some((line) => BASH_TIMESTAMP.test(line))) {
    return lines.filter((line) => line !== '').map((command) => ({ command, timestamp: null }));
  }
  const entries: HistoryEntry[] = [];
  let timestamp: number | null = null;
  let body: string[] = [];
  const flush = (): void => {
    const command = body.join('\n').replace(/\n+$/, '');
    if (command !== '') entries.push({ command, timestamp });
    body = [];
  };
  for (const line of lines) {
    const match = BASH_TIMESTAMP.exec(line);
    if (match) {
      flush();
      timestamp = Number(match[1]) * 1000;
    } else {
      body.push(line);
    }
  }
  flush();
  return entries;
}

/** zsh 기록 바이트를 읽는다. metafy를 되돌리고 UTF-8, 실패하면 EUC-KR로 해석한다. */
export function parseZshHistory(bytes: Uint8Array): HistoryEntry[] {
  const entries: HistoryEntry[] = [];
  let pending: string | null = null;
  for (const line of decodeZsh(bytes).split(/\r?\n/)) {
    if (pending !== null) {
      pending += `\n${line}`;
    } else {
      pending = line;
    }
    if (pending.endsWith('\\')) {
      pending = pending.slice(0, -1);
      continue;
    }
    pushZshEntry(entries, pending);
    pending = null;
  }
  if (pending !== null) pushZshEntry(entries, pending);
  return entries;
}

function pushZshEntry(entries: HistoryEntry[], raw: string): void {
  const match = ZSH_EXTENDED.exec(raw);
  const command = match ? match[2]! : raw;
  if (command === '') return;
  entries.push({ command, timestamp: match ? Number(match[1]) * 1000 : null });
}

function unmetafy(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b === ZSH_META && i + 1 < bytes.length) out.push(bytes[++i]! ^ 32);
    else out.push(b);
  }
  return Uint8Array.from(out);
}

function decodeZsh(bytes: Uint8Array): string {
  return decodeText(unmetafy(bytes));
}

// \t \n \r 은 공백으로, 나머지 C0/C1 제어문자는 지운다.
const WHITESPACE_CONTROL = /[\t\n\r]/g;

function stripControl(text: string): string {
  return Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0)!;
      return code > 0x1f && (code < 0x7f || code > 0x9f);
    })
    .join('');
}

/** 저장·표시 전 정리: 공백 시작 제거(SEC-10), 제어문자 제거, 비밀 마스킹, 중복 제거, 최신 우선. */
export function normalizeHistory(entries: HistoryEntry[]): HistoryEntry[] {
  const seen = new Set<string>();
  const out: HistoryEntry[] = [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i]!;
    if (/^\s/.test(entry.command)) continue;
    const command = maskSecretsInText(
      stripControl(entry.command.replace(WHITESPACE_CONTROL, ' ')).trim(),
    );
    if (command === '' || seen.has(command)) continue;
    seen.add(command);
    out.push({ command, timestamp: entry.timestamp });
  }
  return out;
}

/** 대소문자 무시 부분일치를 먼저, 그다음 부분열 퍼지 일치를 돌려준다. */
export function searchHistory(entries: HistoryEntry[], query: string, limit = 50): HistoryEntry[] {
  const q = query.trim().toLowerCase();
  if (q === '') return entries.slice(0, limit);
  const substring: HistoryEntry[] = [];
  const fuzzy: HistoryEntry[] = [];
  for (const entry of entries) {
    const text = entry.command.toLowerCase();
    if (text.includes(q)) substring.push(entry);
    else if (isSubsequence(q, text)) fuzzy.push(entry);
  }
  return [...substring, ...fuzzy].slice(0, limit);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let next = 0;
  for (const ch of haystack) {
    if (ch === needle[next]) next++;
    if (next === needle.length) return true;
  }
  return false;
}

export const MAX_HISTORY_ENTRIES = 5000;
/** IPC 계약(HistoryResultSchema) 상한과 같다. 넘으면 메시지가 버려져 요청이 끝나지 않는다. */
export const MAX_HISTORY_COMMAND_LENGTH = 8192;

/**
 * SFTP로 읽은 기록 파일(끝부분)을 화면용 항목으로 만든다(F3.17a).
 * 잘린 파일은 첫 줄이 부분 줄이므로 버린다. 정리·마스킹·중복 제거 후 최신순, 상한 적용.
 */
export function historyFromFile(
  kind: 'bash' | 'zsh',
  bytes: Uint8Array,
  truncated: boolean,
): HistoryEntry[] {
  let data = bytes;
  if (truncated) {
    const newline = data.indexOf(0x0a);
    data = newline < 0 ? new Uint8Array() : data.slice(newline + 1);
  }
  const parsed = kind === 'zsh' ? parseZshHistory(data) : parseBashHistory(decodeText(data));
  return normalizeHistory(parsed)
    .slice(0, MAX_HISTORY_ENTRIES)
    .map((entry) =>
      entry.command.length > MAX_HISTORY_COMMAND_LENGTH
        ? { ...entry, command: entry.command.slice(0, MAX_HISTORY_COMMAND_LENGTH) }
        : entry,
    );
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('euc-kr').decode(bytes);
  }
}
