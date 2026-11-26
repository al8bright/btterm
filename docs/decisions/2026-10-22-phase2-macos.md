# 2026-10-22 Phase 2 착수: macOS 먼저 (범위 이동)

PLAN Phase 2 "착수 시 먼저 결정" 항목과 순서를 사용자와 정했다.

| # | 결정 | 근거·영향 |
|---|---|---|
| M2-1 | **macOS go.** 목적은 정식 배포가 아니라 사용자 본인이 맥에서 설치 파일로 실행하는 것 | 사용자 요청(2026-10-22) |
| M2-2 | **서명은 ad-hoc**(`identity: "-"`). Developer ID·공증 없음 | 정식 배포가 아니다. Apple Silicon은 서명이 없으면 실행되지 않으므로 ad-hoc은 필수. ad-hoc 앱은 빌드한 맥에서 바로 실행되고, 다른 맥에서는 처음 한 번 Gatekeeper 허용(또는 `xattr -dr com.apple.quarantine`)이 필요하다 |
| M2-3 | **맥 빌드는 사용자의 맥에서** 저장소를 받아 한다. CI(GitHub Actions)는 쓰지 않는다(AGENTS §2) | electron-builder는 Windows에서 macOS 대상(dmg·서명)을 만들지 못한다 |
| M2-4 | **순서: 2-D macOS → 2-A 연결 확장 → 2-B 작업 공간 나머지 → 2-C 로컬 셸·보안** | 사용자가 macOS 먼저를 골랐다 |
| M2-4a | ~~**2-D 다음에 2-S 계정·동기화를 넣는다**: 2-D → 2-S → 2-A → 2-B 나머지 → 2-C (2026-10-23)~~ → 2026-11-26 2-S 제외([공개 범위](./2026-11-26-public-scope.md)) | 사용자 요청(2026-10-23) |
| M2-5 | **macOS 자동 업데이트는 하지 않는다.** 새 dmg로 다시 설치한다 | TR7은 Windows NSIS만. 맥 자동 업데이트(Squirrel.Mac)는 서명된 앱이 필요하다 |
| M2-6 | Phase 1.5 남은 항목(가져오기 F1.5~F1.7, 셸 통합 확장, 단축키 재지정, 영어, 온보딩 등)과 M1 1-7 수동 확인·도그푸딩은 **보류**한다. Phase 1.5 항목 중 이미 당긴 것(F2.4b, F6.11, F7.7, F7.8, F5.1b, F3.16c)은 끝났다 | 범위 이동. 맥 작업 중 Windows 회귀가 없도록 `pnpm verify`는 계속 커밋 게이트 |
| M2-7 | **출시 빌드의 Chromium 디버깅·샌드박스 스위치(`--remote-debugging-port`·`--remote-debugging-pipe`·`--no-sandbox`·`--js-flags` 등)는 지금은 남은 위험으로 두고, 출시 전에 막는다** (2026-10-23, 2026-11-26 갱신) | 보안 리뷰(2026-10-22) Medium. 같은 사용자 권한이면 이 스위치로 앱을 띄워 저장된 서버로 명령을 보낼 수 있다. 패키징 스모크(`scripts/smoke-packaged.mjs`)가 `--remote-debugging-port`로 출시 빌드를 조종하므로, 막으려면 스모크를 별도 빌드로 돌려야 한다. 본인 사용 전용(PRD §6.2)이라 지금은 사용자가 위험을 받아들였다. 막을 때 패키징 스모크를 디버깅 포트 없이 돌리도록 바꾼다 |

## 2-D 작업 목록 (맥에서)

맥에서 이어 작업하는 방법은 [docs/ops/macos-dev.md](../ops/macos-dev.md).

| 순서 | 작업 | 위치 |
|---|---|---|
| 1 | 맥에서 저장소 받기 → `pnpm install` → `pnpm verify` 통과 확인(플랫폼 차이로 깨지는 테스트 찾기) | — |
| 2 | 통합 테스트용 Docker Desktop + `pnpm test:integration` | `test/sshd/compose.yml` |
| 3 | platform 어댑터: 실행 파일 판단(`.app` `.command` `.pkg` `.dmg` 등, 보안 리뷰 TR3 M2), 텍스트 편집기(TextEdit `open -e`), agent(`SSH_AUTH_SOCK`, 이미 있음) | `client/desktop/src/platform/`, `client/core/src/sftp/localName.ts` |
| 4 | Cmd 키맵·앱 메뉴(macOS 표준 메뉴 + DESIGN §8.1에서 생성, SEC-8) | `client/core/src/keymap/`, main 메뉴 |
| 5 | 창: `titleBarStyle: 'hiddenInset'` + `trafficLightPosition`, 헤더 왼쪽에 신호등 자리 | `client/desktop/src/main/windowChrome.ts`, `windowOptions.ts` |
| 6 | renderer에 OS 플래그 전달(지금 `App`의 `platform` 기본값이 `'windows'`) | preload, `client/ui/src/App.tsx` |
| 7 | 패키징: `electron-builder.yml`에 `mac`(dmg, universal, ad-hoc), `scripts/package-mac.mjs`, Fuses·스모크 스크립트의 실행 파일 경로를 OS별로 | `scripts/` |
| 8 | 맥에서 `pnpm verify:full`(E2E는 사용자가 요청할 때) + M1 AC 확인 | PLAN Phase 2 종료 기준 |
