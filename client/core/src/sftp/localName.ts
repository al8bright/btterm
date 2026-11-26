export type LocalPlatform = 'windows' | 'posix';

export type LocalNameResult =
  | { ok: true; name: string; changed: boolean }
  | { ok: false; reason: 'empty' | 'dot' | 'separator' | 'control' };

const MAX_LENGTH = 255;
const WINDOWS_FORBIDDEN = /[<>:"|?*]/g;
// 위 첨자 숫자(¹²³)도 Windows가 장치 이름으로 취급한다. CONIN$/CONOUT$는 콘솔 장치.
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)$/i;
const WINDOWS_EXECUTABLE = new Set([
  'exe',
  'bat',
  'cmd',
  'com',
  'ps1',
  'vbs',
  'js',
  'jse',
  'wsf',
  'msi',
  'lnk',
  'scr',
  'hta',
  'reg',
  'cpl',
  'jar',
  'msc',
  'chm',
  'pif',
  'vbe',
  'psm1',
  'url',
  'appref-ms',
  'application',
  'settingcontent-ms',
]);
// macOS(posix)에서 열면 실행·설치되거나 다른 대상을 여는 형식(보안 리뷰 TR3 M2)
const POSIX_EXECUTABLE = new Set([
  'app',
  'command',
  'tool',
  'terminal',
  'pkg',
  'mpkg',
  'dmg',
  'webloc',
  'fileloc',
  'inetloc',
  'jar',
  'workflow',
  'action',
  'mobileconfig',
  'prefpane',
  // TextEdit(open -e)가 서식 문서로 렌더링하고 저장 때 다시 만들어 원격 파일을 바꾼다(보안 리뷰 L1)
  'html',
  'htm',
  'xhtml',
  'rtf',
  'webarchive',
  'doc',
  'docx',
  'odt',
]);
// 기본 앱으로 열어도 실행되지 않는 텍스트 형식(F4.8 로컬 편집). 스크립트·HTML·문서는 넣지 않는다
const PLAIN_TEXT = new Set([
  'txt',
  'log',
  'md',
  'markdown',
  'conf',
  'cnf',
  'cfg',
  'ini',
  'json',
  'jsonc',
  'yaml',
  'yml',
  'toml',
  'xml',
  'csv',
  'tsv',
  'properties',
  'sql',
  'diff',
  'patch',
]);
const encoder = new TextEncoder();

/** 플랫폼별 이름 길이: windows 는 UTF-16 길이, posix 는 UTF-8 바이트 수. */
function measure(value: string, platform: LocalPlatform): number {
  return platform === 'windows' ? value.length : encoder.encode(value).length;
}

function splitExtension(name: string): [string, string] {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
}

/** stem 을 코드포인트 단위로 줄여 stem + tail 이 제한 안에 들어오게 한다. */
function fitStem(stem: string, tail: string, platform: LocalPlatform): string {
  const points = Array.from(stem);
  while (points.length > 0 && measure(points.join('') + tail, platform) > MAX_LENGTH) {
    points.pop();
  }
  return points.join('');
}

function truncateName(name: string, platform: LocalPlatform): string {
  if (measure(name, platform) <= MAX_LENGTH) return name;
  const [stem, ext] = splitExtension(name);
  const keepExt = measure(ext, platform) < MAX_LENGTH;
  const fitted = fitStem(keepExt ? stem : name, keepExt ? ext : '', platform);
  return platform === 'windows'
    ? trimWindowsTail(fitted + (keepExt ? ext : ''))
    : fitted + (keepExt ? ext : '');
}

function trimWindowsTail(name: string): string {
  return name.replace(/[ .]+$/, '');
}

function hasControl(name: string): boolean {
  for (let i = 0; i < name.length; i += 1) {
    if (name.charCodeAt(i) < 0x20) return true;
  }
  return false;
}

/** 원격 파일명(항목 이름 하나)을 로컬 대상 폴더 안에 만들 수 있는 이름으로 정규화한다. (SEC-11) */
export function toLocalFileName(remoteName: string, platform: LocalPlatform): LocalNameResult {
  if (remoteName === '') return { ok: false, reason: 'empty' };
  if (hasControl(remoteName)) return { ok: false, reason: 'control' };
  const separators = platform === 'windows' ? /[/\\]/ : /\//;
  if (separators.test(remoteName)) return { ok: false, reason: 'separator' };
  if (remoteName === '.' || remoteName === '..') return { ok: false, reason: 'dot' };

  let name = remoteName;
  if (platform === 'windows') {
    name = trimWindowsTail(name.replace(WINDOWS_FORBIDDEN, '_'));
    if (name === '') return { ok: false, reason: 'empty' };
    if (WINDOWS_RESERVED.test(name.split('.')[0]?.trimEnd() ?? '')) name = `_${name}`;
  }
  name = truncateName(name, platform);
  if (name === '') return { ok: false, reason: 'empty' };
  return { ok: true, name, changed: name !== remoteName };
}

/** 이미 있는 이름과 충돌하면 'name (1).ext', 'name (2).ext' … 로 고유한 이름을 만든다. */
export function uniqueName(
  name: string,
  existing: ReadonlySet<string>,
  platform: LocalPlatform,
): string {
  const key = (value: string): string => (platform === 'windows' ? value.toLowerCase() : value);
  const taken = new Set(Array.from(existing, key));
  if (!taken.has(key(name))) return name;
  const [stem, ext] = splitExtension(name);
  for (let n = 1; ; n += 1) {
    const tail = ` (${n})${ext}`;
    const candidate = fitStem(stem, tail, platform) + tail;
    if (!taken.has(key(candidate))) return candidate;
  }
}

/** OS 기본 앱으로 열어도 되는 텍스트 형식인지(허용 목록). 아니면 텍스트 편집기로 연다(보안 리뷰 H1) */
export function isPlainTextName(name: string, platform: LocalPlatform): boolean {
  // posix(APFS)는 끝 공백·점을 보존하므로 다듬으면 OS가 보는 확장자와 달라진다(보안 리뷰 L3)
  const [, ext] = splitExtension(platform === 'windows' ? trimWindowsTail(name) : name);
  return PLAIN_TEXT.has(ext.slice(1).toLowerCase());
}

/** 열기 전에 경고해야 하는 실행 가능 확장자인지 판단한다(macOS는 TextEdit가 렌더링하는 서식 문서 포함). (SEC-11) */
export function isExecutableName(name: string, platform: LocalPlatform): boolean {
  const trimmed = platform === 'windows' ? trimWindowsTail(name) : name;
  const dot = trimmed.lastIndexOf('.');
  if (dot < 0) return false;
  const ext = trimmed.slice(dot + 1).toLowerCase();
  return (platform === 'windows' ? WINDOWS_EXECUTABLE : POSIX_EXECUTABLE).has(ext);
}
