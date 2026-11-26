export interface SshConfigFile {
  path: string;
  text: string;
}

export interface SshConfigHost {
  alias: string;
  hostName: string;
  port: number | null;
  user: string | null;
  identityFiles: string[];
  keepaliveSec: number | null;
  proxyJump: string | null;
  /** 지원하지 않는 지시어 원문(소문자 키). */
  unsupported: Record<string, string>;
  /** 사용자 승인 전까지 비활성이어야 하는 실행 항목(SEC-12). */
  needsApproval: string[];
}

export type ResolveInclude = (pattern: string, fromPath: string) => SshConfigFile[];

interface Directive {
  key: string;
  args: string[];
  raw: string;
}

interface Block {
  /** null이면 Match 블록(지원하지 않아 지시어를 무시한다). */
  patterns: string[] | null;
  directives: Directive[];
}

const MAX_INCLUDE_DEPTH = 16;
const EXECUTABLE_KEYS = ['proxycommand', 'localcommand'];
const KNOWN_KEYS = new Set([
  'hostname',
  'port',
  'user',
  'identityfile',
  'serveraliveinterval',
  'proxyjump',
]);

/** OpenSSH config 텍스트들을 Host(구체 alias)별 설정으로 읽는다. 첫 값이 이긴다. */
export function parseSshConfig(
  files: SshConfigFile[],
  resolveInclude: ResolveInclude,
): SshConfigHost[] {
  const blocks: Block[] = [{ patterns: ['*'], directives: [] }];
  for (const file of files) collect(file, resolveInclude, [], blocks);
  return collectAliases(blocks).map((alias) => resolveHost(alias, blocks));
}

function collect(
  file: SshConfigFile,
  resolveInclude: ResolveInclude,
  stack: string[],
  blocks: Block[],
): void {
  if (stack.includes(file.path) || stack.length > MAX_INCLUDE_DEPTH) return;
  const nextStack = [...stack, file.path];
  for (const line of file.text.split(/\r?\n/)) {
    const directive = parseLine(line);
    if (!directive) continue;
    if (directive.key === 'include') {
      for (const pattern of directive.args) {
        for (const included of resolveInclude(pattern, file.path)) {
          collect(included, resolveInclude, nextStack, blocks);
        }
      }
    } else if (directive.key === 'host') {
      blocks.push({ patterns: directive.args, directives: [] });
    } else if (directive.key === 'match') {
      blocks.push({ patterns: null, directives: [] });
    } else {
      blocks[blocks.length - 1]!.directives.push(directive);
    }
  }
}

function parseLine(line: string): Directive | null {
  const text = line.trim();
  if (text === '' || text.startsWith('#')) return null;
  const m = /^([^\s=]+)(?:\s*=\s*|\s+)?(.*)$/.exec(text);
  if (!m) return null;
  const raw = m[2]!.trim();
  return { key: m[1]!.toLowerCase(), args: splitArgs(raw), raw };
}

/** 공백으로 인자를 나누고 따옴표를 벗긴다. 따옴표 밖의 토큰 시작 `#`부터는 주석. */
function splitArgs(text: string): string[] {
  const args: string[] = [];
  let current: string | null = null;
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') {
      quoted = !quoted;
      current ??= '';
    } else if (!quoted && /\s/.test(ch)) {
      if (current !== null) args.push(current);
      current = null;
    } else if (!quoted && ch === '#' && current === null) {
      break;
    } else {
      current = (current ?? '') + ch;
    }
  }
  if (current !== null) args.push(current);
  return args;
}

function isConcrete(pattern: string): boolean {
  return !/[*?!]/.test(pattern);
}

function collectAliases(blocks: Block[]): string[] {
  const aliases = new Set<string>();
  for (const block of blocks) {
    for (const pattern of block.patterns ?? []) {
      if (isConcrete(pattern)) aliases.add(pattern);
    }
  }
  return [...aliases];
}

function globMatch(pattern: string, name: string): boolean {
  const source = pattern
    .split('')
    .map((ch) => (ch === '*' ? '.*' : ch === '?' ? '.' : ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')))
    .join('');
  return new RegExp(`^${source}$`).test(name);
}

function blockApplies(patterns: string[] | null, alias: string): boolean {
  if (!patterns) return false;
  let matched = false;
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) {
      if (globMatch(pattern.slice(1), alias)) return false;
    } else if (globMatch(pattern, alias)) {
      matched = true;
    }
  }
  return matched;
}

function resolveHost(alias: string, blocks: Block[]): SshConfigHost {
  const scalars = new Map<string, string>();
  const identityFiles: string[] = [];
  const unsupported: Record<string, string> = {};
  for (const block of blocks) {
    if (!blockApplies(block.patterns, alias)) continue;
    for (const { key, args, raw } of block.directives) {
      if (key === 'identityfile') {
        const file = args[0];
        if (file && !identityFiles.includes(file)) identityFiles.push(file);
      } else if (KNOWN_KEYS.has(key)) {
        if (!scalars.has(key)) scalars.set(key, args[0] ?? '');
      } else if (!(key in unsupported)) {
        unsupported[key] = raw;
      }
    }
  }
  return {
    alias,
    hostName: scalars.get('hostname') || alias,
    port: toPort(scalars.get('port')),
    user: scalars.get('user') || null,
    identityFiles,
    keepaliveSec: toSeconds(scalars.get('serveraliveinterval')),
    proxyJump: scalars.get('proxyjump') || null,
    unsupported,
    needsApproval: EXECUTABLE_KEYS.filter(
      (key) => key in unsupported && unsupported[key]!.toLowerCase() !== 'none',
    ),
  };
}

function toSeconds(value: string | undefined): number | null {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : null;
}

function toPort(value: string | undefined): number | null {
  const port = toSeconds(value);
  return port !== null && port >= 1 && port <= 65535 ? port : null;
}
