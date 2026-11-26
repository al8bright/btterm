# SEC-1~13 점검표 (AGENTS §4, PLAN 1-7)

| 항목 | 상태 | 근거(자동) | 비고 |
|---|---|---|---|
| SEC-1 비밀은 renderer로 보내지 않음 | ✅ | `core/ipc/contracts.test.ts`(renderer 방향 스키마 비밀 필드 0), `toProfilesView` 참조 제거, `HistoryResultSchema`도 검사 대상 | 원격 기록 비밀 패턴은 session host에서 가림 |
| SEC-2 평문 폴백 금지 | ✅ | `SecretVault.test.ts`, `ProfileService`의 `vault-unavailable`, E2E AC26(데이터 폴더 전체 검색) | |
| SEC-3 hostVerifier 항상 | ✅ | `Ssh2Transport`가 항상 설정, 계약·통합 AC9, mismatch·revoked 차단 | ast-grep 규칙은 미도입(코드 리뷰로 확인) |
| SEC-4 로그 마스킹 | ✅ | `maskForLog.test.ts`(키 이름·값 패턴·Bearer/Basic·맨 앞 `-p`·`__proto__`) | |
| SEC-5 터미널 출력 불신 | ✅ | `paste.test.ts`(제어문자·ESC 제거), `TerminalRegistry.test.ts`(링크 확인·bracketed paste·OSC 7 호스트), `osc7.test.ts` | OSC 7은 처음 본 호스트와 정확히 같을 때만(localhost 예외 없음). 접속 주소와 원격 `$HOSTNAME`은 보통 달라 "접속 호스트와 비교"는 처음 본 호스트 고정으로 구현 — 결정 기록 |
| SEC-6 openExternal 한 모듈 | ✅ | ESLint `no-restricted-imports`(electron `shell`), `isOpenableUrl` 테스트 | |
| SEC-7 Electron 기본선 | ✅ | `window.test.ts`(webPreferences 스냅샷, 출시 DevTools 끔), CSP·`resolveAppPath` 테스트, Fuses 8종 `pnpm check:fuses`, `pnpm smoke:packaged` | 출시 빌드는 `ELECTRON_RENDERER_URL`·`BTTERM_USER_DATA`를 무시(`devEnv.test.ts`) |
| SEC-8 기본 메뉴 없음 | ✅ | E2E Ctrl+W가 원격으로 전달 | |
| SEC-9 포워딩 기본값 | — | 포워딩 기능 없음(M2) | |
| SEC-10 명령 기록 | ✅ | `shellHistory.test.ts`(공백 시작 제외·마스킹·길이 상한), E2E AC30b(입력만, 저장 안 함) | |
| SEC-11 로컬 경로 탈출 금지 | ✅ | `localName.test.ts`(`..`·구분자·ADS·예약어 COM¹·CONIN$ 등), `transferEndpoints.test.ts`(`safeLocalTarget`) | 실행 확장자 경고 목록 확장(.jar .msc .chm .url 등). 다운로드 파일 "열기" 기능은 아직 없음 |
| SEC-12 가져온 실행 항목 비활성 | ✅ | `sshConfig.test.ts`(`needsApproval`), 실행 코드 없음 | |
| SEC-13 크래시 자동 업로드 금지 | ✅ | ESLint `crashReporter` import 금지 | |

## 보안 리뷰 2026-10-20 (독립 리뷰 패스, 커밋 28개 대상) 지적과 조치

| # | 심각도 | 지적 | 조치 | 테스트 |
|---|---|---|---|---|
| 1 | 중간 | `files.upload`가 renderer가 준 임의 로컬 경로를 업로드(예: `~/.ssh/id_ed25519`) | preload가 `webUtils`로 얻은 드롭 경로만 main 허용 목록에 60초 등록, main은 목록에 있는 경로만 업로드 | `DroppedPaths.test.ts`, `FileRelay.test.ts` |
| 2 | 중간 | 출시 빌드도 `ELECTRON_RENDERER_URL`·`BTTERM_USER_DATA`를 따르고, 발신자 판정이 접두사 비교 | 출시 빌드는 무시, origin 정확 비교. 패키지 스모크는 `--user-data-dir` 사용 | `devEnv.test.ts`, `pnpm smoke:packaged` |
| 3 | 중간 | 원격 rc를 비원자적으로 쓰고 제거 전 백업 없음 | 임시 파일 + `posix-rename`으로 교체(링크는 대상 파일), 바꾸기 직전마다 `.btterm-backup` | `sftpContract`(실제 sshd), `RemoteFiles.test.ts` |
| 4 | 낮음 | 8192자 넘는 기록 줄이면 요청이 영구 대기, host 종료 시 대기 요청 미정리 | 명령 8192자로 자름, 기록·키 검사·파일 작업에 시간 초과, host 종료 시 모두 끝냄 | `shellHistory.test.ts`, `FileRelay.test.ts` |
| 5 | 낮음 | 원격 rc·로컬 키 파일 크기 상한 없음 | rc 1MB·일반 파일만(링크는 대상 확인), 키 파일 256KB | `RemoteFiles.test.ts`, `readLimited.test.ts`, `ProfileService`·`CredentialResolver` 테스트 |
| 6 | 낮음 | `session.reconnect/close`·`prompt.respond`가 소유 창을 확인하지 않음 | 세션은 연 창만, 프롬프트는 받은 창의 응답만 | `PromptBroker.test.ts` |
| 7 | 낮음 | 끝난 세션의 비밀번호·키가 탭을 닫을 때까지 메모리에 남음 | 끝나면(재시도 안 함·포기) 인증 정보를 지우고 수동 재접속 때 다시 받음(프로필은 재해석, 빠른 연결은 다시 묻기) | `SessionSupervisor.test.ts` |
| 8 | 낮음 | "모두 적용"이 세션 전체·양방향에 남고, 동시 같은 이름 경합 | 요청 단위 배치 + 방향으로 범위 제한, 진행 중 이름 예약 | `TransferQueue.test.ts` |
| 9 | 낮음 | OSC 7 localhost·빈 host 예외로 출력에 섞인 위조 보고 수락 | 예외 제거(처음 본 호스트와 정확히 같을 때만) | `osc7.test.ts` |
| 10 | 낮음 | SEC-11 예약어·실행 확장자 목록 부족 | COM¹²³·LPT¹²³·CONIN$·CONOUT$, .jar .msc .chm .pif .vbe .psm1 .url .appref-ms .application .settingcontent-ms 추가 | `localName.test.ts` |
| 11 | 낮음 | 맨 앞 `-psecret` 미마스킹, `__proto__` 키 소실 | 패턴 `(^|\s)-p`, `defineProperty`로 담기 | `maskForLog.test.ts` |

남은 항목: SEC-3 ast-grep 규칙, OSC 7 위조 완전 차단(셸 통합에 설치별 비밀 토큰을 넣는 방식 검토).

## 2026-10-20 서버 상태 줄(F3.18) 보안 리뷰

| # | 심각도 | 지적 | 조치 |
|---|---|---|---|
| 1 | 중간 | 시간 초과 뒤 늦게 열린 exec 채널이 닫히지 않아 누적(MaxSessions 소진) | 늦게 열린 채널은 즉시 닫음, 채널 `error` 리스너 |
| 2 | 중간 | 3초 exec가 원격에 주는 영향(로그인 셸 rc, 강제 명령, 감사 로그) | 표지 없는 출력·실패 3회 연속이면 그 세션 수집 중지, 창이 가려지면 조회 중지, 결정 기록 ST8에 영향 명시. 서버별 끄기·production 기본 OFF(ST10) |
| 3 | 중간 | `execCapture`가 아무 문자열이나 받음(향후 주입 위험) | `FixedCommand` 브랜드 타입, 만드는 곳은 core 상수뿐 |
| 4 | 낮음 | 범위를 벗어난 값이면 메시지 전체가 버려짐 | 항목별 안전 정수 범위·사용량≤전체 검사, 벗어나면 그 항목만 null |
| 5 | 낮음 | bidi·폭 0 문자 미제거, 서로게이트 쌍 절단 | 제거 범위 확장, 코드 포인트 단위 자르기 |
| 6 | 낮음 | main·host 빈도 제한 없음 | host 최소 간격 2초(직전 결과 반환) |
| 7 | 낮음 | exec 채널 `error` 리스너 없음(probe 포함) | 추가 |
| 8 | 낮음 | 백그라운드에서도 조회 | `visibilityState === 'hidden'`이면 건너뜀 |
