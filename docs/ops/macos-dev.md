# 맥에서 이어 작업하기 (Phase 2-D, 결정 [M2](../decisions/2026-10-22-phase2-macos.md))

Windows에서 하던 작업을 맥에서 받아 macOS 대응(2-D)을 진행하는 안내다. 목적은 정식 배포가 아니라 **본인 맥에서 설치 파일(dmg)로 실행**하는 것이다(ad-hoc 서명, 공증 없음).

## 1. 준비물

| 항목 | 버전·방법 |
|---|---|
| macOS | Apple Silicon 또는 Intel |
| Xcode Command Line Tools | `xcode-select --install` (codesign·git) |
| Node | `client/.nvmrc`의 메이저(**24**, Electron 내장 Node와 일치). `nvm install` 또는 `fnm use` |
| pnpm | `package.json`의 `packageManager`(**pnpm 11.1.3**). `corepack enable` 후 자동 |
| Docker Desktop | 통합 테스트용 sshd(`client/desktop/test/sshd/compose.yml`, linuxserver/openssh는 arm64 이미지 있음) |
| GitHub 접근 | 저장소 `al8bright/btterm`(public). HTTPS로 받는다 |

## 2. 받기·설치·확인

```bash
git clone https://github.com/al8bright/btterm.git
cd btterm
corepack enable
pnpm run bootstrap                             # client에 설치 + git 훅. Electron 바이너리가 없으면 node client/node_modules/electron/install.js
pnpm verify                                    # 커밋 게이트. 맥에서 처음 깨지는 테스트가 2-D 첫 작업 목록이다
pnpm dev                                       # 개발 실행
```

통합 테스트(Docker Desktop을 켠 뒤): `pnpm test:integration`. 끝나면 sshd를 내린다. 계속 띄워 두려면 `BTTERM_KEEP_SSHD=1`.
E2E(`pnpm test:e2e`, `verify:full`)는 사용자가 요청할 때만 돌린다.

## 3. 맥에서 Windows와 다른 곳 (2-D, 2026-10-22 반영)

| 위치 | 맥 동작 |
|---|---|
| `platform/paths.ts` `plainTextEditor()` | 허용 목록 밖 파일은 TextEdit(`/usr/bin/open -e`, 셸 없이)로 연다 |
| `core/sftp/localName.ts` `isExecutableName()` | `.app` `.command` `.pkg` `.dmg` `.webloc` 등 실행 형식과 TextEdit가 렌더링하는 HTML·RTF·문서 형식은 로컬 편집을 막는다 |
| `main/windowOptions.ts` | `hiddenInset` + `trafficLightPosition {16,17}`. 헤더 왼쪽 92px(전체 화면에서는 `window.fullScreen` 이벤트로 제거) |
| `platform/paths.ts` `uiPlatform()` → `additionalArguments` → `window.btterm.platform` | renderer가 Cmd 키맵·단축키 표기를 고른다 |
| `main/appMenu.ts` | 앱·편집·창의 표준 역할만(SEC-8). Windows는 메뉴 없음 |
| `client/scripts/lib/packagedApp.mjs` | Fuses·스모크의 OS별 실행 파일 경로 |

## 4. 맥 설치 파일

```bash
pnpm package:mac        # → client/desktop/release/<버전>/btterm-<버전>-universal.dmg, SHA256SUMS-mac.txt
pnpm check:fuses        # 압축 해제본(임시 폴더 btterm-release/mac-universal)의 Fuses
pnpm smoke:packaged     # 테스트 sshd를 띄운 뒤. 맥은 --use-mock-keychain으로 실행(이때 비밀 저장은 꺼진다)
```

- `electron-builder.yml`의 `mac`: dmg universal, `identity: '-'`(ad-hoc, M2-2), `hardenedRuntime: true` + `build/entitlements.mac.plist`(`allow-jit`, `disable-library-validation`만). ad-hoc은 Team ID가 없어 라이브러리 검증만 끄고, DYLD 환경 변수 허용은 주지 않는다(보안 리뷰 M-2, `DYLD_PRINT_LIBRARIES`가 무시되는 것 확인). 26.15.3 스키마로 확인.
- 아이콘: `client/desktop/build/icon.png`(512)에서 electron-builder가 만든다. 더 선명하게 하려면 1024px을 추가한다(`pnpm icons` 수정).
- 처음 실행: 빌드한 맥에서는 바로 열린다. 다른 맥으로 옮기면 Gatekeeper가 막으므로 시스템 설정 → 개인정보 보호 및 보안 → "그래도 열기"(macOS 14 이하는 Control+클릭 → 열기).
- **키체인 확인 창**: 비밀 보관소 키는 로그인 키체인의 `@btterm/desktop Safe Storage` 항목이다. ad-hoc 서명은 빌드마다 바뀌므로 새 dmg를 설치하거나 `pnpm dev`(서명이 다른 Electron)와 번갈아 쓰면 이 항목 접근 때 로그인 암호를 묻는다. "항상 허용"을 눌러도 다음 빌드에서 다시 묻는다(PLAN 부록 B 위험). 창이 떠 있는 동안 앱 창이 나타나지 않는다.
- `--use-mock-keychain`은 스모크 전용이다. 출시 빌드는 이 스위치(와 `--password-store`)로 실행되면 고정 키로 비밀을 저장하지 않도록 비밀 저장을 끈다(SEC-2).
- **남은 위험(ad-hoc 서명, 보안 리뷰 2026-10-22)**: `disable-library-validation` 때문에 같은 사용자 권한으로 번들 안의 dylib(`Electron Framework` 등)를 바꿔 넣으면 키체인 확인 창 없이 btterm 프로세스에서 코드가 돈다(메인 실행 파일 cdhash는 그대로라 키체인 ACL이 통과). 근본 해결은 Team ID가 있는 Developer ID 서명뿐이다(결정 M2-2 범위 밖). hardened runtime으로 `DYLD_INSERT_LIBRARIES`·디버거 연결은 막힌다.
- 자동 업데이트 없음: 새 버전은 새 dmg로 다시 설치한다.

## 5. Claude Code로 이어 할 때

- 프로젝트 규칙은 `AGENTS.md`·`CLAUDE.md`가 원천이다. Windows의 Claude 기억(memory)은 맥으로 넘어가지 않으므로 맥락은 다음 문서에서 읽는다: [PLAN](../PLAN.md) 머리 표와 남은 작업, [진행 현황](../progress.md), [결정 M2](../decisions/2026-10-22-phase2-macos.md), 이 문서.
- 개인 전역 지침(`~/.claude/CLAUDE.md`)에 "Windows PowerShell 전용"이 있다면 맥에서는 zsh로 바꿔 쓴다(저장소 밖 설정).
- E2E는 요청할 때만 돌린다(사용자 지침).
