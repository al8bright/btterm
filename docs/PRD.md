# btterm PRD — Windows용 SSH 통합 클라이언트

| 항목 | 내용 |
|---|---|
| 문서 상태 | Draft v0.6 (2026-10-20 Phase 1 보강 반영 — **구현 현황은 부록 D**, 결정은 docs/decisions) |
| 작성일 | 2026-10-20 |
| 작성 방식 | AI 에이전트 10개 관점 검토 결과 통합(기획, 아키텍처, 터미널, Electron, SSH, 보안, 역공학·라이선스, UX, QA, 오픈소스 분석) |
| 대상 플랫폼 | Windows 11 (x64) 우선 출시(M1), macOS(Apple Silicon/Intel) 출시(M2). 설계는 처음부터 크로스플랫폼 |
| 개발 원칙 | TDD(Red→Green→Refactor), Tidy First(구조/행위 커밋 분리), pnpm |

---

## 0. 핵심 결정 요약 (TL;DR)

| # | 결정 | 근거 요약 |
|---|---|---|
| D1 | **MobaXterm 바이너리 역공학(REA 포함)은 하지 않는다.** 클린룸 방식(블랙박스 관찰 → 명세 → 구현)으로 간다. | MobaXterm 약관(Pro 3.8.2·3.9조)의 디컴파일 제한과 저작권법 §101의4(프로그램코드역분석)의 허용 범위를 근거로 판단했다(요약이며 원문이 우선, 법률 자문 아님, 확인 2026-10-20). 필요한 기능은 공개 프로토콜·공개 문서·실행 관찰로 충분해 기술적 실익도 낮다. |
| D2 | **REA는 btterm 자체 빌드 검증용**으로만 쓴다(IPC 노출, 번들 유출 점검 등). | REA의 Windows Ghidra 지원은 실험적이며 npm 배포판은 x64 PE만 지원. |
| D3 | **신규 개발 + Tabby/electerm 참고.** 포크하지 않는다. | 2026-10 조사 시점 기준 Tabby는 Angular 기반, electerm은 JavaScript 기반이고 일부 의존성을 자체 포크로 쓴다. btterm이 원하는 타입·테스트 구조로 바꾸며 1인이 유지보수하는 비용이 학습 이득보다 크다고 판단. 둘 다 MIT라 참고는 자유. |
| D4 | **Electron + React + TypeScript + Vite** 유지. 빌드는 **electron-vite + electron-builder(NSIS)**. | 사용자 역량, xterm.js 생태계. Forge의 Vite 플러그인은 experimental. |
| D5 | **세션(SSH/PTY)은 처음부터 `utilityProcess`에서 실행**하고, 터미널 바이트는 `MessagePort`로 renderer와 직결한다(main 우회). | main 이벤트 루프 보호, 크래시 격리. 나중에 옮기면 IPC 계약을 다시 써야 함. |
| D6 | **ssh2(1.17.x 고정)** 를 엔진으로 쓰되 `SshTransport` 포트 뒤로 숨긴다. 인증서/FIDO 사용자를 위해 **"시스템 OpenSSH로 열기"** 폴백을 둔다. | ssh2는 인증서·sk키·GSSAPI·PQ KEX 미지원, 릴리스 주기 느림. |
| D7 | **@xterm/xterm 6.x + WebGL(LRU 풀) / DOM 폴백 + unicode11.** | 6.0에서 canvas 렌더러 제거, IME 중복 입력 수정. |
| D8 | **M1 저장소는 JSON 파일(스키마 버전 + 마이그레이션 체인, 원자적 쓰기)**, 리포지토리 계층 뒤로 추상화. SQLite는 M2 이후 필요 시 도입(`node:sqlite` 검증은 그때). | 네이티브 모듈 ABI 재빌드 부담 감소, Git 백업 용이. 규모(수십~수백 프로필)에 충분. |
| D9 | **비밀정보는 envelope 암호화**(AES-256-GCM, DEK는 `safeStorage`/DPAPI로 보호). keytar 금지. | M1에서는 safeStorage 단독과 보안 효과가 같지만, **M2 마스터 비밀번호 도입 시 DEK 래핑만 바꾸면 되도록** 미리 구조를 잡는다. keytar는 아카이브됨. |
| D10 | **"터미널 폴더 따라가기"(SFTP ↔ cwd 동기화)를 M1 필수 기능**으로 올린다. M1 방식은 **OSC 7 + 사용자 동의 후 원격에 `~/.config/btterm/shell.sh`를 만들고 rc 파일에는 마커로 감싼 `source` 한 줄만 추가**(백업·제거·멱등), 실패 시 수동 동기화 버튼. | MobaXterm의 대표 차별 기능. 없으면 대체가 성립하지 않음. |
| D11 | **M1은 "핵심 흐름"만**, 다듬기 기능은 M1.5로 분리한다. | 1인 TDD 기준 원안 M1은 14주 이상으로 추정(critic). |
| D12 | **설계는 Windows + macOS, 출시는 Windows(M1) → macOS(M2).** OS 의존 코드(agent, 경로, 단축키, 로컬 셸, 가져오기)는 `platform` 어댑터로 분리하고 ESLint로 강제한다. macOS 테스트는 M2에 Mac 기기에서(D15). | 사용자가 Mac에서 Termius 사용 중. Electron은 양쪽 모두 같은 Chromium이라 xterm 렌더링·IME가 일관됨(Tauri는 Mac에서 WKWebView라 IME 위험). |
| D13 | **Identity(사용자명+자격증명 묶음)와 Group 기본값 상속을 M1 스키마에 포함**한다. M1 UI는 port·identity 상속과 "상속됨" 표시만. | Termius의 핵심 UX. 나중에 넣으면 스키마 마이그레이션 비용이 큼. 상속 해석은 순수 함수라 TDD 용이. |
| D14 | **M1 기간은 최대 12주**(개발 8~9 + 도그푸딩 2 + 버퍼 1). 3주차에 워킹 스켈레톤, E2E 스모크는 그 시점부터 `pnpm verify:full`. | 8주 안에 도그푸딩 2주가 들어 있어 구현이 6주뿐이었음(문서 검토 C2·C3). |
| D15 | **저장소는 public(MIT 라이선스, 2026-11-26), 릴리스 바이너리는 본인 사용 전용. `main` 단일 브랜치, PR·CI(GitHub Actions) 없음** — 검증은 로컬 `pnpm verify`(커밋 게이트)·`pnpm verify:full`(통합·E2E) + git 훅. | 바이너리 공개 배포 전 조건(마스터 비밀번호 §6.2, 지식재산 검토 §9.6, 서명 §10)은 유지. 1인 개발에 PR·CI 운영 비용이 이득보다 큼(사용자 결정). 소스 공개는 사용자 결정([공개 범위](./decisions/2026-11-26-public-scope.md)) |
| D16 | **명령 기록 검색은 M1에서 입력만**, 실행(Shift+Enter)은 셸 통합으로 프롬프트 상태를 알 수 있는 M1.5부터. | 원격 파일 내용의 즉시 실행 위험(문서 검토 C8). |
| D17 | ~~**계정·동기화(F8)를 M2(Phase 2-S)로 당긴다.** 계정, 동기화 서버, 비밀까지 **종단간 암호화**(서버는 내용을 볼 수 없음), 마스터 비밀번호 하나로 로그인·암호화. 로그인은 선택이며 로그인 없이도 로컬로 전부 동작한다~~ → **폐기(2026-11-26): 범위 밖으로 옮기고(나중에 다시 검토) 코드를 제거했다**([공개 범위](./decisions/2026-11-26-public-scope.md)) | 어느 컴퓨터에서든 같은 서버 목록·설정을 쓰려는 사용자 요청(2026-10-23). 개인 도구에 서버 운영이 필요 없어 뺐다(2026-11-26) |

---

## 1. 배경과 문제 정의

Windows에서 여러 Ubuntu 서버를 관리하는 개발자는 "접속 → 셸 작업 → 파일 전송"을 한 창에서 끊김 없이 처리하길 원한다. MobaXterm이 이 역할을 해 왔지만, 내가 쓰면서 불편했던 점이 있다(개인 사용 경험 기준):

- 무료판 제약과 유료 Pro 구분
- 대량 출력이나 SFTP 작업 중 멈추거나 느려지는 일을 겪었다
- 탭이 10개가 넘는 세션 설정 다이얼로그가 익히기 어려웠다
- 설정이 `.ini`/레지스트리에 흩어져 Git 백업·이전이 번거로웠다

**문제 문장:** Windows 개발자가 여러 리눅스 서버에 안전하게 접속해 셸 작업과 파일 전송을 하나의 흐름으로 처리할 수 있는, 가볍고 현대적이며 스스로 통제할 수 있는 클라이언트가 없다.

**북극성:** 개발자 본인의 MobaXterm 사용을 100% 대체한다(N=1 dogfooding 제품).

## 2. 사용자와 시나리오

### 2.1 페르소나

| 구분 | 페르소나 | 특징 |
|---|---|---|
| 1차 | 본인: 풀스택/인프라 겸업 개인 개발자 | Windows 11, Ubuntu 서버 수~수십 대, 키 인증, vim, 로그 확인, 배포 파일 업로드 |
| 2차(잠재) | 소규모 팀 인프라 담당 | 서버 목록 공유, 점프 서버, 다수 서버 동시 명령 |
| 비대상 | RDP 중심 Windows 서버 관리자, 시리얼/텔넷 네트워크 엔지니어 | 기존 도구 유지가 합리적 |

### 2.2 Jobs-to-be-done

| ID | Job | 마일스톤 |
|---|---|---|
| J1 | 서버 이름 몇 글자로 2초 안에 셸 진입 (검색, 고정) | M1 |
| J2 | `cd` 하면 옆 SFTP 패널이 따라오고, 드래그로 업/다운로드 | M1 |
| J3 | 원격 파일을 로컬 에디터로 열고 저장 시 자동 업로드 | M2 |
| J4 | 여러 서버를 나란히 두고 같은 명령을 한 번에 입력 | M2 |
| J5 | 절전·VPN 재연결 후 세션 자동 복구 | M1 |
| J6 | 자격증명은 안전하게 보관, 호스트 키 변경 시 차단 | M1 |

## 3. 범위

### 3.1 마일스톤

| 단계 | 기간(추정) | 범위 | 종료 기준 |
|---|---|---|---|
| **M0 기반·검증** | 1~2주 | pnpm 모노레포, 로컬 검증 스크립트·git 훅, 린트/테스트 하네스. **본인 MobaXterm 사용 로그 1주 기록**(어떤 기능을 실제로 쓰는지). **기술 스파이크**: ① utilityProcess ↔ renderer MessagePort 직결 경로 ② ssh2(`cpu-features` 제외) Electron 번들 동작 + Windows OpenSSH agent named pipe ③ Fuses 적용 빌드에서 Playwright 실행 가능 여부 ④ xterm 6 + MS 한글 IME 조합 입력 | 스파이크 결과 1장, 사용 로그, `pnpm verify:full` 통과 |
| **M1 핵심 흐름** | 최대 12주(개발 8~9 + 도그푸딩 2 + 버퍼 1) | §3.2의 **Must** 기능 | **M1 기능 범위 안의 작업에서** 2주 연속 MobaXterm 실행 0회 |
| **M1.5 다듬기** | 2~3주 | §3.2의 **Polish** 기능(MobaXterm 가져오기, 명령 팔레트 확장, 단축키 재지정, 온보딩, en 번역, 복붙 프리셋 2종, 풀 E2E·성능 측정 스크립트) | 전체 일상 작업에서 MobaXterm 0회 |
| **M2 생산성 + macOS** | 6~8주 | **macOS 출시**(§5.6), Workspace 템플릿(분할 저장·복원), MultiExec, 원격 파일 편집/자동 업로드, 포트 포워딩(L/R/D), ProxyJump, 마스터 비밀번호, PPK v3 변환, Pageant(named pipe), 로컬 PowerShell/WSL 탭(node-pty 스파이크 포함), SQLite 필요성 재검토 | J3/J4 체크리스트 통과 |
| **M3 확장** | 미정 | 세션 로그 저장, 스니펫, 서버 대시보드 탭, 설정 내보내기, X11(외부 X 서버 연동), RDP(`mstsc.exe` 위임) | 필요 시 착수 |

### 3.2 기능 요구사항

우선순위: **Must(M1)** / **Polish(M1.5)** / **Should(M2)** / **Could(M3)**

> M0 사용 로그에서 ProxyJump·포트 포워딩·로컬 셸을 일상적으로 쓰는 것으로 확인되면 해당 항목을 M1 Must로 승격한다.

#### F1. 서버(프로필) 관리
| ID | 요구사항 | 우선 |
|---|---|---|
| F1.1 | 프로필 CRUD: 이름, 호스트, 포트, 사용자/자격증명(직접 입력 또는 **Identity 선택**), 그룹, 태그, 탭 색상. 그룹에서 상속된 값은 흐리게 "상속됨: Prod" 표시 + [재정의] | Must |
| F1.1b | Identity CRUD(라벨, 사용자명, 자격증명) | Must |
| F1.2b | 빈 화면 서버 카드: 탭이 없는 칸에 고정·최근 접속 서버 최대 8개 — 2026-10-22 추가([DF](./decisions/2026-10-22-daily-features.md) DF4) | Must |
| F1.2 | 그룹 트리(중첩) + 퍼지 검색. 즐겨찾기는 고정(pin)으로 대체. 사이드바 "최근 접속" 구역은 두지 않는다(사용자 결정 2026-10-21, 접속 시각 기록은 유지) | Must |
| F1.2a | 서버 트리 끌어 놓기: 서버·그룹을 끌어 그룹 안으로 넣거나 빼고, 같은 단계에서 순서를 자유롭게 바꾼다(그룹과 서버가 한 순서를 공유). 그룹을 자기 하위로는 옮길 수 없다. 검색 중에는 끌 수 없다(사용자 요청 2026-10-21) | Must |
| F1.8 | 그룹 기본값 편집 UI(port, identity, keepalive, 탭 색, 컬러스킴, startup command) | Polish |
| F1.9 | 태그 다중 AND 필터, 퍼지 검색에 태그 포함 | Polish |
| F1.11 | **서버·그룹 아이콘 변경**: 내장 아이콘 세트(서버, 웹, DB, 컨테이너, 라우터, 클라우드 등 — Lucide 등 MIT 라이선스)에서 선택 + 아이콘 색상. 그룹에 지정하면 하위 서버가 상속(`HostDefaults.icon`) | Must |
| F1.12 | 사용자 이미지 아이콘(PNG/SVG ≤ 256KB, SVG는 스크립트·외부 참조 제거 후 저장) | Polish |
| F1.13 | 접속 시 `/etc/os-release`로 OS를 감지해 아이콘 제안(Ubuntu, Debian, RHEL 등). 배포판 로고는 상표 사용 조건 확인 후 단순 글리프로 | Should |
| F1.3 | 퀵커넥트 `user@host:port` → 접속 후 "저장?" 토스트 | Must |
| F1.4 | **가져오기**: `~/.ssh/config`(Host 패턴, HostName, Port, User, IdentityFile, ServerAlive*, Include). 아직 미지원인 지시어(ProxyJump, *Forward 등)는 **값을 보존하고 ⚠ "M2 지원 예정"으로 표시** | Must |
| F1.5 | **가져오기**: MobaXterm 세션(`MobaXterm.ini` `[Bookmarks*]`, `.mxtsessions`). **비밀번호는 가져오지 않음**을 UI에 명시 | Polish |
| F1.6 | 가져오기: PuTTY 세션(레지스트리) | Should |
| F1.7 | 프로필 내보내기/가져오기(JSON, 비밀정보 제외) | Polish |
| F1.10 | `ssh_config`·Termius 호환 CSV로 내보내기(Mac Termius와 서버 목록 공유) | Could |

#### F2. SSH 연결
| ID | 요구사항 | 우선 |
|---|---|---|
| F2.1 | 인증: 비밀번호, 공개키(OpenSSH/PEM, 암호화 키), keyboard-interactive(OTP) | Must |
| F2.2 | 인증: Windows OpenSSH agent(`\\.\pipe\openssh-ssh-agent`) | Must |
| F2.3 | **호스트 키 검증**: `hostVerifier` 필수 구현. 신규 시 SHA256 지문 확인, **변경 시 기본 차단**. 저장된 키가 있는데 제시된 키와 일치하는 것이 없으면 종류가 달라도 차단하고(종류 다운그레이드 방지. OpenSSH는 이 경우 확인창으로 묻지만 더 엄격하게 한다. 키 종류가 다른 서버 여러 대가 한 주소 뒤에 있으면 막히므로 알려진 호스트 관리에서 항목을 지운다), 연결 때 알려진 키 종류를 먼저 협상한다. 호스트 이름은 OpenSSH처럼 소문자로 비교한다 | Must |
| F2.4 | known_hosts 읽기(평문, `[host]:port`, 해시 `\|1\|`, 와일드카드). 쓰기는 앱 전용 파일 | Must |
| F2.4b | Known Hosts 관리 화면(목록, 지문 보기, 삭제) | Polish → 지금([TR](./decisions/2026-10-22-transfer-keys-release.md) TR6) |
| F2.5 | keepalive 기본 15~30초, 끊김 감지, 지수 백오프 자동 재접속(최대 5회, 2FA 연결은 프롬프트) | Must |
| F2.6 | 하나의 SSH 연결에서 셸 + SFTP 채널 공유 | Must |
| F2.6b | MaxSessions 초과 시 추가 연결 폴백(AC19) | Polish |
| F2.7 | ProxyJump 체인(홉별 호스트 키 검증, 트리형 수명주기) | Should |
| F2.8 | 포트 포워딩 L/R/D. 바인드 기본값 `127.0.0.1`. 규칙을 저장 엔티티로 관리(목록에서 토글), 첫 사용 시 마법사 | Should |
| F2.9 | PPK v2/v3 → OpenSSH 변환 가져오기 | Should |
| F2.10 | Pageant(named pipe) 커스텀 agent | Should |
| F2.11 | "시스템 OpenSSH(ssh.exe)로 열기" 폴백 세션(인증서, FIDO, GSSAPI용) | Should |
| F2.12 | SOCKS5/HTTP CONNECT 프록시 경유 | Could |
| F2.13 | X11 포워딩(외부 VcXsrv 등 필요) | Could |

#### F3. 터미널
| ID | 요구사항 | 우선 |
|---|---|---|
| F3.1 | 탭 터미널(xterm 6, `xterm-256color`, truecolor), 탭 상태 점(연결/재접속/끊김) | Must |
| F3.1b | 탭 이름 바꾸기(더블클릭·메뉴·F2, 이 실행 동안만) — 2026-10-22 추가([DF](./decisions/2026-10-22-daily-features.md) DF3) | Must |
| F3.2 | 리사이즈: ResizeObserver → fit → 100ms 디바운스 → 값이 바뀐 경우만 `setWindow` | Must |
| F3.3 | 한글: unicode11 활성화, IME 조합 입력(입력 경로는 `term.onData` 단일), D2Coding 등 정폭 한글 폰트 기본 | Must |
| F3.4 | 흐름 제어: renderer ACK 기반 HIGH/LOW 워터마크 → `stream.pause()/resume()` | Must |
| F3.5 | WebGL 렌더러는 **보이는 터미널에만**(단일 탭 1개, 분할 시 최대 4개), context loss 시 DOM 폴백. (Workspace 도입 시 LRU 풀 ~8로 확장 → M2) | Must |
| F3.6 | 스크롤백 기본 10,000줄, 상한 50,000줄 | Must |
| F3.7 | 검색(addon-search), URL 클릭(http/https만, 확인창) | Must |
| F3.8 | 복사/붙여넣기: MobaXterm 스타일(선택=복사, 우클릭=붙여넣기, Ctrl+Shift+C/V). **Ctrl+C는 항상 터미널로 전달** | Must |
| F3.8b | Windows 스타일 프리셋 추가, "선택 있으면 Ctrl+C=복사" 옵션(기본 OFF) | Polish |
| F3.9 | 붙여넣기는 `term.paste()` 경유(bracketed paste), 제어문자 제거, 여러 줄 경고 | Must |
| F3.10a | **탭 그룹 분할**(M1, 2026-10-20 사용자 요청으로 M2에서 이동, VS Code식): 작업 영역은 칸(탭 그룹) 1~8개로 나뉘고 **칸마다 자기 탭바**가 칸 바로 위에 있다(위쪽 전체 탭바 없음). 탭이 2개 이상이면 탭을 끌어 칸 가장자리(좌·우·위·아래)에 놓아 새 칸을 만들고, 칸 가운데나 다른 칸 탭바에 놓아 그 칸으로 옮긴다. **나뉜 칸을 다시 좌우·위아래 어느 쪽으로든 나눌 수 있다(중첩 분할)**, 같은 묶음 안은 균등 분할, 클릭한 칸이 활성(키 입력 대상), 새 연결은 활성 칸에 열린다. 빈 칸은 사라진다. 탭 우클릭 메뉴로 분할·칸 합치기, 같은 탭바 안에서 끌면 순서 변경 | Must |
| F3.10 | Workspace 템플릿(호스트 묶음 한 번에 열기, 분할 레이아웃·cwd 저장·복원). 칸 크기 조절은 M1로 당김(F3.10b) | Should |
| F3.10b | 칸 크기 조절(경계 끌기·키보드), 칸 사이 포커스 이동, 탭 번호 이동, 같은 서버로 분할(UX 검토 U4, 2026-10-21) | Must |
| F3.14 | 스니펫: 패키지(폴더), `{{var}}` 입력 프롬프트, "실행 / 입력만 / 모든 탭에서 실행"(MultiExec 재사용). production 태그 서버의 `sudo` 스니펫은 실행 전 확인. **F3.15 패널의 스니펫 탭으로 제공** | Should (1단계는 지금으로 당김, [DF](./decisions/2026-10-22-daily-features.md) DF7. "모든 탭에서 실행"은 M2) |
| F3.15 | **터미널 도구 패널**: 활성 터미널 오른쪽 끝의 접이식 손잡이(또는 Ctrl+Shift+L)로 여닫는 340px 패널. 탭 3개: 디자인 / 검색 / 스니펫. 열린 상태와 마지막 탭을 기억 | Must |
| F3.16 | **디자인 탭**: 내장 터미널 테마 3종(btterm Dark, One Dark, GitHub Light — `ITheme` 전 필드 JSON, `minimumContrastRatio` 4.5 기본 ON) 미리보기 카드, 글꼴(정폭 한글 지원 우선), 크기, 커서 모양. 선택 즉시 현재 탭에 미리보기. 적용 범위: 이 탭만 / 전체 기본값 | Must |
| F3.16c | 테마 추가(Dracula, Solarized Dark, Gruvbox Dark — 2026-10-22 Solarized Light·Nord·Monokai와 함께 지금으로 당김, [DF9](./decisions/2026-10-22-daily-features.md)), 적용 범위 이 서버 / 그룹 기본값(`HostDefaults.colorScheme`·`font` 상속) | Polish |
| F3.16b | 테마 가져오기(.itermcolors, Windows Terminal JSON), 사용자 테마 편집 | Polish |
| F3.17a | **검색 탭(1단계)**: 원격 `~/.bash_history`(zsh는 `~/.zsh_history`)를 기존 SFTP 채널로 읽어 퍼지 검색. 현재 서버만, 메모리에서만 사용(디스크 저장 없음). 형식: bash `HISTTIMEFORMAT`(`#epoch` 줄), zsh extended history(`: epoch:0;cmd`, metafy 역변환), UTF-8→EUC-KR 폴백, 끝부분 2MB 상한, 중복은 최신만. 비밀 패턴은 session host에서 가린 뒤 표시. **Enter=커서 위치에 입력만**(제어문자·개행 제거, alternate buffer에서는 비활성). 실행은 F3.17(M1.5). 파일 없음·권한 없음은 빈 상태로 안내 | Must |
| F3.17 | **검색 탭(2단계)**: btterm이 셸 통합으로 기록한 명령(명령 텍스트·서버·시각·종료 코드·횟수) + 원격 `~/.bash_history`(SFTP로 읽기, 선택) 통합 퍼지 검색. 필터: 이 서버 / 모든 서버 / 출처. Enter=프롬프트에 입력만, Shift+Enter=실행 | Polish |
| F3.17b | 명령 기록 보호: 앱 데이터에 envelope 암호화 저장, 공백으로 시작한 명령(`HISTCONTROL=ignorespace` 관례)·비밀번호 패턴 인자 미기록, 서버별 기록 끄기·삭제 | Polish |
| F3.18 | **서버 상태 줄**(M1, 2026-10-20 사용자 요청): 칸(연결 창)마다 터미널 아래에 그 칸 선택 세션 서버의 OS, CPU 사용률, RAM(사용/전체), 네트워크(업로드·다운로드 속도), 가동 시간(일), 로그인 아이디, 디스크(`/` 사용/전체)를 표시. 같은 SSH 연결의 exec 채널로 **고정된 읽기 전용 스크립트**를 3초마다 실행(보이는 ready 세션만, 저장하지 않음). Linux `/proc` 기준, 없는 항목은 "—". 칸 폭을 넘으면 스크롤바 없이 좌우 버튼으로 넘겨 본다. **서버(또는 그룹)별 켜기/끄기**, 정하지 않으면 `production`·`prod` 태그 서버는 끔(빠른 연결은 켬) | Must |
| F3.11 | MultiExec(확정된 입력만 브로드캐스트, 대상 탭 강조) | Should |
| F3.12 | 로컬 PowerShell/WSL(node-pty, ConPTY, UTF-8 강제) | Should |
| F3.13 | 세션 로그(raw/plain, headless xterm 기반, 기본 OFF). 로컬 저장, 개수 제한 없음(로테이션), 내보내기 가능 | Could |

#### F4. SFTP
| ID | 요구사항 | 우선 |
|---|---|---|
| F4.1 | 활성 탭에 연동된 SFTP 사이드바: 브레드크럼(직접 편집), 목록(이름/크기/수정일/권한), 숨김 토글 | Must |
| F4.2 | 업로드/다운로드/이름변경/삭제/새 폴더/권한 변경 | Must |
| F4.3 | 탐색기에서 드래그앤드롭 업로드, 충돌 시 덮어쓰기/건너뛰기/이름변경 (항목별 질의) | Must |
| F4.3b | 충돌 처리 "모두 적용" | Polish |
| F4.4 | 전송 큐: 진행률·속도·ETA, 취소/재시도, 동시 3개, 전송 전용 SFTP 채널 분리 | Must |
| F4.5 | **터미널 폴더 따라가기**: OSC 7 수신(host가 접속 호스트와 같을 때만). 사용자 동의 후 `~/.config/btterm/shell.sh` 생성 + rc(`.bashrc`, 로그인 셸 파일이 이를 source하는지 검사 / `${ZDOTDIR:-~}/.zshrc`)에 `# >>> btterm >>>` 마커로 감싼 `source` 한 줄 추가. 기존 `PROMPT_COMMAND`·OSC 7 도구와 공존, 기록 전 백업(백업·임시 파일은 원본 권한으로 배타 생성, 새 파일은 600), 제거 기능. 미설치·불가 셸은 ⚠ 표시 | Must |
| F4.5b | 수동 동기화 버튼("터미널 경로로 이동") | Must |
| F4.5d | 셸 통합 스니펫 확장: `preexec`/`PROMPT_COMMAND`에서 실행 명령과 종료 코드를 OSC 133(+명령 텍스트)로 보고 → F3.17 명령 기록의 데이터 원천 | Polish |
| F4.5c | OSC 133 / OSC 9;9 수신, 무설정 자동 감지. 대안으로 exec 채널 cwd 조회(Termius 방식 추정, bash 한정·MaxSessions 위험) 스파이크 | Should |
| F4.6 | SFTP → 터미널 역방향 `cd` | Should |
| F4.7 | 이어받기(`.part` + `posix-rename`), 폴더 재귀 전송 | Should → 지금([TR](./decisions/2026-10-22-transfer-keys-release.md) TR1·TR2) |
| F4.8 | 원격 파일 로컬 편집: 확장자별 "Open with" 앱 기억, 변경 감지 후 업로드 확인 | Should → 지금([TR](./decisions/2026-10-22-transfer-keys-release.md) TR3, "Open with" 기억은 나중) |
| F4.9 | 세션별 파일명 인코딩(EUC-KR 레거시) | Could |
| F4.10 | 원격↔원격 듀얼 패널 전송 | Could |

#### F5. 앱 공통
| ID | 요구사항 | 우선 |
|---|---|---|
| F5.1 | 서버 빠른 검색(Ctrl+Shift+K, 퍼지). 빠른 연결 칸에서 저장된 서버를 퍼지 검색해 Enter로 접속하고, 맞는 서버가 없으면 `user@host`로 접속. 새 탭(+, Ctrl+Shift+T)은 이 목록을 연다(UX 검토 U3) | Must |
| F5.1b | 명령 팔레트 확장(Ctrl+Shift+P; `>` 명령, `#` 탭) | Polish → 지금([DF](./decisions/2026-10-22-daily-features.md) DF6) |
| F5.2 | 고정 키맵(DESIGN §8.1이 원천). Ctrl+Shift 계열만 사용, Electron 기본 메뉴 제거 | Must |
| F5.2b | 단축키 재지정·충돌 감지 | Polish |
| F5.3 | 다크/라이트/시스템 테마, UI 테마와 터미널 컬러스킴 분리 | Must |
| F5.4 | i18n 키 분리 구조 + ko 단일 | Must |
| F5.4b | en 번역 | Polish |
| F5.5 | 웰컴/온보딩 | Polish |
| F5.6 | ~~자동 업데이트(electron-updater)~~ | 제외(2026-11-26, 범위 밖·나중에 다시 검토, [공개 범위](./decisions/2026-11-26-public-scope.md)) |
| F5.7 | 접근성: 포커스 트랩, ARIA tree/tablist, `screenReaderMode` 옵션 | Should |

#### F6. 운영·데이터 무결성
| ID | 요구사항 | 우선 |
|---|---|---|
| F6.1 | 단일 인스턴스(`app.requestSingleInstanceLock()`), 두 번째 실행은 기존 창 포커스 | Must |
| F6.2 | 저장 파일 원자적 쓰기(임시 파일 → rename), 직전 `.bak` 보관, 손상 감지 시 복구 다이얼로그 | Must |
| F6.3 | 스키마 마이그레이션 체인(순수 함수, 버전별 단위 테스트). 상위 버전 파일은 읽기 전용으로 열고 경고 | Must |
| F6.4 | 앱 로그: `%APPDATA%\btterm\logs`, 일 단위 로테이션 7일, 레벨 설정, "로그 폴더 열기" 메뉴 | Must |
| F6.5 | 연결 오류 분류별 메시지와 다음 행동: DNS 실패 / 연결 거부 / 타임아웃 / 인증 실패 / 호스트 키 / 키 암호 오류 / agent 미실행 | Must |
| F6.6 | 절전 복귀·잠금 해제(`powerMonitor` `resume`/`unlock-screen`) 시 연결 상태 점검 → 재접속 트리거, WebGL 컨텍스트 유효성 검사(손실 시 재생성/DOM 폴백) | Must |
| F6.7 | 일반 설정(환경설정)은 프로필과 별도 파일. 창 위치·크기 복원 | Must |
| F6.8 | 키 passphrase 캐시: 앱 실행 동안 메모리 보관(옵션), 디스크 저장은 사용자 선택 | Must |
| F6.9 | 앱 재시작 시 이전 탭 복원(재접속은 사용자 확인) | Should → 지금([DF](./decisions/2026-10-22-daily-features.md) DF8) |
| F6.10 | 새 버전 첫 실행 시 마이그레이션 전 데이터 폴더 스냅샷 | Must |
| F6.10b | 하위 버전으로 실행 시 읽기 전용 + 경고 | Polish |
| F6.11 | 호스트별 startup command(연결 직후 1회 실행, 그룹 상속 가능) | Polish → 지금([DF](./decisions/2026-10-22-daily-features.md) DF5) |

#### F7. 키체인(개인키 관리)
| ID | 요구사항 | 우선 |
|---|---|---|
| F7.1 | 개인키 등록 — **두 가지 방식 중 선택**: ① **경로 참조**(기본, 예: `~/.ssh/id_ed25519`. 파일은 그대로 두고 경로만 저장) ② **가져오기**(키 내용을 vault에 envelope 암호화해 저장, 원본 파일이 없어도 동작) | Must |
| F7.2 | 키 텍스트 붙여넣기로 등록(가져오기 방식). 입력란은 저장 직후 비움 | Must |
| F7.3 | 지원 형식: OpenSSH(`-----BEGIN OPENSSH PRIVATE KEY-----`), PEM(RSA/EC), 암호화된 키. 등록 시 형식·키 타입·비트 수를 즉시 검증하고 실패 이유 표시 | Must |
| F7.4 | 키 암호(passphrase): 연결 시 프롬프트 → "이 세션 동안 기억"(메모리) / "vault에 저장"(사용자 선택) / 매번 입력 | Must |
| F7.5 | 키 상세: 공개키 표시·복사, SHA256 지문, 키 타입, 이 키를 쓰는 Identity·서버 목록 | Must |
| F7.6 | 경로 참조 키 파일이 사라지거나 바뀌면(지문 변화) 연결 전 경고 | Must |
| F7.7 | 키 쌍 생성(ed25519 기본, RSA 4096 선택, passphrase 옵션), 공개키·개인키 파일로 내보내기 | Polish → 지금([TR](./decisions/2026-10-22-transfer-keys-release.md) TR4) |
| F7.8 | "서버에 공개키 등록": 열린 세션으로 `~/.ssh/authorized_keys`에 추가(중복 검사, `~/.ssh` 700 / 파일 600 권한 확인) — `ssh-copy-id` 대체 | Polish → 지금([TR](./decisions/2026-10-22-transfer-keys-release.md) TR5) |
| F7.9 | PuTTY `.ppk`(v2/v3) 가져오기 → OpenSSH 형식으로 변환 저장 (F2.9와 동일 항목) | Should |
| F7.10 | 하드웨어 키(FIDO/sk)·인증서 키 → ssh2 미지원이므로 "시스템 OpenSSH로 열기"(F2.11) 안내 | Should |

**키 보안 규칙** (§6.1 Must에 포함): 가져온 개인키와 passphrase는 renderer로 전달하지 않는다(renderer는 공개키·지문·ID만). 데이터 폴더 어디에도 평문 개인키가 존재하지 않는다(AC26). 경로 참조 방식은 원본 파일 보호를 OS에 맡긴다는 점을 화면에 안내한다.

#### F8. 계정·동기화 — 제외(2026-11-26, 범위 밖)

> 2026-11-26 범위에서 뺐다(구현한 코드도 제거). 아래 요구사항은 나중에 다시 검토할 때의 출발점으로만 남긴다([공개 범위](./decisions/2026-11-26-public-scope.md), D17).

| ID | 요구사항 | 우선 |
|---|---|---|
| F8.1 | 로그인은 선택. 로그인하지 않으면 지금처럼 로컬로 전부 동작하고, 로그인하면 로컬 데이터를 계정으로 올리거나 계정 데이터와 합친다 | 제외 |
| F8.2 | 가입: 초대 코드 없이 앱에서 아이디 + 마스터 비밀번호로 바로 가입(서버는 가입·로그인 시도 제한, 계정당 저장 한도, 관리자 CLI로 정지·삭제). 가입 때 복구 키를 보여 주고 보관을 확인받는다(건너뛸 수 없음) | 제외 |
| F8.3 | 마스터 비밀번호에서 기기 안에서 키를 파생(내장 scrypt — Electron BoringSSL에 Argon2 없음). 서버에는 파생한 인증 값만 보낸다. 모든 동기화 레코드는 계정 키로 AES-256-GCM 암호화(AAD = 레코드 ID·종류·버전) | 제외 |
| F8.4 | 동기화 대상: 그룹·서버·Identity·Credential·비밀·가져온 키·알려진 호스트·스니펫·계정 설정. 기기 전용(창 상태·마지막 세션·로컬 경로)과 명령 기록은 제외. 경로 참조 키는 경로만 넘기고 없으면 안내 | 제외 |
| F8.5 | 오프라인 우선: 서버에 닿지 않아도 모든 기능이 동작하고, 연결되면 변경분을 주고받는다. 같은 레코드 충돌은 나중 것을 반영하고 앞의 것은 "(충돌 사본)"으로 남긴다 | 제외 |
| F8.6 | 잠금: 한 번 잠금 해제하면 계정 키를 `safeStorage`로 감싸 기기에 보관. 유휴·화면 잠금 시 자동 잠금은 설정. 마스터 비밀번호 변경·복구 키로 재설정 | 제외 |
| F8.7 | 기기 목록·해제(토큰 폐기), 로그아웃 시 이 기기의 계정 데이터 삭제 선택, 상태 줄에 동기화 상태 표시 | 제외 |
| F8.8 | 서버 연결은 HTTPS만, 앱에 인증서 지문 고정. 서버 통신은 main에서만 하고 renderer는 서버 주소·토큰·키를 모른다 | 제외 |

### 3.3 비목표 (Non-goals)

- X11 서버, RDP/VNC 엔진 **내장** (M3에서 외부 도구 연동만 검토)
- 시리얼, Telnet, Mosh 등 SSH 외 프로토콜
- Linux 빌드 (macOS는 M2 출시)
- 팀 공유 서버 목록·권한 관리, 계정·동기화(F8, 2026-11-26 제외), 외부 클라우드 동기화 서비스
- 플러그인 마켓플레이스
- **MobaXterm 바이너리 디컴파일/디스어셈블, MobaXterm.ini 저장 비밀번호 복호화**
- MobaXterm의 시각적 정체성(아이콘, 색상, 메뉴 배치) 재현

## 4. UX

### 4.1 레이아웃

```
┌──────────────────────────────────────────────────────────────────┐
│ btterm   [ Quick connect: user@host:22 ⏎ ]          [🔍] [⚙]     │
├──┬───────────────┬───────────────────────────────────────────────┤
│🖥│ SERVERS    [+]│ ● web-01 ×│ ◐ db-01 ×│ [+]                       │
│📁│ 📌 web-01     ├───────────────────────────────────────────────┤
│⇅ │ ▾ Prod        │ ubuntu@web-01:~/app$                          │
│  │  ├ db-01      │                                               │
│  │ ▸ Staging     │            (xterm.js 터미널)                   │
│  │───────────────│                                               │
│  │ SFTP web-01   │                                               │
│  │ /home/ubuntu/ │                                               │
│  │ [🔗 따라가기] │                                               │
├──┴───────────────┴───────────────────────────────────────────────┤
│ ● web-01 10.0.0.5 | ed25519 | 23ms | UTF-8 | ⇅ 2 전송중           │
└──────────────────────────────────────────────────────────────────┘
```

- 액티비티 바: 서버 / SFTP / 전송 큐 / (M2) 터널. 2차 기능의 자리를 미리 비워 둔다.
- 기능 밀도는 MobaXterm 수준을 유지하되 화면은 단순하게, 고급 기능은 명령 팔레트 뒤로.

### 4.2 핵심 플로우

| 플로우 | 요점 |
|---|---|
| 첫 실행 | 소스 자동 탐지(`~/.ssh/config`, MobaXterm, PuTTY) → 미리보기 체크리스트 → 중복 처리 → 요약 |
| 신규 호스트 키 | 지문(SHA256, 키 타입) + [취소] [이번만] [신뢰하고 저장⏎] |
| 호스트 키 변경 | 빨간 경고, 이전/새 지문 비교, 기본 포커스 [취소], 교체는 체크박스 확인 후 활성 |
| 연결 끊김 | 터미널 내용 유지 + 반투명 배너("[R] 재접속 · [Esc] 닫기"), 탭 점 ◐, 재접속 성공 시 SFTP 경로 복원 |
| 드래그 업로드 | SFTP 패널 드롭 → 현재 폴더 / 터미널 드롭 → "cwd로 업로드?" 오버레이 |

### 4.3 단축키

| 동작 | 키 |
|---|---|
| 서버 검색·퀵커넥트 / 명령 팔레트(M1.5) | Ctrl+Shift+K / Ctrl+Shift+P |
| 새 탭 / 닫기 | Ctrl+Shift+T / Ctrl+Shift+W |
| 탭 이동 / 번호로 이동 | Ctrl+Shift+PgUp / Ctrl+Shift+PgDn / Ctrl+Shift+1~9 |
| 칸 포커스 이동 / 칸 크기 조절 / 같은 서버로 오른쪽 분할 | Ctrl+Alt+방향키 / Ctrl+Alt+Shift+방향키 / Ctrl+Shift+D |
| 복사 / 붙여넣기 | Ctrl+Shift+C / Ctrl+Shift+V (+ Ctrl+Insert / Shift+Insert) |
| 사이드바 / SFTP 포커스 | Ctrl+Shift+B / Ctrl+Shift+E |
| 검색 / 재접속 | Ctrl+Shift+F / Ctrl+Shift+R |
| 터미널 도구 패널 / 명령 기록 검색 | Ctrl+Shift+L / Ctrl+Shift+H |

**단축키의 단일 원천은 `docs/DESIGN.md` §8.1이다. 아래는 요약이며, 다르면 DESIGN이 맞다.** 앱 단축키는 Ctrl+Shift 계열만 사용하고, Ctrl+(문자)·Alt+(문자)·Ctrl+Tab은 모두 터미널로 전달한다(readline, tmux, mc의 Meta 키 보호). 원격 앱이 마우스 추적 모드면 우클릭은 원격으로, Shift+우클릭은 강제 붙여넣기.

## 5. 아키텍처

### 5.1 프로세스 구조

```
┌──────── Renderer (React, sandbox, contextIsolation) ─────────┐
│ UI(서버 트리, 탭, SFTP)    TerminalView(xterm + WebGL)         │
│        │ control (invoke)          ▲ data (MessagePort)        │
└────────┼───────────────────────────┼───────────────────────────┘
         │ preload: window.btterm.{profiles,sessions,sftp}
┌────────▼──────── Main (얇게) ──────┼───────────────────────────┐
│ WindowManager · IPC Router(zod) · ProfileRepo(JSON)            │
│ CredentialVault(safeStorage) · Port Broker(MessageChannelMain) │
└────────┬───────────────────────────┼───────────────────────────┘
         │ control (parentPort)      │ port 전달 후 직결
┌────────▼──── Session Host (utilityProcess) ────────────────────┐
│ SessionManager ─ SshConnection(ssh2) ─ Shell / Sftp / Forward   │
│                └ LocalPty(node-pty, M2)                         │
│ FlowController · HostKeyVerifier · TransferQueue                │
└─────────────────────────────────────────────────────────────────┘
```

- `worker_threads` 금지(node-pty 스레드 비안전).
- 평문 비밀정보는 main에서 복호화해 연결 시점에만 utility로 전달, **renderer에는 ID만**.
- 탭은 BrowserWindow를 늘리지 않고 단일 renderer 내 React 컴포넌트로.
- **구현 결정(2026-10-20)**: MessagePort는 **preload가 보유**하고 renderer에는 `attachSession()` 함수 API만 노출한다(S1 측정 전 보안 우선, K3). 세션 수명주기 로직은 Electron 비의존 `HostSession`(core)에 두고 session host는 이를 조립만 한다(K5). 호스트 키 판정은 main의 `KnownHostsStore`가 하고, session host는 parentPort로 묻는다.

### 5.2 데이터 흐름(터미널 출력)

```
ssh2 channel ─▶ Coalescer(≤16ms 또는 ≤64KB) ─▶ MessagePort(구조화 복제 — MessagePortMain은 ArrayBuffer transfer 미지원, 비용은 S1에서 측정)
  ─▶ term.write(chunk, cb) ─cb─▶ ACK(원본 바이트 수) ─▶ FlowController
FlowController: pending > HIGH(~100KB) → channel.pause() / pending < LOW(~10KB) → resume()
입력: term.onData ─▶ port ─▶ channel.write
```

- 기준(AC17): LAN(RTT < 5ms)에서 `yes` 실행 중 Ctrl+C 입력 후 **화면 갱신이 200ms 안에 멈추고**, 그 이후 xterm 버퍼에 추가되는 데이터가 **256KB 이하**. `stream.pause()`는 로컬 읽기만 멈추므로 ssh2 채널 window/packet 크기를 함께 튜닝한다.
- ACK 단위(원본 바이트 수) 불일치는 스트림 정지로 이어진다 → core 순수 함수로 TDD 1순위.

### 5.3 모노레포

M1은 3개 패키지로 시작하고, 경계가 굳으면 분리한다(분리는 [Structural] 커밋). 앱 코드와 도구 설정·스크립트·node_modules는 `client/` 아래에 둔다. 현재 구조:

```
btterm/
├─ package.json          # 얇은 위임(pnpm -C client …), lefthook.yml
├─ client/
│  ├─ pnpm-workspace.yaml   # core·ui·desktop, nodeLinker: hoisted, allowBuilds
│  ├─ scripts/           # 검사·패키징·릴리스
│  ├─ core/              # 도메인·포트·IPC 스키마(zod)·HostSession·흐름 제어 (Node API 금지)
│  │  └─ src/testing/    # Fake·계약 스위트 (@btterm/core/testing)
│  ├─ ui/                # React 화면 (@btterm/ui)
│  └─ desktop/           # CommonJS 출력(sandbox preload 요구)
│     ├─ src/main/       # 창·app:// 프로토콜·IPC·SessionBroker·KnownHostsStore·JsonFileStore·SecretVault
│     ├─ src/preload/    # 포트 보유, window.btterm 도메인 API
│     ├─ src/session-host/  # utilityProcess: HostSession + Ssh2Transport
│     ├─ src/renderer/   # client/ui를 띄우는 진입점
│     ├─ src/platform/  src/shared/
│     └─ e2e/  test/integration/  test/sshd/(Docker sshd, 커스텀 이미지)
```

분리 후보(M2 이후): `ipc-contract`, `adapter-ssh`, `adapter-pty`, `adapter-store`.

런타임 외부 모듈(`dependencies`)은 **ssh2 하나**이고 core·React·xterm은 번들한다. pnpm `allowBuilds`: `electron`·`esbuild` 허용, `ssh2`·`cpu-features`·`electron-winstaller` 금지(ssh2는 순수 JS 경로). `node-pty`는 M2에 추가 승인.

### 5.4 도메인 모델(초안)

```ts
interface SshKey {
  id: SshKeyId; label: string;
  source: { kind: 'path'; path: string } | { kind: 'vault'; secretRef: SecretRef };  // F7.1
  keyType: 'ed25519' | 'ecdsa' | 'rsa'; bits?: number;
  publicKey: string; fingerprintSha256: string;   // renderer에 노출 가능한 값은 이것뿐
  encrypted: boolean; createdAt: number;
}
type IconRef = { kind: 'builtin'; name: string; color?: string } | { kind: 'custom'; assetId: string };
interface HostDefaults {
  icon?: IconRef;                         // F1.11: 그룹 지정 시 하위 서버 상속
  port?: number; identityId?: IdentityId; username?: string;
  keepaliveSec?: number; tabColor?: string; colorScheme?: string; startupCommand?: string;
  font?: { family: string; size: number; cursor: 'block' | 'underline' | 'bar' };   // F3.16
}
interface Group {
  id: GroupId; parentId: GroupId | null; name: string; order: number;
  defaults: HostDefaults;                 // 하위 그룹·프로필이 매개변수 단위로 상속
}
interface Identity { id: IdentityId; label: string; username: string; credentialId: CredentialId | null }
interface Profile {
  id: ProfileId; groupId: GroupId | null; name: string; host: string;
  overrides: HostDefaults;                // 프로필에서 직접 지정한 값만
  tags: string[]; updatedAt: number;
  unsupported?: Record<string, string>;   // 가져오기 시 보존한 미지원 지시어(ProxyJump 등)
}
// core 순수 함수: 프로필 값 → 부모 그룹 → 조상 그룹 → 앱 기본값 순으로 해석
declare function resolveEffectiveSettings(p: Profile, groupChain: Group[], appDefaults: Required<Pick<HostDefaults, 'port' | 'keepaliveSec'>>): EffectiveSettings;
// M2에서 kind('ssh'|'local'), jumpHostProfileId 추가 (스키마 마이그레이션으로)
type Credential =
  | { id: CredentialId; type: 'password'; secretRef: SecretRef }
  | { id: CredentialId; type: 'privateKey'; key: SshKeyId; passphraseRef?: SecretRef }
  | { id: CredentialId; type: 'agent'; agent: 'openssh' | 'pageant' };

interface SshTransport { connect(opts: ConnectOptions, hooks: AuthHooks): Promise<SshConnection> }
interface SshConnection {
  openShell(size: PtySize): Promise<ByteDuplex>;
  openSftp(): Promise<SftpClient>;
  onClose(cb: (reason: CloseReason) => void): Disposable;
  end(): Promise<void>;
}
interface ByteDuplex {
  write(data: Uint8Array): void;
  onData(cb: (chunk: Uint8Array) => void): Disposable;
  pause(): void; resume(): void; resize(size: PtySize): void;
}
interface HostKeyStore { verify(host: string, port: number, key: HostKey): Promise<'trusted' | 'unknown' | 'mismatch'> }
interface Clock { now(): number; setTimeout(fn: () => void, ms: number): Cancel }
```

### 5.5 기술 스택과 버전(2026-10-20 기준, 착수 시 재확인)

| 영역 | 선택 | 비고 |
|---|---|---|
| 런타임 | **Electron 44.9.0**(내장 Node 24.22, Chrome 152) | 8주 주기 정기 업그레이드. Node는 `.nvmrc` 24, pnpm 11.1.3 |
| 빌드 | **electron-vite 6.0 (Vite 8)** + electron-builder 26.15 | NSIS per-user, `npmRebuild: false` |
| UI | **React 19.3** + **TypeScript ~6.0.3** | TS 7은 typescript-eslint 미지원이라 6.0 고정(K1) |
| 터미널 | **@xterm/xterm 6.0** + fit 0.11 / webgl 0.19 / unicode11 0.9 (search·web-links·serialize는 1-4) | canvas addon 사용 금지 |
| SSH | **ssh2 1.17.0 고정**(`^` 없음) | patch-package 대비 |
| 로컬 PTY | node-pty 1.x (ConPTY) | M2, VS Build Tools + Spectre libs 필요 |
| 저장 | JSON + 스키마 버전 | SQLite는 필요 시 |
| 비밀 | Electron `safeStorage`(async API) | |
| 검증 | **zod 4.6** | IPC 경계 |
| 테스트 | **Vitest 5**(core·desktop·integration 프로젝트), **Playwright 1.64 `_electron`**, `@xterm/headless`, Docker compose sshd | testcontainers는 쓰지 않고 compose로 대체. toxiproxy는 1-3에서 추가 |

### 5.6 크로스플랫폼 설계

| 영역 | Windows (M1) | macOS (M2) | 추상화 |
|---|---|---|---|
| SSH agent | `\\.\pipe\openssh-ssh-agent`, Pageant(M2) | `SSH_AUTH_SOCK` 유닉스 소켓 | `AgentLocator` |
| 비밀 저장 | safeStorage → DPAPI | safeStorage → Keychain | 동일 API |
| 로컬 셸(M2) | ConPTY: PowerShell, WSL | 유닉스 PTY: zsh/bash | `LocalShellCatalog` |
| 단축키 | Ctrl+Shift 계열 | Cmd 계열(터미널 키와 충돌 없음) | 키맵 프로필 2종, `CmdOrCtrl` 금지(의미가 다름) |
| 가져오기 | `~/.ssh/config`, MobaXterm(M1.5), PuTTY | `~/.ssh/config`, Termius(가능 범위) | `Importer` 플러그인 |
| 경로 | `%APPDATA%\btterm` | `~/Library/Application Support/btterm` | `app.getPath()`만 사용 |
| 창/메뉴 | 창 내 메뉴 | 시스템 메뉴바, `titleBarStyle: hiddenInset` | renderer는 OS 플래그만 받음 |
| 패키징 | NSIS | dmg(universal) | electron-builder 타깃 |
| 서명 | 무서명 → Store MSIX | 최소 ad-hoc 서명(arm64 필수). Sequoia부터 Control-클릭 우회 불가 → "시스템 설정 > 개인정보 보호 및 보안 > 그래도 열기". 서명이 바뀌면 Keychain(safeStorage) 확인 창 반복 → M2 착수 시 Developer ID($99/년) 여부 결정 | — |

- 검증: CI 없음(D15). M1까지 Windows에서 `pnpm verify:full`, macOS는 M2 2-D에서 Mac 기기로 같은 스크립트를 돌린다. 그 전까지 OS 이식성은 ESLint `platform` 규칙으로만 지킨다.
- 규칙: `process.platform` 분기는 `platform` 어댑터 안에서만 허용(lint 규칙으로 강제).

> **이견 기록:** Termius 벤치마킹 검토는 "Mac에는 Termius 무료판이 이미 있으니 macOS는 비목표로 두고 이식성 규칙만 유지"를 권고했다. 사용자 결정(D12)에 따라 M2 출시를 유지하되, M2 착수 시점에 Mac에서 SFTP 따라가기 등 btterm 고유 기능이 실제로 필요한지 다시 확인한다.

## 6. 보안 요구사항

### 6.1 Must (M1)

1. `contextIsolation`, `sandbox`, `nodeIntegration:false`, 커스텀 스킴(`app://`), 엄격한 CSP, 새 창/탐색 차단, 권한 요청 전부 거부
2. preload는 도메인 단위 최소 API. IPC는 zod 검증 + `senderFrame` origin 검증
3. 비밀정보는 main에만, renderer에는 ID만. 사용 후 Buffer 덮어쓰기(한계 문서화)
4. AES-256-GCM envelope 암호화 + safeStorage. **암호화 불가 시 저장 거부**(평문 폴백 금지)
5. `hostVerifier` TOFU + 키 변경 시 차단. `ssh-rsa`(SHA1), group1, CBC 기본 비활성
6. 에이전트 포워딩·X11 포워딩 기본 OFF
7. OSC 52 기본 OFF(켜도 쓰기만, 읽기 항상 거부). OSC 8/URL은 http(s)만 + 실제 URL 확인창. `openExternal`은 main에서 URL 파싱 후 스킴 allowlist
8. xterm `windowOptions` 전부 false(타이틀 리포트 주입 방지). 타이틀은 텍스트 노드로만 렌더
9. 붙여넣기 제어문자 제거, 여러 줄 경고
10. 앱 로그 구조적 마스킹(`password|passphrase|privateKey|token|secret`) + 단위 테스트. ssh2 debug 출력 미기록
11. Electron Fuses: `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`. **Fuse만 다른 두 빌드**를 만든다: E2E 빌드(inspect 허용, Playwright용)와 출시 빌드(inspect 차단). 출시 빌드는 inspect 없이 실행·종료·로그 확인 스모크를 별도로 돌린다.
12. lockfile 고정, `--frozen-lockfile`, postinstall allowlist, `pnpm verify`의 `pnpm audit --prod --audit-level high`·비밀 스캔(secretlint)
13. 크래시 리포트 자동 업로드 금지

### 6.2 Should (M2 이후)

마스터 비밀번호(Argon2id, 자동 잠금, `lock-screen` 이벤트), Windows Hello 잠금 해제, 세션 로그 암호화, 호스트 키 변경 이력 UI, SBOM, 비밀정보 전용 utility process 분리, 퍼징(xterm 파서 입력, IPC 인자).

> **이견 기록:** 보안 검토는 마스터 비밀번호를 M1 Must로 권고했다. 1인 사용 도구이고 DPAPI로 디스크 도난·타 계정은 방어되므로 M2로 미루되, **여러 사람이 쓰거나 공개 배포하기 전에는 Must로 승격**한다. → 2026-10-23 계정·동기화(D17)와 함께 F8.3·F8.6으로 넣었으나, 2026-11-26 F8을 빼면서 함께 빠졌다. 소스 공개(D15)는 바이너리 배포가 아니므로 이 조건과 무관하고, **바이너리를 공개 배포하거나 여러 사람이 쓰기 전에는 다시 Must**다.

## 7. 비기능 요구사항(목표치, 실측 후 조정)

| 영역 | 지표 | 목표 |
|---|---|---|
측정 장비: 개발자 본인 노트북(사양을 `docs/perf/baseline.md`에 기록).

| 영역 | 지표 | 목표 |
|---|---|---|
| 시작 | 콜드 스타트 → 첫 화면 | ≤ 2.0초 |
| 접속 | 세션 선택 → 프롬프트(LAN, RTT 제외 오버헤드) | ≤ 300ms |
| 메모리 | 창 1개·탭 1개 RSS 합계 / 탭당 추가 | ≤ 200MB / ≤ 25MB |
| 메모리 | SSH 탭 5개 + SFTP 1개 유휴 | ≤ 350MB |
| 응답성 | 대량 출력 중 Ctrl+C | AC17 기준 |
| 전송 | SFTP 처리량(1GB, LAN) | OpenSSH `sftp` 대비 ≥ 80% |
| 안정성 | 크래시 | 일상 사용 2주간 0회 |
| 안정성 | 자동 재접속 | toxiproxy로 30초 단절 20회 주입 시 19회 이상 성공 |
| 정확성 | 터미널 호환 | `docs/qa/terminal-checklist.md`(vttest 1·2·3·8·11, vim, tmux, htop, mc, less 항목) 전 항목 통과 |
| 보안 | 평문 자격증명 저장 | 0건(저장 파일 grep 테스트) |

## 8. 테스트 전략

### 8.1 피라미드(목표 70/20/10)

| 계층 | 도구 | 대상 |
|---|---|---|
| 단위 | Vitest | 세션 상태머신, 호스트 키 정책, known_hosts 파서, FlowController, TransferQueue, UTF-8 청크 경계, IPC 스키마, 로그 마스킹. `FakeSshTransport`, `FakeClock` |
| 통합 | testcontainers + `linuxserver/openssh-server`, toxiproxy | 인증, PTY, `stty size`, 한글 SFTP 해시 비교, 호스트 키 교체, 끊김 주입 |
| E2E | Playwright `_electron`(experimental, 버전 고정) | 패키징 빌드 스모크. 터미널 단언은 DOM 대신 버퍼 읽기 테스트 훅 |

- 터미널 렌더링은 `@xterm/headless` 버퍼(`translateToString`, `cursorX/Y`, `buffer.active.type`)로 단언. 픽셀 비교는 테마 스모크에만.
- `ResourceTracker.assertAllDisposed()`를 `afterEach`에 두어 자원 정리를 단위 수준에서 보장.
- Docker 없으면 **조용히 스킵하지 말고 명시적 실패**.

### 8.2 로컬 검증 (CI 없음, D15)

| 스크립트 | 실행 시점 | 내용 |
|---|---|---|
| `pnpm verify` | 커밋 전, `pre-push` 훅 | lint(ESLint·dependency-cruiser·stylelint), format, typecheck, 단위(Vitest), AC 매트릭스, 비밀 스캔(secretlint), 라이선스, audit |
| `pnpm verify:full` | 하위 페이즈 종료 전, 패키징 전 | verify + 통합(WSL2 Docker compose: sshd 등, AC 작업 시점에 서비스 추가) + E2E(패키징 후 Playwright) |
| `pnpm test:pty` | M2 | ConPTY 스폰 |
| `pnpm perf` | M1.5부터 수동 | 대량 출력, 1GB SFTP, 탭 100회 개폐 누수 |

Node ABI(단위)와 Electron ABI(E2E) 빌드를 같은 `node_modules`에서 섞지 않는다.

### 8.3 M1 수용 기준(Given/When/Then)

| # | 시나리오 | 기대 결과 | 계층 |
|---|---|---|---|
| AC1 | 연결된 탭에서 `vim test.txt` → `:q!` | 대체 화면 진입 후 원래 화면·프롬프트 복원 | I+E |
| AC2 | `top` 3초 → `q` | 화면 갱신, 프롬프트 복귀 | I |
| AC3 | `sleep 100` 중 Ctrl+C | 2초 내 프롬프트, 세션 유지 | I |
| AC4 | 80x24 → 창 리사이즈 120x40 | 원격 `stty size` = `40 120` | U+I |
| AC5 | `echo 안녕하세요` | 깨짐 없음, 셀 폭 2 | I |
| AC6 | 한글 3바이트가 다른 청크로 도착 | 한 문자로 복원, U+FFFD 없음 | U |
| AC7 | `보고서_최종.txt` 다운로드 후 재업로드 | 이름 보존, SHA-256 동일 | I |
| AC8 | 탭 A, B에서 A에 `echo AAA` | A 버퍼에만 출력 | U+E |
| AC9 | known_hosts에 없는 호스트 접속 | 지문 확인 전 인증 정보 미전송, 수락 시 저장 | U+I |
| AC10 | 저장된 키와 다른 호스트 키 | 연결 거부, 경고, 비밀번호 미전송 | U+I |
| AC11 | 대용량 업로드 중 취소 | 1초 내 핸들 종료, 다른 세션 무영향 | U+I |
| AC12 | 전송 중 네트워크 단절 | (keepalive 간격 × 3 + 2초) 안에 "끊김" 표시, 전송 실패 처리, ResourceTracker 카운트 0 | U+I |
| AC13 | 활성 셸·SFTP 있는 탭 닫기 | ResourceTracker 카운트 0, `process.getActiveResourcesInfo()` 개수가 탭 열기 전과 동일 | U+E |
| AC14 | 탭 여러 개 + 전송 중 앱 종료 | 5초 안에 종료, 잔존 프로세스 0 | E |
| AC15 | 잘못된 비밀번호 | 오류 표시, 재시도 가능, 로그에 자격증명 없음 | U+I |
| AC16 | 셸 통합 활성 상태에서 `cd /var/log` | SFTP 패널이 `/var/log`로 이동 | I+E |
| AC17 | LAN(RTT < 5ms)에서 `yes` 실행 중 Ctrl+C | 200ms 안에 화면 갱신 정지, 이후 버퍼 추가분 ≤ 256KB | E(perf) |
| AC18 | MS 한글 IME로 조합 중 Enter / 탭 전환 | 중복·유실 입력 없음 | E(수동 체크리스트 병행) |
| AC19 | (M1.5) 하나의 연결에서 셸 1 + 탐색 SFTP 1 + 전송 3개 진행, 서버 `MaxSessions 2` | 초과분은 추가 연결로 폴백, 모든 전송 완료 | I |
| AC20 | 앱이 실행 중일 때 다시 실행 | 새 프로세스 종료, 기존 창 포커스 | E |
| AC21 | 프로필 저장 중 프로세스 강제 종료 | 재시작 시 직전 정상본 또는 `.bak`로 로드, 데이터 손상 없음 | U+I |
| AC22 | v1 스키마 파일로 v2 앱 실행 | 마이그레이션 후 정상 로드, 원본 `.bak` 보존 | U |
| AC23 | 그룹 Prod(port 2222, identity=ubuntu-key) 하위 프로필 A는 port 미지정, B는 port 22 지정 | A는 2222·ubuntu-key, B는 22·ubuntu-key로 접속 | U |
| AC24 | SSH 탭 2개 연결 상태에서 OS 절전 → 5분 후 복귀 | 10초 안에 끊김 감지·재접속 시도, 터미널 렌더링 정상(WebGL 손실 시 폴백) | E(수동 병행) |
| AC25 | 구 버전 데이터 폴더로 새 버전 첫 실행 | 마이그레이션 전 스냅샷 생성 (M1.5: 하위 버전 실행 시 읽기 전용 경고) | U+I |
| AC26 | 암호화된 ed25519 키를 "가져오기"로 등록 후 데이터 폴더 전체 검색 | `PRIVATE KEY` 문자열·평문 passphrase 0건, renderer IPC 로그에 공개키·지문만 존재 | U+I |
| AC27 | 경로 참조 키로 접속, passphrase "이 세션 동안 기억" 선택 후 같은 키로 두 번째 서버 접속 | 두 번째는 프롬프트 없이 접속, 앱 재시작 후에는 다시 프롬프트 | I |
| AC28 | 경로 참조 키 파일을 삭제한 뒤 접속 | 연결 시도 전 "키 파일을 찾을 수 없음" + 경로 수정/가져오기 안내 | U |
| AC29 | Prod 그룹 아이콘을 "database"로 변경, 하위 서버 중 하나는 "web"으로 재정의 | 재정의한 서버만 web, 나머지는 database로 사이드바에 표시 | U+E |
| AC30 | 패널 디자인 탭에서 One Dark 선택(범위: 이 탭만) | 현재 탭만 즉시 변경, 다른 탭·재시작 후 원래 테마. "전체 기본값"으로 저장하면 모든 새 탭에 적용 (M1.5: "이 서버" 범위) | U+E |
| AC30b | (M1) 원격 `~/.bash_history`에 `sudo nginx -t`와 `mysql -psecret`가 있는 서버에서 검색 탭에 "nginx" 입력 | 해당 명령 표시, Enter 시 입력만(실행 안 됨), `-psecret`은 가려서 표시, 앱 데이터 폴더에 기록 파일 미생성 | I+E |
| AC31 | (M1.5) 셸 통합 활성 서버에서 `sudo nginx -t` 실행 후 검색 탭에서 "nginx" 검색 | 해당 명령이 서버·시각·종료 코드와 함께 최상단, Enter 시 프롬프트에 입력만 되고 실행되지 않음 | I+E |
| AC32 | `␠export TOKEN=abc` (공백 시작) 실행 후 기록 검색, 데이터 폴더 grep | 검색 결과·데이터 폴더 어디에도 `TOKEN=abc` 없음 | I |
| AC33 | (M1) 서버 2개 접속 후 첫 번째 탭을 터미널 영역 오른쪽 가장자리로 끌어 놓기 | 칸이 좌우 둘로 나뉘고 **각 칸 바로 위에 그 칸의 탭바**가 있으며, 각 원격 `stty size`의 열 수가 분할 전보다 줄어 자기 칸 크기와 일치. 각 칸 입력은 그 세션에만 감. 한 칸의 마지막 탭을 닫으면 칸이 사라지고 남은 칸이 전체 화면 | U+E |
| AC35 | (M1) 서버 트리에서 서버를 그룹 행 가운데로, 그룹을 다른 서버 행 위쪽으로 끌어 놓기 | 서버는 그 그룹의 마지막 자식이 되고(그룹 기본값 상속), 그룹은 그 서버 바로 앞에 놓인다. 그룹 안 서버를 최상위 행 사이나 목록 빈 곳에 놓으면 그룹에서 빠진다. 순서는 다시 열어도 유지 | U |
| AC34 | (M1) Linux 서버에 접속 | 칸 아래 상태 줄에 OS 이름, 로그인 아이디, RAM·디스크 사용/전체, 가동 시간이 나오고 몇 초 안에 CPU %와 네트워크 ↑↓ 속도가 채워진다. 칸 폭을 줄이면 스크롤바 없이 ◀ ▶ 버튼으로 나머지 항목을 볼 수 있다 | U+I+E |
| AC36 | **제외(2026-11-26, F8 제거)** (2-S) 마스터 비밀번호로 가입한 뒤 같은 비밀번호·틀린 비밀번호·복구 코드로 잠금 해제, 서버로 보내는 값 검사 | 같은 비밀번호와 복구 코드는 같은 계정 키를 돌려주고 틀린 비밀번호는 거부된다. 서버로 가는 값에 비밀번호·감쌈 키·계정 키가 없다. 서버가 약한 KDF 매개변수를 내려주면 거부한다 | U |
| AC37 | **제외(2026-11-26, F8 제거)** (2-S) 서버가 레코드를 다른 ID·종류·버전으로 바꿔치기하거나, 암호문을 바꾸거나, 이미 받은 것보다 옛 버전을 준다 | 모두 탐지해 반영하지 않는다(`record-tampered`·`rollback`) | U |
| AC38 | **제외(2026-11-26, F8 제거)** (2-S) 기기 A가 오프라인에서 서버를 추가·수정하고, 기기 B가 같은 서버를 고친 뒤 둘 다 동기화 | A의 추가가 B에 나타난다. 같은 서버는 나중에 올린 기기 값이 남고 다른 값은 "(충돌 사본)"으로 남는다. 한쪽이 지우고 다른 쪽이 고쳤으면 고친 값이 살아남는다 | U+I+E |
| AC39 | **제외(2026-11-26, F8 제거)** (2-S) 서버·비밀번호·키를 동기화한 뒤 서버 PostgreSQL 덤프와 서버 로그를 grep | 호스트 이름·사용자명·비밀번호·개인키 평문 0건 | I |
| AC40 | **제외(2026-11-26, F8 제거)** (2-S) Windows·맥(또는 `userData` 두 개)에서 같은 계정으로 로그인, A에서 비밀번호 저장 서버 추가 | B에 서버가 나타나고 비밀번호를 다시 입력하지 않고 접속된다 | E |

### 8.4 Definition of Done

- Red→Green 기록이 남아 있고, 단위/통합/해당 E2E 통과
- `test.skip`, `.only`, 빈 테스트, TODO 플레이스홀더 없음. 린트 경고 0, 타입 오류 0
- 구조 변경은 `[Structural]`, 행위 변경은 `[Behavioral]` 별도 커밋. 구조 커밋 전후 테스트 결과 동일
- 새 자원은 `ResourceTracker` 등록. 비밀정보가 로그/IPC 이벤트에 노출되지 않음
- 버그 수정에는 재현 테스트 포함

## 9. 클린룸 및 라이선스 준수

1. **관찰 범위:** 공식 문서, MobaXterm 실행 중 UI 동작, 사용자 소유 `MobaXterm.ini`(평문 세션 형식), 공개 프로토콜 트래픽, Process Monitor 수준의 실행 관찰. 근거: Home 약관 5.1조, Pro 약관 3.8.1조, 저작권법 §101의3①6(요약이며 원문이 우선, 법률 자문 아님, 확인 2026-10-20).
2. **금지:** MobaXterm 바이너리 디컴파일/디스어셈블(REA·Ghidra 포함), 저장 비밀번호 형식 분석, 아이콘·에셋 추출.
3. **명세 규칙:** 명세서에는 코드, 주소, 심볼, 디컴파일 결과를 넣지 않는다. 관찰 출처와 방법을 함께 기록한다(`docs/spec/` 하위, 필요할 때 만든다).
4. **참고 OSS:** Tabby, electerm(MIT) 코드를 가져올 경우 원본 저작권 헤더 유지 + [`THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md).
5. **상표:** "Moba", "MoTTY" 등 혼동 명칭 금지. "MobaXterm 세션 가져오기" 같은 지명적 사용만.
6. 바이너리 공개 배포 전 지식재산 전문가 검토. 소스 공개(2026-11-26, MIT)는 이 절의 클린룸 기록을 근거로 한 사용자 판단이다(전문가 검토 없음, [공개 범위](./decisions/2026-11-26-public-scope.md)).

## 10. 배포

| 단계 | 방식 |
|---|---|
| 초기(개인) | 서명 없는 NSIS, 자동 업데이트 없음(F5.6 제외, 새 설치 파일로 덮어 설치). SmartScreen 경고 감수. 자동 업데이트를 다시 검토하면 HTTPS·매니페스트 서명을 함께 정한다 |
| 사용자 확대 | Microsoft Store MSIX(개인 개발자 등록 무료, Store 서명). MSIX 샌드박스에서 ConPTY, agent pipe, 로컬 파일 시스템 접근, 외부 앱 실행("Open with") 사전 검증(Store 빌드는 샌드박스 때문에 기능이 제한될 수 있다. Termius 공개 문서 참고, 2026-10 기준) |
| 기업 환경 배포 | 조직 명의 OV 인증서 또는 Intune/GPO 같은 관리 도구 |

Azure Artifact Signing은 현재 한국 개인 개발자 대상이 아니므로 전제하지 않는다.

## 11. 리스크

| 리스크 | 영향 | 대응 |
|---|---|---|
| ssh2 유지보수 지연(마지막 릴리스 2025-08), Pageant가 master에서 제거됨 | 중 | 1.17.x 고정, `SshTransport` 추상화, ssh.exe 폴백, russh 장기 후보 |
| PPK v3/ed25519 PPK 미지원 | 중 | M2 변환기, M1은 OpenSSH 키 또는 agent 안내 |
| node-pty·네이티브 모듈 빌드(MSB8040 등) | 중 | M0 스파이크, M1에서는 node-pty 미사용 |
| Electron 8주 메이저 주기 | 중 | 네이티브 의존 최소화, 분기별 업그레이드 루틴 |
| 셸 통합(OSC 7) 미작동 환경(sudo -i, tmux, 중첩 ssh) | 중 | 따라가기 불가 상태를 UI로 명확히 표시, 수동 동기화 버튼 |
| WebGL 컨텍스트 한도(~16) | 저 | 보이는 터미널만 WebGL, LRU 풀 |
| 범위 팽창(MobaXterm 전체 기능 욕심) | 고 | 비목표 명시, 북극성 지표로 M1 종료 판정 |
| CI가 없어 로컬 검증을 건너뛸 위험 | 중 | `pre-push` 훅에서 `pnpm verify` 강제, `--no-verify` 금지(AGENTS §2), 하위 페이즈 종료 기준에 `verify:full` |

## 12. 미결 사항 및 검증 필요 항목

| # | 항목 | 확인 방법 | 시점 |
|---|---|---|---|
| Q1 | Electron 빌드에서 `node:sqlite` 사용 가능 여부 | `require('node:sqlite')`, `process.versions.sqlite` | M2 |
| Q2 | node-pty 공식 패키지의 Electron prebuild 범위 | 릴리스/소스 확인, 로컬 빌드 | M2 |
| Q3 | ~~ssh2 + Windows OpenSSH agent named pipe 실제 동작~~ → 인증 경로 통합 테스트로 확인 | — | 해결 |
| Q4 | ~~셸 통합 주입 방식~~ → D10으로 확정(`shell.sh` + rc에 `source` 한 줄) | — | 해결 |
| Q8 | 바스티온/터널이 필요한 서버 비율 → ProxyJump·포워딩 M1 승격 여부 | 사용자 판단(사용 로그 수집은 중단) | 도그푸딩 전 |
| Q9 | ~~pnpm 11에서 Electron postinstall 미실행~~ → `postinstall`(`client/scripts/ensure-electron.mjs`)로 해결 | — | 해결 |
| Q10 | ssh2가 포함하는 `pagent.exe`(Pageant 헬퍼)를 설치 파일에 둘지 | electron-builder `files` 제외 패턴 검토 | M2 2-A(Pageant 직접 구현 시) |
| Q5 | ~~공개 배포(OSS) 여부~~ → D15로 확정: 소스 public(MIT, 2026-11-26), 바이너리는 본인 사용 | — | 해결 |
| Q6 | MobaXterm 세션 파일 형식 명세(블랙박스 관찰 기반) | 본인 `MobaXterm.ini` 관찰 | M1 |
| Q7 | ~~GitHub windows 러너의 Linux 컨테이너 지원~~ → CI 미사용(D15)으로 해당 없음. 통합 테스트는 로컬 WSL2 Docker | — | 해결 |
| Q11 | AC17 부하 중 초과: ssh2 셸 채널 창(2MB, 상수)을 패치로 줄일지, 기준을 단독 측정으로 한정할지 | 결정 D-A(`docs/decisions/2026-10-20-phase1-buildout.md`) | 도그푸딩 전 |
| Q12 | 메모리 목표(200MB/350MB)와 실측(475MB/500MB) 차이 → 목표 조정 또는 최적화 | 결정 D-B, 고유 메모리 측정 추가 | 도그푸딩 전 |

## 부록 A. 포지셔닝과 차별화 후보

### A.1 경쟁 대비 포지셔닝

| 대상 | btterm의 차이 |
|---|---|
| MobaXterm | 현대적 UI, Git 친화적 설정, 무료 전 기능, Windows + macOS |
| Termius | **SFTP가 터미널 cwd를 따라감**(Termius 공개 문서에서는 찾지 못함, SFTP는 별도 화면), **계정 없이 전 기능·로컬 우선·무료**(Termius는 동기화 등 일부 기능이 유료 요금제), 내보내기 가능, 업그레이드 전 자동 스냅샷, 스니펫 변수 지원. Termius 관련 내용은 2026-10 기준 공개 문서로 확인한 것이며 바뀔 수 있다 |
| Tabby / electerm | 타입 안전 코어 + TDD, 보안 기본값(호스트 키 차단, OSC 52 OFF), 한글 IME 품질 |

### A.2 차별화 후보(M3 이후)

1. Ubuntu 운영 특화 서버 대시보드 탭(systemd, journalctl, apt 대기, 디스크/메모리, ufw)
2. 무설정 경로 따라가기: rc 파일 수정 없이 셸 종류를 자동 감지해 세션 단위로 주입(F4.5c 확장)
3. Git 친화적 선언형 호스트 인벤토리(`~/.ssh/config` 양방향, Ansible 인벤토리 가져오기)
4. 멀티 서버 명령 결과 diff/표 비교
5. 안전장치: 프로덕션 태그 호스트의 위험 명령 확인, 색 테두리, asciicast 녹화

## 부록 B. 첫 TDD 사이클

1. **Red** `client/core/src/terminal/AckFlowController.test.ts`
   - 120KB 수신 → `pause` 1회 호출
   - 115KB ACK → `resume` 1회 호출
   - ACK 누계가 수신량을 넘으면 예외
   - 0바이트 청크 무시
   - `FakeClock`으로 coalescer 경계(16ms, 64KB)
2. **Green** Node API 없는 순수 클래스로 최소 구현
3. **Refactor** 워터마크를 값 객체로 분리 → `[Structural]` 커밋

다음 순서: UTF-8 청크 경계 디코더(AC6) → known_hosts 파서·호스트 키 정책(AC9/AC10) → 스키마 마이그레이션(AC22). 모두 외부 의존이 없는 순수 로직이다.

## 부록 D. 구현 현황 (2026-10-22)

✅ 완료 · 🟡 일부 · ⬜ 미착수. 기준은 M1 범위(Must)와 이미 손댄 항목이다. 남은 작업 순서는 PLAN §남은 작업, AC별 상태는 `docs/qa/ac-matrix.md`, 결정은 `docs/decisions/`(2026-10-22: DF 일상 편의, TR 전송·키·배포, M2 macOS 착수). 지금까지 모두 Windows에서 확인했다. macOS는 2-D에서 확인한다.

### D.1 기능 요구사항

| ID | 상태 | 현황 |
|---|---|---|
| F1.1 / F1.1b 프로필·Identity | ✅ | 서버·그룹 편집 대화상자, 상속 값과 출처 표시·재정의, Identity(비밀번호 vault·매번 입력·키·agent) |
| F1.2 그룹 트리·검색 | ✅ | 중첩 그룹 접기, 고정, 퍼지 검색(이름·주소·태그), 키보드·컨텍스트 메뉴 |
| F1.2b 빈 칸 서버 카드 | ✅ | 고정 → 최근 접속 순 최대 8개(DF4) |
| F1.2a 트리 끌어 놓기 | ✅ | 서버·그룹을 그룹 안으로 넣기·빼기, 같은 단계 순서 변경, 원자적 저장(AC35) |
| F1.3 퀵커넥트 | ✅ | `user@host:port` 한 칸(IPv6·`ssh -p` 붙여넣기), 성공 후 저장 토스트(비밀번호 미저장) |
| F1.4 `~/.ssh/config` 가져오기 | ✅ | Include·와일드카드, 실행 항목 비활성(SEC-12), 경로 키 메타데이터는 첫 사용 때 채움 |
| F1.11 아이콘 | ✅ | 내장 21종·색 팔레트 10종, 편집 창에서 그림 타일·색 원으로 선택, 그룹 상속(AC29) |
| F2.1 인증 | ✅ | 비밀번호·개인키(경로/가져오기, passphrase)·keyboard-interactive |
| F2.2 Windows OpenSSH agent | ✅ | named pipe 인증 경로 통합 테스트 |
| F2.3 호스트 키 검증 | ✅ | 신규 확인·불일치 차단(AC10 E2E, 다른 종류의 키만 알려진 경우 포함)·revoked 차단, 알려진 키 종류 우선 협상, 호스트 이름 소문자 비교. 불일치 창은 차단만 + `ssh-keygen -R` 안내 + 알려진 호스트 관리 열기(TR6) |
| F2.4 known_hosts | ✅ | 앱 파일 읽기·쓰기, `~/.ssh/known_hosts` 읽기 전용 |
| F2.4b 알려진 호스트 관리 | ✅ | 목록·지문, btterm 항목만 삭제(main 시스템 확인창), 폐기 항목 보호(TR6) |
| F2.5 keepalive·재접속 | ✅ | 자동 재접속(백오프, 같은 탭), 2FA·인증 실패는 재시도 안 함, 끝난 세션은 인증 다시 받기 |
| F2.6 셸+SFTP 채널 공유 | ✅ | 한 연결에 셸·탐색 SFTP·전송 SFTP |
| F3.1 탭 터미널 | ✅ | 탭·상태 점·닫기 버튼·중클릭·Delete·화살표·끌어서 순서 변경, 탭 색(서버·그룹 상속, DF1) |
| F3.1b 탭 이름 바꾸기 | ✅ | 더블클릭·F2·메뉴, 이 실행 동안만(DF3) |
| F3.14 스니펫 | 🟡 | 1단계 ✅(입력만·실행·{{변수}}·production sudo 확인, DF7). 폴더·모든 탭에서 실행은 M2 |
| F3.2 리사이즈 | ✅ | 디바운스, 0 크기 차단, 원격 `stty size` 일치(AC4) |
| F3.3 한글 | 🟡 | 출력·셀 폭(AC5)·OSC 7 한글 경로 ✅, IME(S4·AC18) 수동 확인 ⬜ |
| F3.4 흐름 제어 | 🟡 | ACK 32KB/8KB, AC17 단독 측정 통과·부하 중 초과(결정 D-A) |
| F3.5 WebGL | ✅ | 보이는 터미널만(분할 시 최대 4), 손실 시 DOM |
| F3.10a 탭 그룹 분할 | ✅ | 칸마다 탭바, 가장자리=새 칸·가운데/탭바=옮기기(칸 안 중첩 분할, 최대 8칸), 탭 메뉴 분할·합치기, 순서 변경(AC33) |
| F3.7 검색·URL | ✅ | Ctrl+Shift+F 찾기, http(s) 링크 확인 후 열기 |
| F3.8 / F3.9 복붙·붙여넣기 보호 | ✅ | 선택=복사, 우클릭·Ctrl+Shift+V, 제어문자 제거, 여러 줄 확인, 클립보드 main 경유 |
| F3.15 / F3.16 / F3.16c 도구 패널·디자인 탭 | ✅ | 칸 탭바 버튼·Ctrl+Shift+L(UX8), 터미널 테마 9종(DF9)·글꼴·크기·커서, 이 탭만/전체 기본값(AC30), 열림 상태 설정 파일 저장 |
| F3.17a 명령 기록 검색 | ✅ | 원격 bash→zsh 기록, 2MB 끝부분, 마스킹·중복 제거, Enter=입력만(AC30b) |
| F3.18 서버 상태 줄 | ✅ | 칸마다 OS·CPU·RAM·네트워크·가동·아이디·디스크, 3초 간격 exec 수집, 넘치면 ◀ ▶(AC34) |
| F4.1 ~ F4.4 SFTP | ✅ | 경로 직접 입력·숨김·새 폴더·이름 변경·권한·삭제, 드롭 업로드, 충돌 질의, 전송 큐·취소·재시도(AC7, AC11) |
| F4.7 폴더 전송·이어받기 | ✅ | 폴더 재귀(링크 건너뜀, 깊이·개수 상한), 부분 파일에서 잇기, 업로드는 `.btterm-part` → 권한 유지 → 교체(TR1·TR2) |
| F4.8 로컬 편집 | ✅ | 임시 폴더로 받아 텍스트 허용 목록은 기본 앱, 나머지는 메모장으로 열기. 저장 감지 → "업로드" 확인(TR3). macOS 편집기·실행 파일 판단은 2-D |
| F4.5 / F4.5b 따라가기 | ✅ | 동의 후 셸 통합 설치·제거(rc·로그인 파일, 백업·원자적), OSC 7, 수동 동기화(AC16) |
| F5.1 서버 검색 | ✅ | 사이드바 퍼지 검색, 빠른 연결 칸 서버 검색(↑↓·Enter, 없으면 user@host), 새 탭 = 서버 목록(U3) |
| F5.1b 명령 팔레트 | ✅ | Ctrl+Shift+P, 동작·서버·탭, > / # 접두사(DF6) |
| F3.10b 칸 조작 | ✅ | 경계 끌기·방향키 크기 조절, Ctrl+Alt+방향키 칸 포커스, Ctrl+Alt+Shift+방향키 크기, Ctrl+Shift+1~9 탭, Ctrl+Shift+D·탭 메뉴 같은 서버 분할(U4) |
| F5.2 키맵 | ✅ | Ctrl+Shift 동작만 가로챔, IME 조합 중 무시, F6 영역 순환 |
| F5.3 테마 | ✅ | 화면 모드 시스템·라이트·다크(디자인 탭, 설정 파일 저장), 터미널 테마 9종은 따로(UX7, DF9) |
| F5.6 자동 업데이트 | — | 2026-11-26 제외(범위 밖). 설치는 새 설치 파일로 덮어 설치 |
| F5.4 i18n | ✅ | 타입 키 사전(ko), JSX 리터럴 금지 린트 |
| F6.1 단일 인스턴스 | ✅ | AC20 E2E |
| F6.2 원자적 저장 | ✅ | 프로필·설정 저장소 |
| F6.3 마이그레이션 | ✅ | 프로필 저장소 열 때 적용 |
| F6.4 앱 로그 | ✅ | 마스킹 로거(AC15에서 비밀번호 미기록 확인) |
| F6.5 오류 분류 | ✅ | 코드별 메시지·다시 연결 버튼·키 파일 안내 |
| F6.6 절전 복귀 | 🟡 | resume·unlock 때 세션 생존 확인 ✅, AC24 수동 확인 ⬜ |
| F6.7 설정·창 상태 | ✅ | 터미널 기본값·패널 상태, 창 위치·크기·최대화(화면 밖이면 기본 위치, DF2) |
| F6.9 이전 탭 복원 | ✅ | 빈 칸 "이전 탭 N개 다시 열기", 칸 배치 복원, 자동 재접속 없음(DF8) |
| F6.11 연결 직후 명령 | ✅ | 서버·그룹(상속), 한 줄만, 재접속마다(DF5). 서버별 "상속 안 함"은 남음 |
| F6.8 passphrase 캐시 | ✅ | 앱 실행 동안 메모리, 재시작 후 다시 묻기(AC27) |
| F6.10 업그레이드 스냅샷 | ✅ | 앱 시작 시(AC25) |
| F7.1 ~ F7.6 키체인 | ✅ | 경로 참조/가져오기, 형식 검증·실패 이유, passphrase 정책, 상세·공개키 복사·사용처, 삭제, 지문 변경 감지(AC26~AC28) |
| F7.7 키 생성·내보내기 | ✅ | Ed25519 기본·RSA 4096, passphrase 선택, 보관소 저장, 개인키 파일 내보내기(TR4) |
| F7.8 공개키 서버 등록 | ✅ | 연결된 탭 서버의 `~/.ssh/authorized_keys`에 없을 때만 덧붙임(700/600, 링크·쓰기 금지 파일 거부, TR5) |

### D.2 보안 불변 조건 (AGENTS §4)

`docs/qa/security-checklist.md`에 항목별 근거와 2026-10-20 독립 보안 리뷰 11건 조치를 기록했다.

| SEC | 상태 | 현황 |
|---|---|---|
| SEC-1 | ✅ | renderer행 스키마 계약 테스트, 드롭 경로 허용 목록, 원격 기록은 host에서 마스킹 |
| SEC-2 | ✅ | vault 앱 연결, 데이터 폴더 평문 0건(AC26 E2E) |
| SEC-3 | ✅ | 항상 hostVerifier, 불일치 차단(AC10 E2E), 종류 다운그레이드 차단 |
| SEC-4 | ✅ | 마스킹 로거, 경계 사례 보강 |
| SEC-5 | ✅ | 붙여넣기·기록 입력 정리, 링크 확인, OSC 7 처음 본 호스트 고정 |
| SEC-6 | ✅ | 한 모듈 + 린트 제한 |
| SEC-7 | ✅ | 창 옵션 스냅샷, 출시 DevTools 끔, 개발 변수 무시, Fuses 8종 확인, 패키지 스모크 |
| SEC-8 | ✅ | E2E Ctrl+W 전달 |
| SEC-9 | — | 포워딩 없음(M2) |
| SEC-10 | ✅ | 공백 시작 제외·마스킹·입력만·저장 안 함 |
| SEC-11 | ✅ | 로컬 이름 정규화(예약어·ADS·구분자), 대상 폴더 재확인 |
| SEC-12 | ✅ | 가져온 실행 항목 비활성 |
| SEC-13 | ✅ | crashReporter 금지 린트 |

### D.3 수용 기준 요약
- done 30: AC1~AC16, AC20~AC23, AC25~AC30, AC30b, AC33~AC35(AC35는 단위만, E2E 추후)
- wip 1: AC17(결정 D-A) · 수동 2: AC18, AC24 · M1.5: AC19, AC31, AC32
- 테스트(2026-10-20): 단위 593 · 통합 31 · E2E 28 · 성능 3(`pnpm test:perf`)

## 부록 C. 학습용 참고 소스

- electerm: `src/app/server/session-ssh.js`, `session-sftp.js`, `transfer.js`, `ssh-tunnel.js`, `session-hop.js`, `ssh-known-hosts.js`
- Tabby: `tabby-ssh/src/session/ssh.ts`, `shellChannel.ts`, `forwards.ts`, `authMethodSelection.ts`, `tabby-terminal/src/`(OSC cwd 처리)
- xterm.js Flow Control 가이드: https://xtermjs.org/docs/guides/flowcontrol/
- Electron utilityProcess: https://www.electronjs.org/docs/latest/api/utility-process
- Electron safeStorage: https://www.electronjs.org/docs/latest/api/safe-storage
- ssh2: https://github.com/mscdex/ssh2 , SFTP: https://github.com/mscdex/ssh2/blob/master/SFTP.md
- MobaXterm 라이선스: https://mobaxterm.mobatek.net/license.html , Pro 약관 PDF
- REA: https://github.com/morluto/rea
