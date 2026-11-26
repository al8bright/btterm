# btterm 개발 계획 (PLAN)

| 항목 | 내용 |
|---|---|
| **현재 페이즈** | **M2 — 2-D macOS 마무리**(2-S 계정·동기화는 2026-11-26 중단·제외, [공개 범위](./decisions/2026-11-26-public-scope.md)) · M1 1-7 수동 확인·도그푸딩, M1.5 남은 항목은 보류 ([결정 M2](./decisions/2026-10-22-phase2-macos.md), [맥 작업 안내](./ops/macos-dev.md), [진행 현황](./progress.md)) |
| 기준 문서 | [PRD.md](./PRD.md) v0.6, [DESIGN.md](./DESIGN.md), [AGENTS.md](../AGENTS.md), [mockup/](./mockup/index.html) |
| 갱신 | 2026-11-26 — 자동 업데이트(F5.6)·계정·동기화(F8, 2-S) 제거, 저장소 공개(MIT). 이전: 2026-10-22 v0.5 일상 편의(DF)·전송·키·배포(TR), Phase 2를 macOS부터 착수(결정 M2) |
| 개발 형태 | 1인, TDD, Tidy First. 작업 절차·커밋 규칙은 AGENTS.md §2 |
| Git | **`main` 단일 브랜치, PR·CI 없음.** 검증은 로컬 `pnpm verify` / `pnpm verify:full` + lefthook 훅 |
| 전체 일정(추정) | M0 2주 → **M1 최대 12주**(개발 8~9 + 도그푸딩 2 + 버퍼 1) → M1.5 4~5주 → M2 8주 → M3 미정 |

**상태 표시**: ✅ 완료 · 🟡 일부(비고 참고) · ⬜ 미착수

---

## 남은 작업 (우선순위 순, 2026-10-22 갱신)

2026-10-20 표의 #4 호스트 키 교체(TR6 알려진 호스트 관리), #5 전송 재시도·Windows 창 크롬은 끝났다. 2026-10-22에 Phase 2를 macOS부터 착수했다(결정 M2).

| # | 작업 | 하위 페이즈 | 이유 |
|---|---|---|---|
| 1 | **2-D macOS**: 구현·dmg·맥 `verify:full` 완료(2026-10-22), 디버깅 스위치는 남은 위험(M2-7). 남은 것: Windows 회귀 확인, 맥 손 확인 | 2-D | [결정 M2](./decisions/2026-10-22-phase2-macos.md), [맥 작업 안내](./ops/macos-dev.md), [진행 현황](./progress.md) |
| 1a | ~~**2-S 계정·동기화**~~ — **제외(2026-11-26)**, 범위 밖(나중에 다시 검토). 출시 빌드 디버깅 스위치 차단은 결정 M2-7로 남는다 | — | [공개 범위](./decisions/2026-11-26-public-scope.md) |
| 2 | **결정 D-A·D-B**: AC17 기준(ssh2 채널 창 패치 여부), 메모리 목표 재조정 | 1-7 | [보강 기록 §4](./decisions/2026-10-20-phase1-buildout.md#4-사용자-결정이-필요한-것) |
| 3 | **수동 확인**: S4 한글 IME(AC18), 절전 복귀(AC24), S6 SmartScreen, 터미널 호환 체크리스트 수동 항목 | 0-B, 1-7 | 자동화할 수 없음 |
| 4 | ~~업데이트 무결성~~ — 자동 업데이트(F5.6) 제거로 해당 없음(2026-11-26) | — | [공개 범위](./decisions/2026-11-26-public-scope.md) |
| 5 | Q8 결정(사용 로그 수집은 중단, 사용자 판단), Q6 `MobaXterm.ini` 관찰 명세 | 0-C, 1-7 | 도그푸딩 지표, 가져오기(F1.5) 전제 |
| 6 | 남은 다듬기: 연결 직후 명령의 서버별 "상속 안 함", 로컬 편집 업로드 전 원격 변경 확인, 이어받기 같은 크기 변경 감지, 남은 `.btterm-part` 정리, 키 내보내기 파일 권한(Windows ACL) | 1.5 | 각 결정 문서의 "남은 위험" |

---

## 0. 운영 규칙

### 0.1 DoD (모든 작업 공통)
- 대상 AC가 자동화되어 통과(수동 병행 항목은 체크리스트 기록), `docs/qa/ac-matrix.md` 갱신
- AGENTS.md §3·§4·§6 위반 없음(린트·계약 테스트 통과)
- 테스트·린트·타입체크 통과 후 커밋(AGENTS.md §2)

### 0.2 진행 관리
- **주간 번다운**: 매주 금요일 `docs/progress.md`에 계획 대비 완료한 F-ID·AC 수를 기록한다.
- **2주차 재계획**: M1 2주차 말 실측 속도로 남은 기간을 다시 추정하고 PLAN을 갱신한다.
- **범위 조정 규칙**: 2주 연속 계획의 80% 미만이면 §부록 C의 "M1 이월 후보"를 위에서부터 M1.5로 옮기고 `docs/decisions/`에 기록한다.
- **고정 슬롯**: 주당 0.5일은 문서 동기화·리팩터링·목업 추가에 쓴다.
- **피벗 기준**: M1이 시작 후 16주를 넘기면 D3(신규 개발)을 재검토한다(S5 결과 포함).

### 0.3 페이즈 게이트
종료 기준을 만족해야 다음 페이즈로 넘어간다. 미달 시 범위 축소(우선) 또는 기간 연장(차선)을 결정하고 기록한다. 게이트를 넘으면 머리 표의 "현재 페이즈"를 갱신한다.
> 2026-10-20: 사용자 지시로 M0 게이트를 통과하지 않은 채 M1을 시작했다. M0 잔여는 §남은 작업 #1·#9.

---

## Phase 0 — 기반·검증 (M0)

**목표:** M1을 막을 기술·운영 위험을 제거하고, TDD와 로컬 검증이 바로 돌아가는 저장소를 만든다.

### 0-A. 저장소 골격
| 상태 | 작업 | 비고 |
|---|---|---|
| 🟡 | 원격 저장소 연결(GitHub, public), main force push 금지 설정 | 연결 완료. GitHub 보호 설정은 미확인 |
| ✅ | `.nvmrc`(24 = Electron 44 내장 Node 24.22), `packageManager`(pnpm 11.1.3), `engines`, `engine-strict`, `nodeLinker: hoisted` | |
| ✅ | pnpm workspace: `client/core`, `client/ui`, `client/desktop/src/{main,preload,session-host,platform,shared,renderer}` | renderer 진입점만 desktop에 남김 |
| ✅ | electron-vite 6 + React 19 + TS 6.0, electron-builder(NSIS, Fuses) | TS는 typescript-eslint 호환 때문에 6.0 고정 |
| ✅ | 강제 장치 | ESLint(core 전역·`Date.now`, OS 분기, i18n 리터럴, shell·crashReporter import, skip/only), dependency-cruiser(프로세스·패키지 경계), stylelint(hex 금지), Prettier, tsc — 의도한 위반을 잡는지 2026-10-20 확인 |
| ✅ | Vitest 프로젝트(core / ui(jsdom) / desktop / integration), `setupFiles`(누수 검사), 통합 `globalSetup`(Docker 없으면 실패) | |
| ✅ | `pnpm verify` / `pnpm verify:full` | lint·deps·css·format·typecheck·단위·AC·비밀·라이선스·audit / + 통합·E2E |
| ✅ | git 훅(lefthook): commit-msg, pre-commit(eslint·prettier·secretlint), pre-push(verify) | 잘못된 메시지·린트 위반·비밀 문자열 차단 확인 |
| 🟡 | 공급망 검사(secretlint, audit, 라이선스) | ✅ ⬜ 월 1회 `pnpm outdated` 습관 |
| 🟡 | AC 추적(`ac-matrix.md` + 검사 스크립트, `*.e2e.ts` 포함) | 미배정 AC 검출은 미구현 |
| 🟡 | sshd compose(`target` + `toxiproxy` digest 고정) | target 이미지 digest 고정 ⬜ |
| ✅ | Electron 바이너리 자동 설치(`client/scripts/ensure-electron.mjs` postinstall) | |

### 0-B. 기술 스파이크
| 상태 | # | 스파이크 | 결과 / 남은 것 |
|---|---|---|---|
| 🟡 | S1 | utilityProcess ↔ renderer `MessagePort` | 경로·재접속 시 포트 교체 ✅, 포트는 preload 보유(K3). ⬜ 2안 성능 비교, 구조화 복제 비용 |
| ✅ | S2 | ssh2 번들 + Windows OpenSSH agent | 번들 ✅, agent 파이프 인증 경로 통합 테스트 ✅ |
| ✅ | S3 | Fuses + Playwright `_electron` | Fuses 8종 적용 빌드(`pnpm check:fuses`)·패키지 스모크(`pnpm smoke:packaged`) ✅ |
| ⬜ | S4 | xterm 6 + MS 한글 IME(8케이스) | **수동 검증 필요(사용자)** — `docs/qa/terminal-checklist.md` |
| ✅ | S5 | Tabby 플러그인 가능성 | 차별점 1~3 부분 가능, 보안 구조(SEC-1·2·7)는 플러그인으로 불가 → 직접 개발 유지([기록](./decisions/2026-10-20-phase1-buildout.md#5-s5-tabby-플러그인-조사-요약)) |
| 🟡 | S6 | 무서명 NSIS 실행 | 설치 파일 생성·패키지 앱 실행 ✅ ⬜ SmartScreen·Smart App Control(사용자) |

### 0-C. 사용 로그 — 중단(2026-10-23)
사용 로그 수집은 중단했다. Q8은 사용자 판단으로 정한다.

### 0-D. 목업 보강 — ✅
`docs/mockup/states.html`: 끊김·재접속 배너, 연결 실패, 빈 서버 트리, 셸 통합 동의.

### 종료 기준
- [x] 로컬(Windows + Docker)에서 `pnpm verify:full` 통과
- [x] git 훅이 잘못된 커밋 메시지·lint 위반·비밀 문자열을 막는지 확인
- [ ] S1~S6 결과 기록 — S4·S6 수동 확인 남음
- [ ] Q8 결정 기록(사용 로그 수집은 중단)
- [x] 강제 장치가 의도한 위반을 잡는지 확인(ESLint·depcruise·stylelint·i18n·skip·OS 분기)

---

## Phase 1 — 핵심 흐름 (M1, 최대 12주)

**목표:** "서버 등록 → SSH 접속 → 터미널 작업 → SFTP 따라가기 → 파일 전송"을 MobaXterm 없이 매일 쓴다.
**출시 대상:** Windows NSIS, 본인 사용(공개 배포 없음).

```
주차  1     2     3       4   5   6         7     8      9          | 10  11   | 12
     1-1   1-2   1-W     1-3     1-3.5+1-4  1-4   1-5+6  1-6+1-7    | 도그푸딩  | 버퍼
     ✅    ✅    ✅      ✅      ✅         ✅    ✅     🟡         | ⬜
```

### 1-1. 테스트 하네스 + 첫 순수 모듈 — ✅
| 상태 | 대상 | F / AC |
|---|---|---|
| ✅ | `ResourceTracker`, `FakeClock`, `IdGenerator`, core `setupFiles` | DoD |
| ✅ | `Utf8StreamDecoder` | AC6 ✅ |
| ✅ | known_hosts 파서(평문·`[host]:port`·해시·와일드카드·부정·마커) | F2.4 |
| ✅ | `HostKeyPolicy`(trusted/unknown/mismatch/revoked), 지문 형식 | F2.3, AC9, AC10 |
| ✅ | `OutputCoalescer`(16ms / 64KB) | F3.4 |

### 1-2. 저장소·보관소·IPC 계약 — ✅
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | 도메인 모델(zod) + `groupChain`·`resolveEffectiveSettings` | D13, AC23 ✅, AC29 ✅ |
| ✅ | 스키마 마이그레이션 체인 | F6.3, AC22 ✅ |
| ✅ | `JsonFileStore`: 임시 파일 → fsync → rename(EPERM 재시도), `.bak`, 손상 복구 | F6.2, AC21 ✅ |
| ✅ | 업그레이드 스냅샷(앱 시작 시) | AC25 ✅ |
| ✅ | `SecretVault`(AES-256-GCM envelope, safeStorage 불가 시 거부) 앱 연결 | SEC-2, AC26 ✅ |
| ✅ | IPC 계약: 프로필·키·세션·프롬프트(호스트 키·비밀번호·passphrase·kbd-interactive·파일 충돌)·설정·클립보드·링크·기록·파일·전송, SEC-1 검사 | |
| ✅ | `SshTransport`·`SftpSession` 포트 + Fake + 계약 스위트(Fake·실제 sshd 양쪽) | D6 |
| ✅ | `AckFlowController`(32KB/8KB) | F3.4 |
| ✅ | 로그 마스킹 + 앱 로거 | SEC-4 |

### 1-W. 워킹 스켈레톤 — ✅
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | utilityProcess 세션 호스트, 포트 중개, 호스트 종료 감지(대기 요청 정리) | D5 (host 재시작은 ⬜) |
| ✅ | ssh2 어댑터 + `hostVerifier` + 호스트 키 다이얼로그 + known_hosts 저장 | SEC-3, F2.3, F2.4 |
| ✅ | BrowserWindow(sandbox·contextIsolation·탐색 차단, 출시 DevTools 끔), `app://` + CSP, 권한 거부, 기본 메뉴 제거, 단일 인스턴스 | SEC-7, SEC-8, F6.1 |
| ✅ | NSIS 설치 파일 생성·실행 확인 | |

### 1-3. 세션·SSH 완성 — ✅
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | 세션 수명주기 `HostSession` | AC12, AC13, AC15 |
| ✅ | `ReconnectPolicy` + `SessionSupervisor` 자동 재접속(같은 탭), 수동 재접속(끝난 세션은 인증 다시 받기) | F2.5, AC12 ✅ |
| ✅ | 오류 분류(코드) + UI 메시지 + 다시 연결 버튼 | F6.5 |
| ✅ | 인증: 비밀번호(vault)·개인키(경로/가져오기·passphrase)·agent·keyboard-interactive | F2.1, F2.2, AC27·AC28 ✅ |
| ✅ | keepalive·끊김 감지(서버 측 종료, toxiproxy 무응답 단절 ≤ keepalive×3+2초) | AC12 |
| ✅ | 한 연결에서 셸 + SFTP 채널(탐색·전송 분리) | F2.6 |
| 🟡 | 절전 감지 → 세션 생존 확인(probe) | F6.6 ✅, AC24 수동 확인 ⬜ |
| ✅ | 통합 테스트(비밀번호·키·agent·kbd·호스트 키·단절·SFTP·셸 통합) | |

### 1-3.5. UI 토대 — ✅
| 상태 | 작업 | 근거 |
|---|---|---|
| ✅ | `client/ui`, API 주입, `FakeBtTermApi`, 외부 store(`AppStore`), `TerminalRegistry`·엔진 포트 | DESIGN §11 |
| ✅ | 앱 셸: 헤더(빠른 연결 한 칸)·액티비티 바·사이드바(서버/파일)·탭바·상태바·토스트·배너 | DESIGN §4 |
| ✅ | 키맵 가로채기(Ctrl+Shift만, IME 조합 중 무시), F6 영역 순환 | DESIGN §8.1, §9 |
| 🟡 | 토큰·i18n | ✅ 토큰·타입 키 사전·리터럴 금지 린트 ⬜ CSS Modules, Windows 창 크롬(titleBarOverlay) |

### 1-4. 터미널 UI — ✅
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | xterm 6 + fit / webgl(활성 탭만) / unicode11 / search / web-links(확인창) | F3.5, SEC-6 |
| ✅ | 리사이즈 디바운스, 0 크기 차단 | F3.2, AC4 |
| 🟡 | 입력 경로 `onData` 단일화 ✅ | S4 IME 수동 검증, AC18 ⬜ |
| ✅ | 복사/붙여넣기(선택=복사, 우클릭·Ctrl+Shift+V, 제어문자 제거, 여러 줄 확인, 클립보드 main 경유) | F3.8, F3.9, SEC-5 |
| ✅ | 프롬프트: 호스트 키(신규·불일치 차단)·비밀번호·passphrase·kbd-interactive | F2.3 |
| ✅ | 도구 패널 + 디자인 탭(테마 3종·글꼴·크기·커서, 이 탭만/전체 기본값) | F3.15, F3.16, AC30 ✅ |
| ✅ | 명령 기록 검색(원격 bash/zsh 기록, 마스킹, 입력만) | F3.17a, AC30b ✅ |
| ✅ | 탭 E2E: 분리(AC8)·닫기 정리(AC13)·앱 종료(AC14)·단일 인스턴스(AC20) | ✅ |
| ⬜ | 호스트 키 교체 흐름(불일치 시 확인 후 교체) | K9 |

### 1-5. 서버·키 관리 — ✅
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | 서버 트리(중첩 그룹, 고정, 퍼지 검색, 키보드, 컨텍스트 메뉴) | F1.2, F5.1 |
| ✅ | 서버·그룹 편집(Identity, 상속 표시·재정의, 아이콘) | F1.1, F1.1b, F1.11, AC29 ✅ |
| ✅ | 빠른 연결 저장 토스트 | F1.3 |
| ✅ | `~/.ssh/config` 가져오기(Include, 실행 항목 비활성) | F1.4, SEC-12 |
| ✅ | 키체인 UI(경로 참조/가져오기, 검증, passphrase 정책, 상세·공개키 복사, 변경 감지) | F7.1~F7.6, AC26~AC28 ✅ |
| ⬜ | 아이콘 사용자 색 선택 UI, 태그 필터 | F1.11 일부 |

### 1-6. SFTP·따라가기 — ✅
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | SFTP 패널(경로 직접 입력, 숨김 토글, 새 폴더·이름 변경·권한·삭제), 파일명 정규화 | F4.1, F4.2, AC7 ✅, SEC-11 |
| ✅ | 끌어 놓기 업로드(허용 경로만), 충돌 질의·모두 적용(요청 단위), 전송 큐(동시 3·취소) | F4.3, F4.3b, F4.4, AC11 ✅ |
| ✅ | 셸 통합(`shell.sh` + rc·로그인 파일 마커 한 줄, 백업·원자적 교체·제거) | F4.5, D10, AC16 ✅ |
| ✅ | OSC 7 처리(처음 본 호스트 고정), 수동 동기화 버튼 | F4.5b, SEC-5 |
| ⬜ | 전송 속도·ETA 표시, 재시도, 폴더 재귀 전송 | F4.4 일부, F4.7 |

### 1-7. 강화·출시 점검 — 🟡
| 상태 | 작업 | F / AC |
|---|---|---|
| ✅ | SEC-1~13 점검표 + 독립 보안 리뷰 11건 조치(`docs/qa/security-checklist.md`) | AGENTS §4 |
| ✅ | Fuses 적용·확인(`pnpm check:fuses`), 패키지 스모크(`pnpm smoke:packaged`) | SEC-7 |
| ✅ | 릴리스 스크립트(`pnpm release [patch|minor] [--dry-run]`, 로컬 태그만) | |
| 🟡 | 성능 기준선(`pnpm test:perf`, `docs/perf/baseline.md`) | 시작·탭당 메모리 통과, 합계 메모리 미달, AC17 부하 중 초과 → 결정 D-A·D-B |
| 🟡 | 터미널 호환 체크리스트(`docs/qa/terminal-checklist.md`) | 자동 항목 ✅, 수동 항목 ⬜ |
| ⬜ | Q6 `MobaXterm.ini` 관찰 명세 | 사용자 PC의 설정 파일 관찰 필요 |

### 도그푸딩 (10~11주차), 버퍼 (12주차) — ⬜
- 버그 수정만 허용. MobaXterm 실행 여부는 사용자가 판단한다(사용 로그 수집은 중단).

### 종료 기준
- [ ] M1 Must 구현, M1 대상 AC 전부 자동화 통과(`ac-matrix.md` 기준) — 현재 done 27 / wip 1(AC17, 결정 D-A) / 수동 2(AC18·AC24)
- [x] SEC-1~13 점검표 완료
- [x] 성능 기준선 기록(목표 미달 항목은 결정 대기)
- [ ] M1 기능 범위 안의 작업에서 2주 연속 MobaXterm 실행 0회(사용자 판단)

---

## Phase 1.5 — 다듬기 (M1.5, 4~5주, 도그푸딩 포함) — 🟡 일부 당김, 나머지 보류(결정 M2-6)

2026-10-22에 당겨서 끝낸 것: F2.4b 알려진 호스트(TR6), F6.11 연결 직후 명령(DF5), F7.7 키 생성·F7.8 공개키 등록(TR4·TR5), F5.1b 명령 팔레트(DF6), F3.16c 터미널 테마 9종(DF9). 그 밖의 항목은 아래 표 그대로 보류.

| 우선 | 묶음 | 항목 |
|---|---|---|
| 1 | 도그푸딩 이월 | M1 도그푸딩에서 "범위 밖"으로 기록된 상위 항목 |
| 2 | 가져오기 | F1.5 MobaXterm 세션(Q6 명세 기반), F1.6 PuTTY, F1.7 JSON 내보내기 |
| 3 | 터미널 | F4.5d 셸 통합 확장 → F3.17·F3.17b 명령 기록 2단계 + Shift+Enter 실행, AC31, AC32. F3.16c 나머지 테마·서버/그룹 범위, F3.16b 테마 가져오기, F3.8b 복붙 프리셋 |
| 4 | 서버·키 | F1.8 그룹 기본값 UI, F1.9 태그 필터, F1.12 이미지 아이콘(PNG 래스터화), F2.4b Known Hosts, F6.11 startup command, F7.7·F7.8, F2.6b MaxSessions 폴백(AC19) |
| 5 | 앱 | F5.1b 명령 팔레트, F5.2b 단축키 재지정, F5.4b 영어, F5.5 온보딩, F4.3b, F6.10b 하위 버전 읽기 전용 |
| 6 | 운영 | 풀 E2E, 성능 측정 스크립트(`pnpm perf`), REA 자체 빌드 점검 |

종료 기준: 전체 일상 작업에서 2주 연속 MobaXterm 0회(사용자 판단), AC31·AC32 통과.

---

## Phase 2 — 생산성 + macOS (M2, 8주) — 🟡 2-D부터 착수(2026-10-22)

**착수 결정**([M2](./decisions/2026-10-22-phase2-macos.md)): macOS **go**(본인 맥에서 설치 파일로 실행, 정식 배포 아님), 서명 **ad-hoc**, 맥 빌드는 사용자 맥에서, 순서 **2-D → 2-A → 2-B 나머지 → 2-C**(2026-10-23 추가한 2-S는 2026-11-26 제외), macOS 자동 업데이트 없음.
이미 끝난 것: F3.14 스니펫 1단계(DF7), F4.7 폴더 전송·이어받기(TR1·TR2), F4.8 로컬 편집(TR3).

| 묶음 | 기간 | 항목 |
|---|---|---|
| ~~2-S 계정·동기화~~ | 제외(2026-11-26) | ~~F8.1~F8.8(D17), §6.2 마스터 비밀번호(F8.3·F8.6)~~ → 범위 밖(나중에 다시 검토, [공개 범위](./decisions/2026-11-26-public-scope.md)) |
| 2-A 연결 확장 | 2주 | F2.7 ProxyJump(홉별 호스트 키), F2.8 포워딩, F2.9/F7.9 PPK, F2.10 Pageant(ssh2 `pagent.exe` 포함 여부 정리), F2.11 OpenSSH 폴백, 스키마 마이그레이션 |
| 2-B 작업 공간 | 2주 | F3.10 Workspace(분할 저장·복원·칸 크기 조절) + WebGL LRU, F3.11 MultiExec, F3.14 스니펫, F4.6~F4.8 |
| 2-C 로컬 셸·보안 | 2주 | node-pty 스파이크 후 F3.12, F4.5c, `node:sqlite` 검토 |
| 2-D macOS | 2주 | platform 어댑터, Cmd 키맵·메뉴, `trafficLightPosition`, dmg(universal, 최소 ad-hoc 서명), Mac에서 `pnpm verify:full` |

종료 기준: J3/J4 체크리스트(`docs/qa/j3-j4.md`, 필요할 때 만든다) 통과, macOS로 M1 AC 통과.

---

## Phase 3 — 확장 (필요 시) — ⬜

세션 로그(F3.13), 내보내기(F1.10), OS 아이콘 제안(F1.13), 원격↔원격 SFTP(F4.10), 인코딩(F4.9), 프록시·X11·RDP(F2.12, F2.13), 대시보드, MSIX. (자동 업데이트 F5.6은 2026-11-26 제외, 범위 밖)

---

## 부록 A. 크리티컬 패스

0-A(로컬 검증·sshd) → S1·S2 → 1-2 IPC 계약 → **1-W 스켈레톤** → 1-3 → 1-3.5 → 1-4 → 1-6 → 1-7 → 도그푸딩.
1-5와 디자인 탭은 병행·이월 가능.

## 부록 B. 위험 추적

| 위험 | 감시 시점 | 대응 |
|---|---|---|
| 스파이크 미완료(S1 성능, S4 IME) | 1-4 착수 전 | S4 수동 검증을 1-4 첫 작업으로, S1은 AC17 E2E로 측정 |
| 강제 장치 부재로 경계 위반 누적 | 다음 작업 | §남은 작업 #1을 먼저 |
| M1 지연 | 매주 금요일 번다운 | §0.2 범위 조정 규칙 |
| ssh2 유지보수 정지·버그 | 상시 | 계약 테스트 유지. 트리거: 12개월 무릴리스 또는 주요 서버 KEX 거부 → 교체 검토(추정 3~4주) |
| 셸 통합 거부·충돌 | 1-6, 도그푸딩 | 수동 동기화, 세션 주입 방식 스파이크(M1.5) |
| Electron 메이저 업그레이드 | 8주마다 | 분기 1회 업그레이드 작업일 |
| pnpm 11 Electron postinstall 미실행 | 새 clone | 설치 스크립트 보강(§남은 작업 #1) |
| 무서명 실행 차단 | S6 | 차단 정책이 있는 PC 제외 또는 서명 검토 |
| macOS Keychain 확인 창 반복 | M2 착수 | 서명 수준 결정 |
| 출시 빌드가 디버깅·샌드박스 스위치(`--remote-debugging-port`, `--no-sandbox` 등)를 받아들임 | 출시 전(M2-7) | 출시 빌드에서 이 스위치를 막고, 패키징 스모크는 디버깅 포트 없이 돌린다 |

## 부록 C. M1 이월 후보 (범위 조정 시 위에서부터)

1. F3.16 디자인 탭 → 기본 테마 1종 고정
2. F3.17a 검색 탭
3. F1.11 아이콘 선택(스키마는 유지)
4. F6.6 절전 복귀 감지(수동 재접속으로 대체)
5. F1.4 `~/.ssh/config` 가져오기(수동 등록으로 대체)
