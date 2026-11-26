# AGENTS.md — btterm

Windows 우선(macOS는 M2) SSH 통합 클라이언트. Electron + React + TypeScript, xterm.js, ssh2.
사람과 모든 코딩 에이전트(Claude Code, Codex, Cursor 등)가 지키는 **프로젝트 규칙**이다. 이 파일만 읽어도 작업할 수 있게 쓴다.

**현재 페이즈는 `docs/PLAN.md` 머리 표의 "현재 페이즈" 줄을 본다.**

---

## 1. 기준 문서

| 문서 | 원천인 것 |
|---|---|
| `docs/PRD.md` | 요구사항(F-ID), 수용 기준(AC), 결정(D-ID), 미결 사항(Q) |
| `docs/PLAN.md` | 페이즈, 순서, 종료 기준, 현재 페이즈 |
| `docs/DESIGN.md` | 토큰, 컴포넌트, **단축키(§8.1)** |
| `AGENTS.md`(이 파일) | 아키텍처 경계, **보안 불변 조건(§4)**, 작업·커밋 규칙 |
| `docs/mockup/` | 시각 참고만. 코드로 재사용하지 않는다 |

- 작업 전에 다룰 F-ID / AC를 정한다. PRD에 없는 기능, 현재 페이즈 밖의 기능은 만들지 않는다. 필요하면 PRD에 제안으로 남기고 멈춘다.
- **결정·범위가 바뀌면** 같은 커밋 묶음 안에서 해당 문서를 고친다(먼저 문서, 그다음 코드). 문구 다듬기 같은 세부 동기화는 페이즈 종료 때 몰아서 한다.
- 문서와 코드가 다르면: 의도한 변경이면 문서를 먼저 고치고, 의도하지 않은 차이면 문서가 기준이다.

---

## 2. 작업 절차

1. 현재 페이즈와 대상 F-ID / AC를 밝힌다.
2. **Red** — 가장 단순한 실패 테스트. 결함은 API 수준 재현 테스트부터.
3. **Green** — 통과하는 최소 코드.
4. **Refactor** — Green에서만. 구조 변경은 별도 커밋.
5. `pnpm verify`가 통과할 때만 커밋한다. **CI가 없으므로 로컬 검증이 유일한 게이트다.**

### 커밋
- 제목: `[Structural|Behavioral] <type>: <한국어 요약 50자 이내>` (type: feat, fix, refactor, docs, style, test, chore)
- 구조 변경(이름, 추출, 이동, 패키지 분리)과 행위 변경을 한 커밋에 섞지 않는다. 문서만 바꾸면 `[Structural] docs:`.
- 본문 마지막 줄에 참조: `Refs: F2.3, AC10, SEC-3` (SEC-n은 §4 번호).
- 브랜치: **`main` 하나만 쓴다.** 기능 브랜치·PR·GitHub Actions(CI)를 만들지 않는다. 커밋은 `main`에 직접, push는 사용자가 요청할 때. force push 금지.
- git 훅(lefthook): `commit-msg`에서 제목 형식 검사, `pre-commit`에서 스테이징 파일 ESLint·Prettier·비밀 스캔(secretlint), `pre-push`에서 `pnpm verify`. `--no-verify`로 우회하지 않는다.

### 사전 승인이 필요한 변경
다음을 바꾸려면 **작업을 멈추고** 사용자에게 (무엇을, 왜, 라이선스, 네이티브 여부)를 보고한 뒤, 명시적 승인 응답을 받고 진행한다. 승인 내용은 `docs/decisions/`에 기록한다.
- `dependencies` / `devDependencies` 추가, 메이저 업그레이드
- `pnpm.onlyBuiltDependencies` 등 빌드 스크립트 허용 목록
- 네이티브 모듈(`binding.gyp`, prebuild 포함 패키지)
- GPL 계열 라이선스 의존성
- 보안 불변 조건(§4) 문구 변경

### 결정 기록
- D-ID 결정의 원천은 PRD §0 표다. `docs/decisions/YYYY-MM-DD-<주제>.md`는 **스파이크 결과, 범위 이동(M1↔M1.5 등), 사전 승인** 기록에만 쓴다.

---

## 3. 아키텍처 경계

| 규칙 | 이유 | 강제 |
|---|---|---|
| `client/core`는 Node·Electron·DOM·React를 import하지 않는다. 허용 전역: `TextDecoder`, `TextEncoder`, `structuredClone`, `URL` | 코어를 빠른 단위 테스트로 TDD | ESLint `no-restricted-imports`, tsconfig `lib:["ES2022"]`·`types:[]` |
| 도메인 코드는 시간·난수를 `Clock`·`IdGenerator` 포트로만 쓴다(`Date.now`, `setTimeout`, `randomUUID` 직접 호출 금지) | 결정적 테스트 | ESLint `no-restricted-globals`(core) |
| OS 분기(`process.platform`, `os.platform()`, `path.win32/posix`, OS 환경 변수)는 `client/desktop/src/platform` 안에서만. renderer는 preload가 준 OS 플래그만 쓴다 | Windows/macOS 차이를 한 곳에 (D12) | ESLint `no-restricted-syntax` |
| ssh2·node-pty는 `client/desktop/src/session-host`(utilityProcess)에서만 import한다. 키 파싱·지문 계산도 session host 또는 core 순수 파서로 | main 이벤트 루프 보호, 크래시 격리 (D5) | dependency-cruiser 경계 규칙 |
| `main`·`preload`·`session-host`·`platform` 사이 import 방향은 dependency-cruiser 설정이 원천 | 프로세스 경계 유지 | dependency-cruiser |
| 터미널 바이트는 `MessagePort`로 session host ↔ renderer 직결, main 경유 금지. 포트 전달 방식은 S1 결과로 확정(`docs/decisions/`) | 대량 출력 성능 | E2E 성능 측정(AC17) |
| renderer는 `window.btterm`(preload 도메인 API)만 쓴다. `ipcRenderer`, 범용 `invoke(channel)`, 원시 포트를 노출하지 않는다(S1에서 달리 결정한 경우 그 결정을 따른다) | IPC 공격 표면 최소화 | preload 계약 테스트 |
| **모든 경계 메시지는 core의 zod 스키마로 런타임 검증**: main IPC(+`senderFrame` origin), session host의 `parentPort`, MessagePort 프레임(입력·resize·ACK) | 타입만으로는 경계가 안전하지 않다 | IPC 계약 테스트 |
| SSH 엔진은 `SshTransport` 포트 뒤에만. 같은 계약 테스트 스위트를 Fake와 ssh2 어댑터 양쪽에 돌린다 | 엔진 교체 가능성 (D6) | 계약 테스트 |
| 저장은 리포지토리 계층으로만. 쓰기는 임시 파일 → fsync → rename(Windows `EPERM`은 제한 재시도) | 데이터 손상 방지 (F6.2) | 리포지토리 계약 테스트 |
| 스키마 변경 = 버전 증가 + 마이그레이션 함수 + 테스트 | 사용자 데이터 보존 (F6.3) | 마이그레이션 테스트 |
| xterm 인스턴스는 React 밖 `TerminalRegistry`가 소유한다. 컴포넌트는 attach/detach만. 터미널 바이트는 상태 store를 거치지 않는다 | 탭 전환 시 상태 보존, 렌더 폭주 방지 | 코드 리뷰 + 컴포넌트 테스트 |

패키지 분리(`ipc-contract`, `adapter-ssh` 등)는 경계가 굳은 뒤 `[Structural]` 커밋으로만 한다. 그 전까지 경계는 위 린트로 지킨다.

---

## 4. 보안 불변 조건 (SEC-n, 예외 없음)

| # | 규칙 | 강제 |
|---|---|---|
| SEC-1 | 비밀정보(비밀번호, 개인키, passphrase, DEK)는 renderer로 **보내지 않는다**. renderer는 입력 전용 채널로 비밀을 **보낼 수만** 있다. 원격에서 읽은 기록·출력 중 비밀 패턴은 main/session host에서 가린 뒤 전달 | IPC 스키마에 `Secret` 타입 거부 계약 테스트 |
| SEC-2 | 평문 폴백 금지. `safeStorage`(main 전용, `app.whenReady()` 이후)를 쓸 수 없으면 저장을 거부한다. 데이터 폴더(스냅샷·`.bak` 포함)에 평문 비밀이 있으면 버그다 | AC26 |
| SEC-3 | `hostVerifier`는 항상 설정한다. 불일치는 차단이 기본. 우회 옵션·플래그·헬퍼를 프로덕션 코드에 두지 않는다 | ast-grep 규칙(`hostVerifier` 누락·상수 true) |
| SEC-4 | 로그 마스킹: 키 이름(`password`, `passwd`, `passphrase`, `privateKey`, `token`, `secret`, `authorization`, `cookie`, `dek`, 대소문자 무시) + 값 패턴(`-p\S+`, `--password[= ]`, `*_TOKEN=`, URL `user:pass@`). 패턴은 core 상수 한 곳. ssh2 debug·연결 옵션·IPC 인자를 통째로 기록하지 않는다 | 마스킹 픽스처 테스트 |
| SEC-5 | 터미널 출력과 원격 파일 내용은 신뢰하지 않는다. OSC 52 기본 OFF(읽기 항상 거부), 링크는 `http(s)`만 + 확인창, xterm `windowOptions` 전부 false, 붙여넣기·기록 입력은 `term.paste()` + 제어문자 제거, OSC 7 host가 접속 호스트와 다르면 무시 | xterm 옵션 단위 테스트 |
| SEC-6 | `shell.openExternal`은 main의 한 모듈에서 `new URL()` 파싱 + 스킴 allowlist 후에만 | ESLint `no-restricted-imports`(그 모듈 외) |
| SEC-7 | Electron 기본선: `contextIsolation`, `sandbox`, `nodeIntegration:false`, `webviewTag:false`, CSP, 새 창·`will-navigate` 차단, `setPermissionRequestHandler`·`setPermissionCheckHandler` 거부(클립보드는 main 경유), 출시 빌드 DevTools·reload 비활성, Fuses(`GrantFileProtocolExtraPrivileges=false` 포함) | `webPreferences` 스냅샷 테스트, 패키징 스크립트의 `@electron/fuses read` |
| SEC-8 | **Electron 기본 메뉴를 쓰지 않는다.** 메뉴는 DESIGN §8.1 키맵에서 생성하며 Ctrl+(문자) 가속키(reload, close, zoom 등)를 두지 않는다 | E2E: Ctrl+W가 `\x17`로 원격 도착 |
| SEC-9 | 포워딩 기본값: 에이전트·X11 OFF, 포트 포워딩 바인드 `127.0.0.1` | 단위 테스트 |
| SEC-10 | 명령 기록: 공백 시작 명령·비밀 패턴 인자는 저장·표시하지 않는다. M1 기록 검색은 메모리 전용, **입력만(실행 없음)** | AC30b, AC32 |
| SEC-11 | 원격 경로·파일명은 로컬 대상 폴더 밖으로 나갈 수 없게 정규화한다(`..`, 절대 경로, 드라이브, ADS `:`, 예약어 `CON` 등). 실행 가능한 확장자는 열기 전에 경고 | 경로 퍼징 테스트 |
| SEC-12 | 가져온 설정의 실행 항목(startup command, `ProxyCommand`, `LocalCommand`)은 사용자가 승인하기 전까지 비활성 | 단위 테스트 |
| SEC-13 | 크래시 리포트 자동 업로드 금지 | 설정 테스트 |

**보안 검토 트리거**: 다음 경로를 바꾸는 변경은 구현과 별도의 보안 리뷰 패스를 거치고, 커밋 본문 `Refs:`에 해당 SEC 번호를 적는다.
`client/desktop/src/{main,preload,session-host}/**`, vault·저장소 코드, `client/core/**/ipc/**`, `BrowserWindow` 생성부, `package.json` 의존성.

---

## 5. 클린룸·라이선스

- MobaXterm 바이너리를 디컴파일·디스어셈블하지 않는다(REA·Ghidra 포함). REA는 btterm 자체 빌드 점검에만 쓴다. (D1, D2)
- MobaXterm 정보는 공식 문서, 실행 관찰, 사용자 소유 `MobaXterm.ini`, 공개 프로토콜에서만 얻는다. 명세(`docs/spec/`, 필요할 때 만든다)에 코드·주소·심볼을 넣지 않는다.
- MobaXterm 저장 비밀번호 형식을 분석·복호화하지 않는다. 아이콘·에셋·명칭("Moba", "MoTTY")을 쓰지 않는다.
- MIT 코드(Tabby, electerm 등)를 가져오면 원본 저작권 헤더를 유지하고 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)에 추가한다.
- 라이선스는 `pnpm verify`의 검사로 확인한다(GPL 계열 실패).

---

## 6. 테스트

- 순수 로직은 `client/core` Vitest 단위 테스트. 외부 의존은 Fake(`FakeSshTransport`, `FakeClock`, 인메모리 저장소)로.
- SSH 통합 테스트는 `client/desktop/test/sshd/` Docker sshd에서만. **실제 서버·사용자 `~/.ssh`에 접속·쓰기 금지.**
- Docker가 없으면 skip하지 않고 원인 메시지와 함께 **실패**한다(통합 프로젝트 `globalSetup`). `.skip`, `.only`, `.todo`는 린트 오류다.
- 자원 누수 검사는 Vitest `setupFiles`가 자동 주입하는 `assertAllDisposed()`로 한다. SSH·터미널·전송 계층의 자원은 tracker를 받는 팩토리로만 만든다.
- 터미널 화면 검증은 xterm 버퍼(`translateToString`, 커서, `buffer.active.type`)로. 픽셀 비교는 테마 스모크에만.
- 비동기 대기는 이벤트·`FakeClock.advance()`로. flaky 테스트는 재시도로 덮지 않는다.
- 테스트 이름에 AC 번호를 넣는다(예: `AC10 호스트 키 불일치 시 차단`). `docs/qa/ac-matrix.md`와 `pnpm verify`의 미배정 AC 검사가 이를 추적한다.
- 통합·E2E는 로컬 Docker(WSL2)에서 `pnpm verify:full`로 돌린다. 하위 페이즈 종료 전과 패키징 전에는 반드시 실행한다.
- Node ABI(단위)와 Electron ABI(E2E) 산출물을 같은 `node_modules`에서 섞지 않는다. E2E·개발 빌드는 별도 `userData`를 쓴다.

---

## 7. 의존성·빌드

- pnpm(`packageManager` 필드 버전), Node는 `client/.nvmrc`(Electron 내장 Node 메이저와 일치). `client/pnpm-lock.yaml` 커밋, 평소 설치는 `pnpm run bootstrap`(= `client`에서 `pnpm install --frozen-lockfile` + git 훅 설치)(lockfile 변경은 의존성 승인 때만). 의존성 갱신은 월 1회 `pnpm outdated` 점검 후 승인 절차로.
- `client/.npmrc`의 `node-linker=hoisted` 유지. `cpu-features`는 빌드하지 않는다. ssh2는 externalize하고 정확한 버전으로 고정(`^` 금지), 패치는 `patch-package`.
- keytar 금지. 비밀 저장은 `safeStorage`.
- 앱 글꼴·아이콘은 번들. 런타임 외부 CDN 금지.
- 저장소는 public(MIT 라이선스, 2026-11-26). 비밀과 실제 서버 정보(IP·호스트 이름·계정명)는 커밋하지 않는다. 릴리스 바이너리는 본인 사용 전용(배포 범위를 넓히려면 PRD §6.2·§9.6·§10 조건을 먼저 충족).

---

## 8. UI

- 색·간격·모서리는 `client/ui/src/theme/tokens.css` 토큰만. 컴포넌트에 hex·px 리터럴을 쓰지 않는다(stylelint `color-no-hex`, `declaration-strict-value`).
- 단축키는 DESIGN §8.1이 원천이다. Windows 앱 단축키는 Ctrl+Shift 계열만(예외: 칸이 2개 이상일 때의 Ctrl+Alt+방향키 칸 조작), Ctrl+(문자)·Alt+(문자)는 터미널로.
- 텍스트 대비 4.5:1, 비텍스트(입력 테두리·아이콘) 3:1, 클릭 대상 24×24 이상. 상태는 모양 또는 텍스트를 병행한다.
- 사용자에게 보이는 문자열은 i18n 키로(린트로 리터럴 금지). core 오류는 문자열이 아니라 코드로 반환한다.
- 위험한 동작의 기본값: 호스트 키 교체 다이얼로그의 기본 버튼은 "연결 취소", production 서버의 "모든 탭 실행"은 확인 체크 필요.

---

## 9. 저장소 구조

```
btterm/
├─ AGENTS.md  CLAUDE.md  README.md  SECURITY.md  CONTRIBUTING.md  THIRD_PARTY_NOTICES.md  LICENSE  lefthook.yml
├─ .github/ISSUE_TEMPLATE/   # 이슈 양식만(workflow 없음)
├─ package.json      # 얇은 위임: 명령을 client로 넘긴다(의존성 없음)
├─ docs/  PRD, PLAN, DESIGN, progress, mockup/, images/, decisions/, ops/, perf/, qa/, reviews/ (spec/·spikes/는 필요할 때 만든다)
├─ client/           # 앱(TypeScript, pnpm 워크스페이스 루트)
│  ├─ package.json  pnpm-workspace.yaml  pnpm-lock.yaml  node_modules/
│  ├─ eslint·vitest·tsconfig.base·prettier·stylelint·dependency-cruiser·secretlint 설정, .npmrc, .nvmrc
│  ├─ scripts/       # 검사(AC 매트릭스·커밋 메시지·비밀·라이선스)·패키징·릴리스·스모크
│  ├─ core/          # 도메인·포트·IPC 스키마·키맵 데이터(@btterm/core)
│  ├─ ui/            # React, window.btterm 인터페이스만 의존(@btterm/ui)
│  └─ desktop/       # Electron(@btterm/desktop)
│     ├─ src/  main/  preload/  session-host/  platform/  renderer/
│     └─ test/sshd/  # 통합·E2E용 sshd Docker compose
└─ spikes/           # (필요할 때 만든다) 버리는 실험 코드. 프로덕션에서 import 금지(dependency-cruiser)
```

---

## 10. 명령

| 목적 | 명령 |
|---|---|
| 설치 | `pnpm run bootstrap` (`client`에서 설치 + git 훅. Electron 바이너리가 없으면 `node client/node_modules/electron/install.js`) |
| 명령 위치 | 아래 명령은 저장소 루트에서 쓴다(루트 `package.json`이 `pnpm -C client …`로 넘긴다). 의존성 추가·`--filter`는 `client`에서 |
| 개발 실행 | `pnpm dev` |
| 단위 / 통합(Docker) / E2E | `pnpm test` / `pnpm test:integration` / `pnpm test:e2e` |
| 린트 / 포맷 / 타입 | `pnpm lint` / `pnpm format:check` / `pnpm typecheck` |
| **커밋 게이트** | `pnpm verify` = lint(ESLint·dependency-cruiser·stylelint) + format:check + typecheck + 단위 + AC 매트릭스 + 비밀 스캔(secretlint) + 라이선스 + audit |
| **전체 검증** | `pnpm verify:full` = verify + 통합(Docker) + E2E(E2E 빌드 포함) |
| 패키징(출시) | `pnpm package:win` / `pnpm package:mac` → `client/desktop/release/` |
| 통합 컨테이너 유지 | `BTTERM_KEEP_SSHD=1` (테스트 후 sshd를 내리지 않음) |
