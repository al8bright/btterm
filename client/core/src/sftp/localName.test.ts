import { describe, expect, it } from 'vitest';
import { isExecutableName, isPlainTextName, toLocalFileName, uniqueName } from './localName';

const okName = (name: string, platform: 'windows' | 'posix'): string | null => {
  const r = toLocalFileName(name, platform);
  return r.ok ? r.name : null;
};

describe('toLocalFileName - 공통', () => {
  it('AC7 한글 파일명은 그대로 보존한다', () => {
    expect(toLocalFileName('보고서_최종.txt', 'windows')).toEqual({
      ok: true,
      name: '보고서_최종.txt',
      changed: false,
    });
    expect(toLocalFileName('보고서_최종.txt', 'posix')).toEqual({
      ok: true,
      name: '보고서_최종.txt',
      changed: false,
    });
  });

  it('빈 문자열은 empty 로 거부한다', () => {
    expect(toLocalFileName('', 'posix')).toEqual({ ok: false, reason: 'empty' });
  });

  it('SEC-11 "." 과 ".." 는 dot 으로 거부한다', () => {
    expect(toLocalFileName('.', 'posix')).toEqual({ ok: false, reason: 'dot' });
    expect(toLocalFileName('..', 'windows')).toEqual({ ok: false, reason: 'dot' });
  });

  it('SEC-11 "/" 포함 이름은 양 플랫폼에서 separator 로 거부한다', () => {
    expect(toLocalFileName('../etc/passwd', 'posix')).toEqual({ ok: false, reason: 'separator' });
    expect(toLocalFileName('../etc/passwd', 'windows')).toEqual({
      ok: false,
      reason: 'separator',
    });
  });

  it('SEC-11 역슬래시는 windows 에서만 separator 로 거부한다', () => {
    expect(toLocalFileName('..\\x', 'windows')).toEqual({ ok: false, reason: 'separator' });
    expect(okName('..\\x', 'posix')).toBe('..\\x');
  });

  it('SEC-11 NUL 과 C0 제어문자는 control 로 거부한다', () => {
    expect(toLocalFileName('a\0b', 'posix')).toEqual({ ok: false, reason: 'control' });
    expect(toLocalFileName('a\nb', 'windows')).toEqual({ ok: false, reason: 'control' });
    expect(toLocalFileName('a\x1fb', 'posix')).toEqual({ ok: false, reason: 'control' });
  });
});

describe('toLocalFileName - windows', () => {
  it('SEC-11 ADS "a:b" 의 콜론은 "_" 로 치환한다', () => {
    expect(toLocalFileName('a:b', 'windows')).toEqual({ ok: true, name: 'a_b', changed: true });
  });

  it('금지 문자 < > : " | ? * 를 "_" 로 치환한다', () => {
    expect(okName('name?.txt', 'windows')).toBe('name_.txt');
    expect(okName('<a>:"b"|c*', 'windows')).toBe('_a___b__c_');
  });

  it('끝의 공백과 마침표를 제거한다', () => {
    expect(toLocalFileName('file. ', 'windows')).toEqual({
      ok: true,
      name: 'file',
      changed: true,
    });
    expect(okName('file...', 'windows')).toBe('file');
  });

  it('끝 정리 후 비면 empty, 점만 남으면 dot 으로 거부한다', () => {
    expect(toLocalFileName('   ', 'windows')).toEqual({ ok: false, reason: 'empty' });
    expect(toLocalFileName('. .', 'windows')).toEqual({ ok: false, reason: 'empty' });
  });

  it('SEC-11 예약어는 확장자·대소문자와 무관하게 앞에 "_" 를 붙인다', () => {
    expect(okName('CON', 'windows')).toBe('_CON');
    expect(okName('con.txt', 'windows')).toBe('_con.txt');
    expect(okName('LPT9.log', 'windows')).toBe('_LPT9.log');
    expect(okName('Com1', 'windows')).toBe('_Com1');
    expect(okName('nul.tar.gz', 'windows')).toBe('_nul.tar.gz');
  });

  it('예약어와 비슷하지만 아닌 이름은 유지한다', () => {
    expect(okName('console.txt', 'windows')).toBe('console.txt');
    expect(okName('COM0', 'windows')).toBe('COM0');
    expect(okName('LPT10', 'windows')).toBe('LPT10');
  });

  it('posix 에서는 예약어와 금지 문자를 그대로 둔다', () => {
    expect(okName('CON', 'posix')).toBe('CON');
    expect(okName('a:b?.txt', 'posix')).toBe('a:b?.txt');
    expect(okName('file. ', 'posix')).toBe('file. ');
  });

  it('255 UTF-16 길이 초과 시 확장자를 보존하며 자른다', () => {
    const name = `${'a'.repeat(300)}.txt`;
    const result = okName(name, 'windows');
    expect(result).toBe(`${'a'.repeat(251)}.txt`);
    expect(result?.length).toBe(255);
  });

  it('서로게이트 쌍을 가운데서 자르지 않는다', () => {
    const name = `${'😀'.repeat(200)}.txt`;
    const result = okName(name, 'windows');
    expect(result?.length).toBeLessThanOrEqual(255);
    expect(result?.endsWith('.txt')).toBe(true);
    expect(result).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
  });
});

describe('toLocalFileName - posix', () => {
  it('255바이트(UTF-8) 초과 시 확장자를 보존하며 자른다', () => {
    const name = `${'가'.repeat(100)}.txt`;
    const result = okName(name, 'posix');
    expect(new TextEncoder().encode(result ?? '').length).toBeLessThanOrEqual(255);
    expect(result?.endsWith('.txt')).toBe(true);
    expect(result).toBe(`${'가'.repeat(83)}.txt`);
  });

  it('255바이트 이하는 changed=false', () => {
    expect(toLocalFileName('a'.repeat(255), 'posix')).toMatchObject({ ok: true, changed: false });
  });
});

describe('uniqueName', () => {
  it('충돌이 없으면 그대로 반환한다', () => {
    expect(uniqueName('a.txt', new Set(['b.txt']), 'posix')).toBe('a.txt');
  });

  it('충돌하면 "name (1).ext", "name (2).ext" 순서로 만든다', () => {
    expect(uniqueName('a.txt', new Set(['a.txt']), 'posix')).toBe('a (1).txt');
    expect(uniqueName('a.txt', new Set(['a.txt', 'a (1).txt']), 'posix')).toBe('a (2).txt');
  });

  it('확장자가 없는 이름과 점으로 시작하는 이름도 처리한다', () => {
    expect(uniqueName('README', new Set(['README']), 'posix')).toBe('README (1)');
    expect(uniqueName('.bashrc', new Set(['.bashrc']), 'posix')).toBe('.bashrc (1)');
  });

  it('windows 는 대소문자를 무시하고 posix 는 구분한다', () => {
    expect(uniqueName('A.TXT', new Set(['a.txt']), 'windows')).toBe('A (1).TXT');
    expect(uniqueName('A.TXT', new Set(['a.txt']), 'posix')).toBe('A.TXT');
  });

  it('접미사가 붙어도 길이 제한을 넘지 않는다', () => {
    const long = `${'a'.repeat(251)}.txt`;
    const result = uniqueName(long, new Set([long]), 'windows');
    expect(result.length).toBeLessThanOrEqual(255);
    expect(result.endsWith(' (1).txt')).toBe(true);
  });
});

describe('isExecutableName', () => {
  it('windows 실행 확장자는 대소문자와 무관하게 true', () => {
    for (const ext of [
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
    ]) {
      expect(isExecutableName(`x.${ext}`, 'windows')).toBe(true);
      expect(isExecutableName(`x.${ext.toUpperCase()}`, 'windows')).toBe(true);
    }
  });

  it('일반 문서와 확장자 없는 이름은 false', () => {
    expect(isExecutableName('보고서_최종.txt', 'windows')).toBe(false);
    expect(isExecutableName('exe', 'windows')).toBe(false);
    expect(isExecutableName('a.exe.txt', 'windows')).toBe(false);
  });

  it('posix 는 Windows 목록으로 판단하지 않는다', () => {
    expect(isExecutableName('setup.exe', 'posix')).toBe(false);
  });

  it.each([
    'Installer.app',
    'run.command',
    'run.tool',
    'shell.terminal',
    'setup.pkg',
    'setup.mpkg',
    'image.dmg',
    'link.webloc',
    'link.fileloc',
    'link.inetloc',
    'tool.jar',
    'flow.workflow',
    'step.action',
    'profile.mobileconfig',
    'pane.prefPane',
    'RUN.COMMAND',
  ])('macOS(posix) %s는 실행 파일로 경고한다(보안 리뷰 TR3 M2)', (name) => {
    expect(isExecutableName(name, 'posix')).toBe(true);
  });

  it.each([
    'index.html',
    'page.HTM',
    'a.xhtml',
    'memo.rtf',
    'saved.webarchive',
    'a.doc',
    'a.docx',
    'a.odt',
  ])('macOS(posix) %s는 TextEdit가 서식 문서로 렌더링하므로 막는다(보안 리뷰 L1)', (name) => {
    expect(isExecutableName(name, 'posix')).toBe(true);
  });

  it('macOS(posix) 일반 문서·스크립트 텍스트는 false', () => {
    expect(isExecutableName('notes.txt', 'posix')).toBe(false);
    expect(isExecutableName('deploy.sh', 'posix')).toBe(false);
    expect(isExecutableName('app', 'posix')).toBe(false);
  });
});

describe('SEC-11 목록 보강(보안 리뷰 #10)', () => {
  it.each(['COM¹', 'lpt³.txt', 'CONIN$', 'conout$.log'])('예약어 %s 앞에 "_"를 붙인다', (name) => {
    const result = toLocalFileName(name, 'windows');
    expect(result.ok && result.name.startsWith('_')).toBe(true);
  });

  it.each([
    'a.jar',
    'a.msc',
    'a.chm',
    'a.pif',
    'a.vbe',
    'a.psm1',
    'a.url',
    'a.appref-ms',
    'a.application',
    'a.settingcontent-ms',
  ])('%s는 실행 파일로 경고한다', (name) => {
    expect(isExecutableName(name, 'windows')).toBe(true);
  });
});

describe('isPlainTextName (F4.8 로컬 편집, 보안 리뷰 H1)', () => {
  it('posix는 끝 공백·점을 다듬지 않는다(APFS는 그대로 보존, 보안 리뷰 L3)', () => {
    expect(isPlainTextName('x.txt ', 'posix')).toBe(false);
    expect(isPlainTextName('x.txt.', 'posix')).toBe(false);
    expect(isPlainTextName('x.txt ', 'windows')).toBe(true);
  });

  it.each(['nginx.conf', 'app.JSON', 'docker-compose.yml', 'README.md', 'error.log', 'my.cnf '])(
    '%s는 기본 앱으로 열어도 되는 텍스트 형식이다',
    (name) => {
      expect(isPlainTextName(name, 'windows')).toBe(true);
    },
  );

  it.each([
    'deploy.py',
    'run.sh',
    'index.html',
    'report.docm',
    'disk.iso',
    'Dockerfile',
    '.bashrc',
  ])('%s는 허용 목록 밖이라 기본 동작으로 열지 않는다', (name) => {
    expect(isPlainTextName(name, 'windows')).toBe(false);
  });
});
