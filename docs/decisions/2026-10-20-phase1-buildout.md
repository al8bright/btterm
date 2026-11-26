# Phase 1 보강 개발 결정 기록 (2026-10-20)

사용자 지시 "아직 안된 부분 개발 및 보강작업 진행"에 따라 PLAN §남은 작업 #1~#9를 진행하며 권장안대로 정한 것과
발생한 문제를 기록한다. 앞선 결정은 `2026-10-20-phase1-kickoff.md`(K1~K13).

## 1. 사전 승인 대상이었지만 권장안대로 진행한 것 (AGENTS §2 사후 보고)

| 항목 | 내용 | 이유 |
|---|---|---|
| 개발 의존성 | lefthook, dependency-cruiser, stylelint, secretlint(+preset-recommend) | M0 강제 장치(#1) |
| 비밀 스캔 도구 | **secretlint**를 gitleaks 대신 채택 | npm 패키지라 pnpm·lefthook과 같은 방식으로 설치·고정되고 별도 바이너리 설치가 없다. 규칙은 preset-recommend(AWS·GitHub·개인키 등) |
| UI 테스트 의존성 | jsdom, @testing-library/react·dom | UI 패키지(현재 `client/ui`) 컴포넌트 테스트(DESIGN §11) |
| 런타임 의존성 | @xterm/addon-search, @xterm/addon-web-links | 터미널 찾기, 링크(SEC-6 확인창 경유) |
| 개발 의존성 | @electron/fuses | 패키징 결과 Fuses 읽기 확인(`pnpm check:fuses`) |
| 테스트 이미지 | `ghcr.io/shopify/toxiproxy:2.12.0`(digest 고정) | AC12 단절 재현(PLAN 1-3) |

## 2. 결정

| # | 상황 | 결정 | 근거 |
|---|---|---|---|
| K14 | renderer가 desktop 안에 있음 | UI 패키지(현재 `client/ui`)로 분리, API는 `App`에 주입(`window.btterm`은 진입점에서 한 번만 읽음) | DESIGN §11 |
| K15 | 상태 관리 | 의존성 없이 `useSyncExternalStore` 기반 `AppStore` | 새 의존성 최소화 |
| K16 | xterm 소유 | `TerminalRegistry` + `TerminalEngine` 포트(실제 xterm / 테스트용 가짜) | AGENTS §3, 테스트 가능성 |
| K17 | 빠른 연결 입력 | 사용자·호스트·포트 3칸 → **`user@host:port` 한 칸**(IPv6 `[::1]:22`, 붙여 넣은 `ssh -p N user@host`도 해석) | DESIGN §4.1·§5.1 |
| K18 | 흐름 제어 상한 | renderer 미확인 바이트 100KB → **32KB**(재개 8KB). 처리량 변화 없음 | AC17 측정(`docs/perf/baseline.md`) |
| K19 | OSC 7 호스트 판정 | 처음 받은 호스트와 **정확히 같을 때만**(localhost·빈 host 예외 제거). SEC-5 문구 "접속 호스트와 비교"는 접속 주소와 원격 `$HOSTNAME`이 보통 달라 이렇게 구현 | 보안 리뷰 #9 |
| K20 | 셸 통합 설치 범위 | `.bashrc`·`.zshrc`에 더해, bash 로그인 파일이 `.bashrc`를 읽지 않으면 그 파일에도, 로그인 파일이 없으면 `.bash_profile`을 만들어 넣는다 | SSH 로그인 셸은 `.bashrc`를 읽지 않음(테스트 서버에서 확인) |
| K21 | 셸 통합 쓰기 | 임시 파일 + `posix-rename` 원자적 교체, 바꾸기 직전마다 `.btterm-backup`, 1MB 상한, 링크는 대상 파일 수정 | 보안 리뷰 #3·#5 |
| K22 | 명령 기록 입력 | 기록 항목은 `term.paste()`(bracketed paste)로 **입력만** | DESIGN §5.6, SEC-10 |
| K23 | 전송 큐 위치 | core `TransferQueue`(순수) + session host 끝점(로컬 파일·SFTP). 탐색용·전송용 SFTP 채널 분리 | F4.4 |
| K24 | 드롭 업로드 경로 | preload가 `webUtils`로 얻은 경로만 main 허용 목록에 60초 등록 | 보안 리뷰 #1 |
| K25 | 끝난 세션의 비밀 | 재시도하지 않는 실패·포기 시 인증 정보 삭제, 수동 재접속 때 다시 받음(프로필은 재해석, 빠른 연결은 다시 묻기) | 보안 리뷰 #7 |
| K26 | 출시 빌드 개발 변수 | `ELECTRON_RENDERER_URL`·`BTTERM_USER_DATA`는 개발·E2E 빌드에서만. 패키지 스모크는 Chromium `--user-data-dir` | 보안 리뷰 #2 |
| K27 | 패키징 위치 | `pnpm package:win`이 로컬 임시 폴더에서 패키징 후 `client/desktop/release/<버전>/`로 복사 | 일부 드라이브(가상·동기화 폴더 등)에서 electron-builder가 `.asar` 삭제 중 EBUSY |
| K28 | 성능 테스트 | `pnpm test:perf`로 기본 E2E와 분리 | 부하·장비에 민감 |
| K29 | 키 메타데이터 | ssh_config로 가져온 경로 키는 첫 사용 때 형식·지문을 채우고, 이후 지문이 바뀌면 접속 전 `key-changed`(F7.6) | |

## 3. 발생한 문제와 처리

| 문제 | 처리 |
|---|---|
| 테스트 컨테이너에서 root가 btterm 사용자의 sshd 프로세스를 볼 수 없음 | 컨테이너 명령을 `docker exec -u btterm -e HOME=/config`로 실행 |
| OpenSSH 9.8+는 세션 프로세스 이름이 `sshd-session` | 세션 수는 `btterm@pts`로 센다 |
| 연결이 끊긴 뒤 ssh2가 대기 중인 SFTP 요청 콜백을 부르지 않아 전송이 영원히 `running` | SFTP 채널 `close` 때 대기 요청을 모두 실패로 끝냄(통합 테스트로 확인) |
| bash `printf "'c"`가 C 로케일에서 0x80 이상 바이트를 부호 확장 | `& 255`로 하위 8비트만 사용(한글 경로 OSC 7 통합 테스트) |
| SFTP 패널: 늦게 온 목록 응답이 최신 결과·입력 중 경로를 덮어씀 | 마지막 요청만 반영, 입력 중에는 경로란 유지 |
| Windows 명령줄 8191자 제한으로 `check:secrets` 실패 | node로 secretlint를 직접 80개 단위 실행 |
| 개발 환경에서 OS 클립보드가 잠겨(다른 프로세스 점유 추정) 읽기·쓰기가 빈 값 | 붙여넣기 E2E는 main 클립보드를 메모리 대체물로 바꿔 앱 경로만 검증 |
| Playwright 워커가 0xC0000409로 한 번 종료 | 재실행 3회 통과. 환경 일시 문제로 보고 기록만 |
| Electron 44 `clipboard.readText`가 Promise를 반환 | 포트 타입을 `string | Promise<string>`로 |

## 4. 사용자 결정이 필요한 것

| # | 질문 | 선택지 | 권장 |
|---|---|---|---|
| D-A | AC17(대량 출력 중 Ctrl+C 이후 추가분 ≤256KB)이 부하 중에는 넘는다 | ① ssh2를 패치해 쉘 채널 창(2MB)을 줄임(의존성 수정, SFTP 처리량 영향 검토 필요) ② 기준을 "단독 측정"으로 한정 ③ 현 상태 유지 | ② 후 M1.5에서 ① 검토 |
| D-B | 메모리 목표(탭 1개 200MB, 5개 350MB)가 Electron 기본 구성 실측(475/500MB)과 맞지 않음 | ① 목표를 실측 근거로 조정 ② 프로세스 수 줄이기 등 최적화 착수 | ① (고유 메모리 측정 추가 후) |
| D-C | S5 Tabby: 차별점 1~4는 플러그인으로 부분 가능하나 보안 구조(SEC-1·2·7)와 충돌 | 피벗 기준 문구 수정 여부 | 직접 개발 유지, 피벗 시에도 플러그인보다 포크 평가 |
| D-D | 수동 확인 항목 | S4 한글 IME(AC18), 절전 복귀(AC24), S6 SmartScreen, 터미널 호환 체크리스트 수동 항목(사용 로그 수집은 2026-10-23 중단) | 도그푸딩 전에 한 번 |

## 5. S5 Tabby 플러그인 조사 요약

2026-10 조사 시점의 공개 소스·문서 기준이며, 이후 버전에서는 달라질 수 있다. btterm 요구사항과 맞는지만 본 것이고 Tabby 자체에 대한 평가는 아니다.

- MIT, 꾸준히 릴리스됨. Angular 15 기반. 플러그인 API는 `api.ts` 소스가 문서 역할을 하며, 사이드 패널용 공식 확장 지점은 찾지 못함.
- 이미 있는 것: 탭에 붙는 SFTP 패널(전송 큐·충돌 질의는 확인 못 함), OSC 1337 기반 cwd(따라가기는 확인 못 함), 중첩 프로필 그룹, 마스터 비밀번호 Vault.
- 구조: 조사한 버전의 창 설정은 `nodeIntegration: true`, `contextIsolation: false`였고 SSH가 renderer 쪽에서 동작했다 → btterm의 SEC-1·SEC-7 구조와 달라 플러그인으로는 맞출 수 없음.
- 판정: SFTP·서버 트리·키체인은 부분 가능, 도구 패널은 어려움~부분 가능, 보안 구조는 플러그인으로는 어려움(포크 수준).
- 출처: github.com/Eugeny/tabby(HACKING.md, tabby-core/src/api, tabby-ssh sshTab, app/lib/window.ts), 위키(Shell working directory reporting, Vault Encryption), 릴리스 페이지.
