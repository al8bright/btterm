// SEC-7: 패키징한 실행 파일의 Electron Fuses가 기대값인지 확인한다.
// 사용: pnpm check:fuses [실행 파일 경로]  (기본: 임시 폴더 btterm-release의 OS별 압축 해제본)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fuses from '@electron/fuses';
import { packagedExecutable } from './lib/packagedApp.mjs';

const { getCurrentFuseWire, FuseV1Options } = fuses;
// @electron/fuses의 상태 값: '1'(49) = 켜짐
const ENABLED = 49;

// 기본: scripts/package-win.mjs·package-mac.mjs가 패키징한 압축 해제본
const exe = process.argv[2] ?? packagedExecutable(join(tmpdir(), 'btterm-release'));

if (!existsSync(exe)) {
  console.error(`fuses: 실행 파일이 없습니다: ${exe}\n먼저 pnpm package:win 또는 pnpm package:mac`);
  process.exit(1);
}

const expected = {
  RunAsNode: false,
  EnableCookieEncryption: true,
  EnableNodeOptionsEnvironmentVariable: false,
  EnableNodeCliInspectArguments: false,
  EnableEmbeddedAsarIntegrityValidation: true,
  OnlyLoadAppFromAsar: true,
  LoadBrowserProcessSpecificV8Snapshot: false,
  GrantFileProtocolExtraPrivileges: false,
};

// getCurrentFuseWire는 첫 sentinel만 읽는다. macOS universal은 아키텍처별로 잘라 각각 검사한다.
// macOS는 Fuses가 실행 파일이 아니라 Electron Framework 바이너리에 있다(@electron/fuses와 같은 규칙).
function slices(exePath) {
  if (process.platform !== 'darwin' || !exePath.includes('.app'))
    return [{ label: '', path: exePath }];
  const path = exePath.endsWith('.app')
    ? join(exePath, 'Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework')
    : join(exePath, '..', '..', 'Frameworks', 'Electron Framework.framework', 'Electron Framework');
  const archs = execFileSync('lipo', ['-archs', path], { encoding: 'utf8' }).trim().split(/\s+/);
  if (archs.length < 2) return [{ label: '', path }];
  const dir = mkdtempSync(join(tmpdir(), 'btterm-fuses-'));
  return archs.map((arch) => {
    const out = join(dir, arch);
    execFileSync('lipo', [path, '-thin', arch, '-output', out]);
    return { label: `[${arch}] `, path: out };
  });
}

let wrongTotal = 0;
for (const slice of slices(exe)) {
  const wire = await getCurrentFuseWire(slice.path);
  const wrong = Object.entries(expected).filter(([name, want]) => {
    const state = wire[FuseV1Options[name]];
    const on = state === ENABLED;
    return on !== want;
  });
  for (const [name, want] of Object.entries(expected)) {
    const state = wire[FuseV1Options[name]] === ENABLED ? 'on' : 'off';
    console.log(
      `${wrong.some(([n]) => n === name) ? '✗' : '✓'} ${slice.label}${name}: ${state} (기대 ${want ? 'on' : 'off'})`,
    );
  }
  wrongTotal += wrong.length;
}
if (wrongTotal > 0) {
  console.error(`fuses: ${wrongTotal}개가 기대와 다릅니다`);
  process.exit(1);
}
console.log('fuses: 모두 기대값');
