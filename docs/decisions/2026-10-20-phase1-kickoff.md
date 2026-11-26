# 2026-10-20 Phase 1 착수 — 개발 중 결정과 발생 사항

사용자 지시: "Phase 1을 바로 시작, 막히는 부분은 권장안대로 먼저 개발하고 끝난 뒤 문서화".
M0(기반·검증)를 별도 페이즈로 끝내지 않고, Phase 1 진행에 필요한 최소 골격만 만들어 시작했다.

## 1. 진행 범위

| 하위 페이즈 | 상태 | 내용 |
|---|---|---|
| M0 0-A 골격 | 부분 | pnpm 워크스페이스, TS·Vitest·ESLint(core 경계)·Prettier, `pnpm verify` / `verify:full`, AC 매트릭스 검사, Docker sshd |
| 1-1 하네스·순수 모듈 | 완료 | ResourceTracker(자동 누수 검사), FakeClock, IdGenerator, Utf8StreamDecoder, known_hosts 파서, HostKeyPolicy, OutputCoalescer, base64 |
| 1-2 저장·보관·IPC | 완료 | 도메인 모델(zod), 설정 상속, 마이그레이션, AckFlowController, 로그 마스킹, IPC 계약(+SEC-1 비밀 필드 검사), SshTransport 포트·Fake·계약 스위트, JsonFileStore(원자적), 업그레이드 스냅샷, SecretVault |
| 1-W 워킹 스켈레톤 | 완료 | 퀵커넥트 → 비밀번호 → 호스트 키 확인 → session host(ssh2) → MessagePort → xterm. E2E 3건, NSIS 설치 파일 생성·실행 확인 |
| 1-3 세션·SSH | 일부 | HostSession(상태·끊김·종료·흐름 제어), AC1·2·3·5 통합 테스트 |
| 1-3.5 ~ 1-7 | 미착수 | — |

## 2. 권장안대로 진행한 결정

| # | 상황 | 결정 | 근거 |
|---|---|---|---|
| K1 | TypeScript 최신은 7.0이지만 typescript-eslint가 `<6.1`만 지원 | **TypeScript `~6.0.3` 고정** | 린트 강제 장치(AGENTS §3)가 우선 |
| K2 | M0 스파이크 S1~S6을 별도로 돌리지 않음 | 스켈레톤으로 대체 검증: S1(포트 경로 동작 ✅, 성능 측정 ✗), S2(ssh2 번들 ✅, agent ✗), S3(Playwright `_electron` ✅, Fuses 미적용 상태), S4·S5·S6 ✗ | 사용자 지시로 Phase 1 우선 |
| K3 | S1 미측정 상태의 포트 전달 방식 | **preload가 포트를 쥐고 함수 API만 노출**(AGENTS §3 기본값) | 리뷰 권고: 측정 전에는 보안 우선 |
| K4 | `MessagePortMain`은 ArrayBuffer transfer 불가 | 구조화 복제(복사)로 전달. 비용 측정은 AC17 E2E 때 | Electron 문서 |
| K5 | 연결 수명주기 로직 위치 | **`HostSession`을 core에 둠**(Electron 비의존) → Fake·실제 ssh2 양쪽에서 같은 코드 검증 | TDD 가능성 |
| K6 | sandbox preload는 CommonJS만 가능 | `apps/desktop`에서 `"type":"module"` 제거 → main·preload를 CJS로 출력 | electron-vite 문서 |
| K7 | 런타임 외부 모듈 | `dependencies`는 **ssh2 하나**. core·React·xterm은 devDependencies(번들) | electron-vite 외부화 규칙, 설치 크기 |
| K8 | 퀵커넥트 비밀번호 요청 시점 | 연결 전에 먼저 묻는다(호스트 키 확인은 그다음) | ssh2는 비밀번호를 접속 설정으로 받음 |
| K9 | 호스트 키 불일치 | **항상 차단**(교체 흐름은 M1 후반, 체크박스 확인 방식) | SEC-3 |
| K10 | 호스트 키 저장 위치 | 앱 전용 `userData/known_hosts`(쓰기) + `~/.ssh/known_hosts`(읽기만) | F2.4 |
| K11 | 터미널 테마 원천 | 스켈레톤은 renderer의 `terminalTheme.ts`. M1.5에 core JSON으로 이전 | DESIGN §7 |
| K12 | 통합 테스트 컨테이너 | `linuxserver/openssh-server` + vim·bash·procps 커스텀 이미지(`test/sshd/target.Dockerfile`) | AC1·AC2 |
| K13 | `app://` 경로 이탈 | WHATWG URL이 `..`·`%2e%2e`를 먼저 정규화 → 폴더 안으로 귀결. 디코딩 후 백슬래시·`%2f` 이탈은 null | 테스트로 확인 |

## 3. 발생한 문제와 처리

| 문제 | 처리 | 남은 일 |
|---|---|---|
| pnpm 11이 기본 `minimumReleaseAge`로 최근 배포된 typescript-eslint 8.72.0을 막음 → 설치 시 `minimumReleaseAgeExclude`가 자동 추가됨 | 그대로 둠(의도적 공급망 보호의 예외 기록) | 버전이 성숙하면 예외 제거 |
| pnpm 11은 `onlyBuiltDependencies` 대신 `allowBuilds` | `pnpm-workspace.yaml`의 `allowBuilds`로 이전. electron·esbuild 허용, ssh2·cpu-features·electron-winstaller 금지 | — |
| electron-builder가 끌고 온 `electron-winstaller`(Squirrel)가 미승인 빌드로 설치 중단 | `false`로 명시(NSIS만 사용) | — |
| pnpm이 `allowBuilds`에 자리표시 줄을 추가해 YAML이 깨짐 | 수동 수정 | — |
| `electron` postinstall이 실행되지 않아 바이너리 없음 | `node node_modules/electron/install.js` 수동 실행 | **새로 clone하면 같은 문제가 생길 수 있음** → 설치 스크립트 보강 필요 |
| Electron 44 내장 Node | 24.22.0 → `.nvmrc` 24와 일치 확인 | — |
| E2E에서 `cat -v`로 Ctrl+W 확인 실패 | 앱 결함 아님: cooked 모드 tty가 ^W를 단어 지우기로 처리. **셸 줄 편집 결과로 검증하도록 테스트 수정** | — |
| Playwright(CJS)가 `import.meta`를 쓰는 globalSetup을 못 읽음 | compose 파일을 cwd에서 위로 탐색하는 방식으로 변경 | — |
| electron-builder가 ssh2의 `pagent.exe`(Pageant 헬퍼)를 패키지에 포함 | 현재 기능 영향 없음 | Pageant는 M2에서 named pipe로 직접 구현 예정이라 제외 검토 |
| 무서명 빌드라 signtool 단계는 서명 없이 통과 | 예상대로 | SmartScreen 실측(S6) |

## 4. 아직 하지 않은 것(문서 대비 차이)

- **M0 강제 장치 일부 미구축**: lefthook 훅, dependency-cruiser(프로세스 경계), stylelint(hex 금지), `verify`의 비밀 스캔(당시 gitleaks 예정, 이후 secretlint로 대체)·라이선스·audit, i18n 리터럴 린트. → 다음 작업 1순위.
- **스파이크 S4(한글 IME)·S5(Tabby 플러그인)·S6(무서명 실행)**, 사용 로그(0-C), 목업 갱신(0-D).
- **1-3 나머지**: 재접속 정책(퀵커넥트는 비밀번호를 저장하지 않아 자동 재접속 불가 → 프로필·vault 연결 후), 개인키·agent·keyboard-interactive 인증, 절전 복귀, 오류 분류 UI 세분화.
- Fuses, 출시 빌드 스모크(실행 확인만 함), AC17 성능 측정.
