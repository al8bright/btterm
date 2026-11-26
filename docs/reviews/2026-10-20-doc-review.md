# 문서 종합 검토 — 2026-10-20 (AI 에이전트 13개 관점)

| 항목 | 내용 |
|---|---|
| 대상 | `docs/PLAN.md`, `docs/DESIGN.md`, `AGENTS.md`, `CLAUDE.md` (PRD·목업 제외, 참고만) |
| 검토자 | AI 에이전트 13개 관점: 전문 역할 11개 + 반대론 역할 2개. 사람 검토자가 아니다 |
| 판정 기준 | 2개 이상 관점이 독립적으로 지적 → **수렴**, 공식 문서·계산으로 확인 → **확정** |

검토자: ① 시니어 아키텍트 ② PM(일정) ③ TDD·테스트 ④ Electron ⑤ 보안 ⑥ 터미널 ⑦ UX/UI ⑧ 접근성 ⑨ React 프론트엔드 ⑩ DevOps/CI ⑪ 에이전트 문서 설계 ⑫ 반대론자 A(과잉 설계) ⑬ 반대론자 B(위험 과소평가)

---

## 1. 요약

문서의 방향(코어 순수성, 프로세스 격리, 보안 기본값, 클린룸)은 13개 관점 모두 동의했다. 문제는 세 가지로 모인다.

1. **일정이 수학적으로 성립하지 않는다.** M1 8주 안에 도그푸딩 2주가 들어 있어 구현은 6주다. 실측 기준 10~12주가 현실적이다. (②④⑬, 아키텍트①)
2. **규칙은 많은데 강제 수단이 없다.** 기계로 강제되는 규칙은 `process.platform` ESLint 하나뿐이다. 1인 프로젝트에서 "리뷰에서 반려"할 리뷰어는 없다. (①③⑤⑪⑬)
3. **문서끼리 이미 어긋난다.** 키맵 "단일 원천"이 세 곳, DESIGN이 hex를 쓰면서 hex 금지, M1 종료 기준은 E2E 자동화를 요구하는데 E2E 잡은 M1.5. (①③⑥⑦⑨⑪⑬)

---

## 2. 수렴·확정 지적 (우선 반영)

| # | 지적 | 지적한 검토자 | 근거 | 조치 |
|---|---|---|---|---|
| C1 | **Electron 기본 메뉴 가속키가 터미널 키를 가로챈다**(Ctrl+W 창 닫기, Ctrl+R·Cmd+R 새로고침 = 전 세션 화면 소실, Ctrl+- 확대). 문서에 언급 없음 | ④⑥ | 확정 | AGENTS §3-7에 "기본 메뉴 제거, 키맵에서 생성한 최소 메뉴만" 추가. E2E로 Ctrl+W가 `\x17`로 원격에 도착하는지 검증 |
| C2 | **M1 8주에 도그푸딩 2주 포함** → 구현 6주. 주당 투입 시간 미기재, 버퍼 0 | ①②⑬ | 확정 | M1 = 개발 8주 + 도그푸딩 2주 + 버퍼 1~2주. 주당 시간 명시, 2주차 실측 속도로 재계획 |
| C3 | **E2E가 M1.5에 시작** → M1 종료 기준(E 계층 AC 자동화)과 모순, 통합 결함을 8주 뒤에 발견 | ①③ | 확정 | E2E 스모크 1개(실행→sshd 접속→버퍼 `echo`)를 1-3 말~1-4 초로. 풀 E2E는 M1.5 |
| C4 | **키맵 단일 원천이 세 곳**(PRD §4.3, DESIGN §8.1, AGENTS §7). DESIGN에 Ctrl/Shift+Insert 누락 | ①⑥⑬⑪ | 확정 | DESIGN §8.1을 원천으로, PRD·AGENTS는 참조로 |
| C5 | **강제 수단 부재**: core import 금지, `Date.now` 금지, 비밀정보 IPC 금지, hex 금지, 디렉터리 경계 모두 사람 눈에 의존 | ①③⑤⑨⑪⑬ | 수렴 | AGENTS 규칙 표에 "강제" 열 추가. 0-A 산출물: `no-restricted-imports/globals`(core), dependency-cruiser(main/preload/session-host 경계), stylelint hex 금지, `eslint-plugin-vitest`(skip/only 금지), Vitest `globalSetup`(Docker 확인) |
| C6 | **DESIGN이 hex를 직접 사용**(`#1B2A40` 등 18곳) — hex 금지 규칙과 모순, 간격·모서리 토큰 이름 없음 | ⑦⑨ | 확정 | 의미 토큰 추가(`--accent-subtle-bg/-fg`, `--danger-subtle`, `--danger-border`, `--chip-var-*`, `--space-*`, `--radius-*`), §5는 토큰 이름만 |
| C7 | **MessagePort 경로의 공백**: (a) port로 오는 입력·ACK에 검증 규칙 없음 (b) preload→main world 포트 전달 방식 미정 (c) `MessagePortMain`은 ArrayBuffer를 transfer하지 못함(복사) (d) 크래시·reload 후 재연결 | ①④ | 확정(공식 문서) | S1 성공 기준에 4개 항목 추가. AGENTS §2에 "session host는 port·parentPort 메시지도 zod 검증" |
| C8 | **명령 기록(bash_history)**: 비밀이 renderer로 넘어감(§3-1 위반), 원격 파일 내용을 Shift+Enter로 실행, 제어문자, 파일 형식(HISTTIMEFORMAT, zsh extended·metafy) 미정의 | ⑤⑥ | 수렴 | main에서 비밀 패턴 마스킹 후 전달, 제어문자 제거, 파서는 core 순수 함수 + fixture TDD, alternate buffer에서 입력 차단, Shift+Enter는 §5 결정 |
| C9 | **따라가기 rc 스니펫 사양 없음**: 로그인 셸은 `.bash_profile`을 읽음, `PROMPT_COMMAND` 덮어쓰기, 마커·제거·백업·심볼릭 링크·공유 계정, OSC 7 host 검증 | ⑤⑥⑬ | 수렴 | 사양 문서화 + §5 결정 |
| C10 | **대비 결함**(계산 확인): GitHub Light에서 활성 탭 글자 **1.23:1**, 입력 테두리 **1.51:1**(WCAG 1.4.11 실패), One Dark·Solarized·Gruvbox red/blue 4.5 미만, 표의 수치가 실제보다 2~3% 낮음 | ⑦⑧ | 확정(계산) | 활성 탭 글자는 테마 fg, 입력 테두리 3:1 토큰, xterm `minimumContrastRatio: 4.5` 기본 ON, 수치 정정(14.2/11.0/6.8/3.7) |
| C11 | **테마 정의가 xterm `ITheme`에 비해 불완전**(16색, cursor, selection 없음). Solarized brightBlack = 배경 | ⑥ | 확정 | 테마를 `ITheme` 전 필드 JSON으로, DESIGN 표는 요약만 |
| C12 | **도구 패널 340px이 터미널을 잠식** — 960px 창에서 약 29열 | ⑦ | 계산 | 1280px 미만에서는 오버레이(PTY resize 없음), 이상에서는 인라인. 폭 280~400 드래그 |
| C13 | **다이얼로그 버튼 순서가 macOS 관례** — Windows 우선 제품인데 [취소][주 동작]. 목업끼리도 불일치 | ⑦ | 확정 | 플랫폼별 순서(Windows: 주 동작 먼저). 안전 기본 버튼 변형(중립 반전)을 §5.7에 명시 |
| C14 | **상태 정의 부재**: hover/active/disabled/error/loading/empty | ⑦⑨ | 확정 | DESIGN §5에 상태 매트릭스 |
| C15 | **xterm 생명주기·상태 관리 미정** — StrictMode 이중 mount, 숨긴 탭 `fit()` 0×0이 원격으로 전송 | ⑨ | 확정 | `TerminalRegistry`(React 밖), 비활성 탭 mount 유지 + `visibility:hidden`, 0 크기 resize 차단, 외부 store + selector, 터미널 바이트는 store 미경유 |
| C16 | **UI 토대가 UI 작업보다 늦다**: i18n(1-5)·테마 분리(1-5) < 디자인 탭(1-4), 호스트 키 다이얼로그(1-3)에 UI 셸 없음 | ①⑨ | 확정 | "1-3.5 UI 토대"(tokens, i18n, 앱 셸, ApiProvider + Fake, 최소 퀵커넥트) 신설 |
| C17 | **AC 추적 누락**: AC1~3이 PLAN 어디에도 없음, AC17 계층 불일치 | ③ | 확정 | `docs/qa/ac-matrix.md` + CI에서 미배정 AC 검출 |
| C18 | **1-1 TDD 순서**: 가장 복잡한 `AckFlowController`가 1번(0-D와 중복), `ResourceTracker`·`FakeClock`·`FakeSshTransport`가 마지막이거나 없음 | ①③ | 확정 | 0) 테스트 하네스 → 1) Utf8Decoder → 2) KnownHostsParser → … 각 항목에 첫 Red 한 줄 |
| C19 | **"사전 승인" 실행 불가**, "현재 페이즈" 표시 없음, PLAN §0·전역 CLAUDE.md·AGENTS 중복, AGENTS §10 재요약 | ⑪⑬ | 확정 | 승인 = "작업 중단 → 사용자에게 보고 → 명시 응답 → decisions 기록". PLAN 머리에 `현재 페이즈:` 줄. §10은 포인터로 |
| C20 | **Q5(공개 여부)가 CI 구축보다 늦다** — Actions 비용, 브랜치 보호, Releases 접근, 업데이트 무결성이 모두 걸림. macOS 러너는 Linux의 약 10배 단가 | ⑩⑤ | 확정(공식 단가) | Q5를 M0 0-A 선행 결정으로. macOS unit은 nightly 또는 `platform/**` 변경 시 |
| C21 | **공개 배포 vs 마스터 비밀번호 조건 충돌**(PRD는 "공개 배포 전 승격", PLAN은 M1 GitHub Releases) | ⑤ | 확정 | §5 결정에 연동 |
| C22 | **Node·pnpm 버전 미고정**, 릴리스 워크플로·버전 체계·브랜치 정책 없음 | ⑩ | 확정 | `packageManager`, `.nvmrc`(Electron 내장 Node 메이저), `engines`. 0.x semver, `v*` 태그 릴리스 잡, main 보호(required checks) |
| C23 | **보안 누락 위협**: SFTP 원격 파일명 경로 이탈(`..\`, ADS, `CON`), "Open with"로 `.bat/.lnk` 실행, SVG 블랙리스트, `.itermcolors` XXE·CSS 주입, 스니펫 변수 명령 주입, 가져온 startup command 자동 실행, 스냅샷·`.bak`에 남는 DPAPI DEK | ⑤ | 수렴 | AGENTS §3에 11번(경로 정규화) 추가, 각 F-ID에 보호 규칙 |
| C24 | **Electron 세부**: 권한 전부 거부 → `navigator.clipboard` 불가(클립보드는 main 경유), `powerMonitor`는 main 전용 → utility로 중계, 단일 인스턴스 락 vs E2E(`userData` 분리), Windows 창 크롬 미정, `GrantFileProtocolExtraPrivileges` 퓨즈 누락, sandbox에서 드롭 경로는 `webUtils.getPathForFile` | ④ | 확정(공식 문서) | 각 항목 PLAN·AGENTS 반영 |
| C25 | **macOS 무서명 가정이 낡음**: Sequoia부터 Control-클릭 우회 불가, arm64는 ad-hoc 서명 필수, 서명 불일치 시 Keychain 확인 창 반복 | ④⑩ | 확정 | PRD §5.6 문구 수정, M2 리스크에 추가 |
| C26 | **도그푸딩 지표의 자기기만 가능성** — "범위 안 작업"을 측정자가 정함, 기록 방법 없음 | ②⑬ | 수렴 | MobaXterm 실행 자동 기록(프로세스 시작 로그), 범위 밖 사용도 집계해 M1.5 입력으로 |

---

## 3. 관점별 핵심 의견

| 검토자 | 가장 중요한 지적 (1~3개) |
|---|---|
| ① 아키텍트 | MessagePort 경로 검증 공백(Critical) · 포트를 main world로 넘기는 방식 미정(Critical) · 키 파싱에 ssh2를 쓰면 main이 ssh2를 로드(규칙 위반) |
| ② PM | 도그푸딩 포함 시 M1 10~12주 · 버퍼 0 · 스파이크 실패 시 일정 영향 미정량(S4 +1주 등) |
| ③ TDD | E2E 시작 시점 · "Docker 없으면 실패"·ResourceTracker 집행 장치 부재 · Fake와 실제 구현의 계약 테스트 필요 |
| ④ Electron | 기본 메뉴 가속키 · MessagePortMain은 ArrayBuffer transfer 불가 · 권한 전부 거부 시 클립보드 불가 |
| ⑤ 보안 | bash_history 비밀의 renderer 유입 · OSC 133 기반 저장형 명령 주입 · 공개 배포 vs 마스터 비밀번호 충돌 |
| ⑥ 터미널 | 기본 메뉴 가속키 · 기록 입력 경계 조건(bracketed paste 밖에서 `\r`, alternate buffer 차단) · rc 스니펫 대상 파일·마커·제거 |
| ⑦ UX | 패널이 터미널 29열로 축소 · Windows 버튼 순서 · 상태 매트릭스 부재 |
| ⑧ 접근성 | GitHub Light 활성 탭 1.23:1 · 입력 테두리 1.51:1 · 트리 키보드 조작·forced-colors 미정의 |
| ⑨ React | xterm 생명주기 레지스트리 · 외부 store(바이트는 미경유) · ApiProvider로 Fake 주입, CSS Modules |
| ⑩ DevOps | Q5를 M0로 · macOS 러너 비용 · Node/pnpm 고정, 릴리스·브랜치 정책 |
| ⑪ 에이전트 문서 | `@AGENTS.md` import는 공식 권장 방식(확인) · "사전 승인" 행동 정의 · 하위 디렉터리 CLAUDE.md로 컨텍스트 분할(M0 이후) |

에이전트 문서 검토자의 공식 문서 확인 결과: Claude Code는 `@path` import를 지원하고, AGENTS.md 직접 로드는 CLAUDE.md가 없을 때만 동작하므로 현재 구성이 맞다. general-purpose·executor 서브에이전트는 CLAUDE.md를 로드하며 Explore·Plan만 건너뛴다 → CLAUDE.md의 "서브에이전트에 규칙을 넣는다" 문구는 범위를 좁힌다.

---

## 4. 반대 의견표

### 4.1 반대론자 A — "1인 개인 도구에 과잉 설계"

| # | 대상 | 반대 주장 | 반박/지지하는 관점 | 판정 |
|---|---|---|---|---|
| A1 | 도그푸딩 8주 뒤 | 3주차에 최소 기능을 만들어 매일 쓰기 | 지지: ①② / 반박: ③(코어 우선) | **채택(조정)** — 1-1을 테스트 하네스 + 2~3개 순수 모듈로 줄이고 3주차에 walking skeleton(퀵커넥트→셸 1탭) |
| A2 | envelope 암호화 | M1에서는 safeStorage 단독과 효과가 같다 | 반박: ⑤(스냅샷·`.bak` 재암호화 문제는 구조가 있어야 단순) | **기각** — 코드량이 작고 M2 전환 비용을 줄인다 |
| A3 | M0부터 macOS CI | 이식성은 ESLint로 충분 | 지지: ⑩⑬ / 반박: (D12 원 결정) | **채택(조정)** — macOS는 nightly + `platform/**` 변경 시만 |
| A4 | Fuses 두 빌드·S3 | 무서명 개인 빌드에는 과함 | 반박: ③④(E2E 조기화에 S3 필요) | **부분 채택** — S3 스파이크는 유지, Fuses 적용은 1-7 그대로 |
| A5 | 1-7 성능 기준선·호환 체크리스트·REA 점검 | 체감으로 충분 | 반박: ②(종료 기준 측정 필요) | **부분 채택** — REA 점검은 M1.5로, 성능·호환은 최소판 유지 |
| A6 | i18n 키 구조 | 영어가 필요 없다 | 반박: ⑨(나중 추출이 린트·테스트까지 흔듦) | **기각** — 타입 있는 키 사전은 비용이 낮다. 영어 번역만 M1.5 |
| A7 | `docs/decisions/` | PRD D표와 중복 | 지지: ⑪(결정 정의 필요) | **채택(조정)** — PRD D표가 원천, decisions는 스파이크 결과·범위 이동 기록만 |
| A8 | 디자인 탭·아이콘 M1 | 대체 목표와 무관 | 반박: 사용자 직접 요청 기능 | **기각(사용자 결정 우선)** — 단, 1-4 과밀 해소를 위해 테마는 3종으로 시작하고 적용 범위는 "이 탭/전체" 2단계부터 |
| A9 | utilityProcess를 M1부터 | main에서 시작해도 된다 | 반박: ①④ | **기각** — D5 유지 |
| A10 | sshd 컨테이너 5종 | 해당 AC 작업 때 추가 | 지지: ② | **채택** |
| A11 | ResourceTracker 전면 | 세션 계층만 | 반박: ③(setupFiles 자동 주입이면 비용 낮음) | **부분 채택** — 자동 주입하되 대상은 SSH·터미널·전송 계층 |
| A12 | 하위 버전 읽기 전용(F6.10) | `.bak`이면 충분 | 지지: ④(업데이터 없으면 시점도 없음) | **채택(조정)** — "새 버전 첫 실행 시 마이그레이션 전 스냅샷"만 M1, 읽기 전용은 M1.5 |
| A13 | 재접속 정책·오류 7분류 | 버튼 하나로 시작 | 반박: ⑦(오류 UX가 곧 상태 정의) | **부분 채택** — 분류는 유지(순수 로직), MaxSessions 폴백은 M1.5 |
| A14 | 보안 불변 조건 8~10 | 대상 기능이 아직 없다 | 반박: ⑤ | **기각** — 규칙은 비용이 없다 |
| A15 | 문서 동시 갱신 | 동기화 비용 과다 | 지지: ⑬ | **채택(조정)** — 결정·범위 변경만 즉시, 세부는 페이즈 종료 시 일괄 |

### 4.2 반대론자 B — "위험 과소평가"

| # | 대상 | 반대 주장 | 반박/지지 | 판정 |
|---|---|---|---|---|
| B1 | M1 8주 | 구현 6주, 투입 시간 없음 | 지지: ①② | **채택** (C2) |
| B2 | D3 신규 개발 | Tabby **플러그인** 선택지를 평가하지 않았다 | 반박: (이전 검토의 Angular·russh 결합) | **부분 채택** — M0에 1일 스파이크 S5로 근거만 확보 |
| B3 | ssh2 교체 경로 | russh는 네이티브, ssh.exe는 채널 공유 불가 → 사실상 재작성 | 지지: ③(계약 테스트) | **채택** — 계약 테스트 + 교체 트리거(무릴리스 기간, KEX 거부) 명시 |
| B4 | S4 IME 대안 | "보정"은 대안이 아니다 | — | **채택** — 실패 판정 케이스와 타임박스, 대체 UX(입력 보조창) |
| B5 | rc 파일 수정 | 사용자 저항, dotfile 관리 충돌, 제거 경로 없음 | 지지: ⑤⑥ | **사용자 결정** (§5 Q2) |
| B6 | macOS CI | 비용 | 지지: ⑩ | **채택** (A3) |
| B7 | 무서명 NSIS | Smart App Control·조직 정책 차단 가능 | — | **채택** — M0에 실행 검증, 릴리스 SHA256 게시 |
| B8 | 도그푸딩 지표 | 자기기만 | 지지: ② | **채택** (C26) |
| B9 | 키맵 원천 충돌 | 첫날부터 원천 2개 | 확정 | **채택** (C4) |
| B10 | 문서 동기화 | 문서가 썩는다 | — | **채택(조정)** (A15) |
| B11 | 리뷰 의존 규칙 | 리뷰어는 AI뿐 | 지지: ①③⑤⑪ | **채택** (C5) |
| B12 | 로컬 Docker | 없으면 항상 빨간불 | — | **채택** — M0 종료 기준에 로컬 WSL2 Docker 통합 1회 통과 |
| B13 | Q8 승격 | 상쇄 규칙 없음 | 지지: ② | **채택** — 승격 시 같은 규모를 M1.5로 |
| B14 | 피벗 기준 없음 | 매몰비용 | — | **채택** — M1이 16주를 넘으면 D3 재검토 |

### 4.3 관점 간 충돌

| 쟁점 | 입장 1 | 입장 2 | 판정 |
|---|---|---|---|
| 코어 먼저 vs walking skeleton 먼저 | ③ 코어를 단단히 | ①② 통합 위험이 더 큼 | 하네스 + 순수 모듈 2~3개(1주) → 3주차 skeleton → 나머지 코어는 필요 시점에 |
| 포트 위치 | ① preload가 쥐고 함수만 노출(보안) | ④ main world로 전달(복사 비용) | S1에서 두 방식 측정 후 결정 |
| 기록 Shift+Enter | 사용자 요청·UX | ⑤⑥ 셸 상태를 모르므로 위험 | **사용자 결정** (§5 Q3) |
| 패널 표시 방식 | 사용자 요청: 터미널 안 패널 | ⑦ 좁은 창에서 오버레이 | 1280px 기준 혼합 |
| 입력 테두리 대비 | DESIGN §1 "낮은 대비 크롬" | ⑧ WCAG 최소 기준 | ⑧ 채택(입력 컨트롤만) |
| 테마 `minimumContrastRatio` | 테마 원색 충실도 | ⑧ 가독성 | 기본 ON(4.5), 끌 수 있음 |
| 다이얼로그 버튼 순서 | 일관성 | ⑦ 플랫폼 관례 | 플랫폼별 |
| macOS 서명 시점 | PRD "개인은 무서명" | ④ Keychain 확인 창 반복 | M2 착수 시 재결정(리스크 등재) |
| 커밋 형식 | 사용자 전역 규칙 `[Category] type:` | ⑩ Conventional 도구 비호환 | 사용자 규칙 유지, changelog는 수동 |
| TDD·커밋 규칙 위치 | 전역 CLAUDE.md | ⑪ 다른 에이전트는 못 봄 → AGENTS로 | AGENTS에 간결히 이전, PLAN §0은 링크로 |

---

## 5. 사용자 결정 필요

| Q | 질문 | 선택지 | 권고 |
|---|---|---|---|
| Q1 | M1 기간 | 개발 8주 + 도그푸딩 2주 + 버퍼(10~12주) / 8주 유지 + 범위 축소 | 10~12주 |
| Q2 | 따라가기 셸 통합 방식 | rc 직접 추가(현 D10) / `~/.config/btterm/shell.sh` 생성 + rc에 `source` 한 줄(마커·제거) / 세션 단위 주입(rc 미수정, 스파이크 필요) | source 한 줄 |
| Q3 | 기록 검색 Shift+Enter(실행) | M1은 입력만, 실행은 M1.5(OSC 133 이후) / production 확인 후 M1 유지 | 입력만 |
| Q4 | 저장소 공개 여부(Q5 앞당김) | private + M1 배포는 본인만 / public + 마스터 비밀번호를 M1.5로 당김 | private |

---

### 사용자 결정 (2026-10-20)
| Q | 결정 | 반영 |
|---|---|---|
| Q1 | M1 최대 12주(개발 8~9 + 도그푸딩 2 + 버퍼 1) | PRD D14, PLAN |
| Q2 | `~/.config/btterm/shell.sh` + rc에 `source` 한 줄 | PRD D10·F4.5, DESIGN §5.7 |
| Q3 | M1 기록 검색은 입력만 | PRD D16·F3.17a, AGENTS SEC-10 |
| Q4 | private, 본인 사용 릴리스 | PRD D15, AGENTS §7, PLAN 0-A |

## 6. 반영 계획 (2026-10-20 반영 완료)

| 순서 | 문서 | 반영 항목 |
|---|---|---|
| 1 | AGENTS.md | C1, C4(참조화), C5(강제 열), C7, C19(승인 절차·§10 축소), C23(§3-11), C24, TDD·커밋 규칙 이전, 결정 정의 |
| 2 | CLAUDE.md | 서브에이전트 문구 범위 축소, security-reviewer 트리거를 경로 기준으로, 일반 규칙은 AGENTS로 |
| 3 | PLAN.md | C2, C3, C16, C17, C18, C20, C22, C26, 현재 페이즈 표시, S5(Tabby 플러그인)·스파이크 타임박스·실패 시 주수, 버퍼·번다운, 피벗 기준, A1·A10·A12·A13, B7·B12·B13 |
| 4 | DESIGN.md | C6, C10, C11, C12, C13, C14, C15(§11), 키맵 원천화 + 메뉴 규칙 + 스크롤 키 + macOS Cmd+K 재검토, 트리 키보드·forced-colors·포커스 순환, 기록 입력 경계 조건 |
| 5 | PRD.md | §5.2 "transfer"→"복사", §5.6 macOS 서명 문구, Q5·Q7 갱신, F6.10 문구, Q2~Q4 결정 반영 |
