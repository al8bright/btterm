export interface QuickTarget {
  username: string;
  host: string;
  port: number;
}

const TARGET = /^([^\s@]+)@(\[[0-9A-Fa-f:.]+\]|[^\s@:[\]]+)(?::(\d+))?$/;

/**
 * 빠른 연결 입력(F1.3)을 해석한다. `user@host[:port]`, IPv6는 `[addr]:port`.
 * 습관대로 붙여 넣은 `ssh [-p N] user@host`도 받는다.
 */
export function parseQuickTarget(input: string): QuickTarget | null {
  let text = input.trim();
  let portOption: number | null = null;
  const ssh = /^ssh\s+(?:-p\s*(\d+)\s+)?(\S+)$/.exec(text);
  if (ssh) {
    portOption = ssh[1] !== undefined ? Number(ssh[1]) : null;
    text = ssh[2]!;
  }
  const match = TARGET.exec(text);
  if (!match) return null;
  const host = match[2]!.replace(/^\[|\]$/g, '');
  const port = match[3] !== undefined ? Number(match[3]) : (portOption ?? 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
  return { username: match[1]!, host, port };
}
