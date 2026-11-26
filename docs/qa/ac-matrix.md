# AC 추적 매트릭스

`pnpm check:ac`가 이 표를 읽는다. 상태가 `done`인 AC는 테스트 이름에 반드시 등장해야 한다(AGENTS.md §6).
상태: `todo` / `wip` / `done` / `manual`(수동 체크리스트) / `excluded`(기능 제거로 대상 아님, 검사하지 않음).

| AC | 계층 | 테스트 위치 | 상태 | 비고 |
|---|---|---|---|---|
| AC1 | I+E | desktop/session-host/terminalApps.int.test.ts (I), desktop/e2e/session.e2e.ts (E) | done | vim |
| AC2 | I | desktop/session-host/terminalApps.int.test.ts | done | top |
| AC3 | I | desktop/session-host/terminalApps.int.test.ts | done | Ctrl+C |
| AC4 | U+I+E | core/session/HostSession.test.ts (U), desktop/session-host/terminalApps.int.test.ts (I: stty size 40 120), desktop/e2e/smoke.e2e.ts (크기 안정) | done | 리사이즈 |
| AC5 | I | desktop/session-host/terminalApps.int.test.ts | done | 한글 출력 |
| AC6 | U | core/terminal/Utf8StreamDecoder.test.ts | done | UTF-8 청크 경계 |
| AC7 | U+I+E | core/sftp/TransferQueue.test.ts, desktop/session-host/files/transferEndpoints.test.ts (U), core/testing/sftpContract.ts via Ssh2Sftp.int.test.ts (I), desktop/e2e/files.e2e.ts (화면 다운로드→업로드 SHA-256) | done | 한글 파일명 SFTP |
| AC8 | U+E | ui/store/AppStore.test.ts (U), desktop/e2e/terminal.e2e.ts (탭 두 개 분리) | done | 탭 분리 |
| AC9 | U+I | core/ssh/HostKeyPolicy.test.ts, desktop/session-host/ssh/Ssh2Transport.int.test.ts, desktop/e2e/smoke.e2e.ts | done | 신규 호스트 키 |
| AC10 | U+I+E | core/ssh/HostKeyPolicy.test.ts, desktop/main/hostkeys/KnownHostsStore.test.ts (U), desktop/e2e/session.e2e.ts (경고·허용 버튼 없음·거부) | done | 호스트 키 불일치 |
| AC11 | U+I | core/sftp/TransferQueue.test.ts (U), desktop/session-host/files/files.int.test.ts (I: 200MB 업로드 1초 내 취소, 원격 부분 파일 0) | done | 전송 취소 |
| AC12 | U+I+E | core/session/ReconnectPolicy.test.ts, desktop/main/session/SessionSupervisor.test.ts (U), desktop/session-host/ssh/Ssh2Transport.int.test.ts, desktop/session-host/files/files.int.test.ts (I: toxiproxy 단절 시 감지·전송 실패 ≤ keepalive×3+2초), desktop/e2e/profiles.e2e.ts (자동 재접속) | done | 네트워크 단절 |
| AC13 | U+E | core/session/HostSession.test.ts, ui/App.test.tsx (U), desktop/e2e/terminal.e2e.ts (서버 쪽 세션 종료) | done | 탭 닫기 정리. SFTP 포함 정리는 1-6에서 재확인 |
| AC14 | E | desktop/e2e/terminal.e2e.ts, desktop/e2e/files.e2e.ts (전송 중 종료 5초 내, 원격 세션 0) | done | 앱 종료 정리 |
| AC15 | U+I+E | core/testing/sshTransportContract.ts (U+I), desktop/e2e/session.e2e.ts (오류 표시·다시 연결·로그에 비밀번호 없음) | done | 인증 실패 |
| AC16 | U+I+E | core/sftp/RemoteFiles.test.ts, ui/terminal/TerminalRegistry.test.ts (U), desktop/session-host/files/files.int.test.ts (I: 실제 bash OSC 7), desktop/e2e/files.e2e.ts | done | 따라가기 |
| AC17 | U+E | core/terminal/AckFlowController.test.ts (U), desktop/e2e/perf.e2e.ts(pnpm test:perf, docs/perf/baseline.md) | wip | 단독 실행은 대부분 통과(추가 78~258KB), 부하 중 990KB까지 — ssh2 채널 창(2MB) 조정 결정 필요 |
| AC18 | E | | manual | 한글 IME |
| AC19 | I | | todo | M1.5 MaxSessions |
| AC20 | E | desktop/e2e/terminal.e2e.ts | done | 단일 인스턴스 |
| AC21 | U+I | desktop/main/store/JsonFileStore.test.ts | done | 원자적 저장 |
| AC22 | U | core/domain/migrations.test.ts | done | 마이그레이션 |
| AC23 | U | core/domain/settings.test.ts | done | 그룹 상속 |
| AC24 | E | | manual | 절전 복귀 |
| AC25 | U+I | desktop/main/store/upgradeSnapshot.test.ts | done | 업그레이드 스냅샷 |
| AC26 | U+E | desktop/main/vault/SecretVault.test.ts, desktop/main/profiles/ProfileService.test.ts (U), desktop/e2e/profiles.e2e.ts (데이터 폴더 전체 검색) | done | 평문 비밀 없음 |
| AC27 | U+E | desktop/main/session/CredentialResolver.test.ts (U), desktop/e2e/profiles.e2e.ts (두 번째 서버 무프롬프트, 재시작 후 재요청) | done | passphrase 기억 |
| AC28 | U+E | desktop/main/session/CredentialResolver.test.ts (U), desktop/e2e/profiles.e2e.ts | done | 키 파일 삭제 |
| AC29 | U+E | core/domain/settings.test.ts, ui/servers/serverTree.test.ts, ui/components/ServerManagement.test.tsx (U), desktop/e2e/servers.e2e.ts | done | 아이콘 상속 |
| AC30 | U+E | ui/terminal/TerminalRegistry.test.ts, ui/App.test.tsx (U), desktop/e2e/terminal.e2e.ts | done | 테마 범위 |
| AC30b | U+I+E | core/history/shellHistory.test.ts, core/session/HostSession.test.ts (U), desktop/session-host/ssh/Ssh2Transport.int.test.ts (I: SFTP 끝부분 읽기), desktop/e2e/terminal.e2e.ts | done | bash_history 검색 |
| AC31 | I+E | | todo | M1.5 명령 기록 |
| AC32 | I | | todo | M1.5 공백 시작 명령 |
| AC33 | U+E | ui/workspace/groupLayout.test.ts, ui/store/AppStore.test.ts, ui/App.test.tsx (U), desktop/e2e/split.e2e.ts (실제 드래그·중첩 분할·stty size·입력 분리) | done | 탭 드래그 분할 |
| AC35 | U | core/domain/treeOrder.test.ts, core/ipc/contracts.test.ts, ui/servers/serverTree.test.ts, ui/store/AppStore.test.ts, ui/components/ServerManagement.test.tsx | done | 트리 끌어 놓기(E2E는 추후) |
| AC34 | U+I+E | core/stats/serverStats.test.ts, core/session/HostSession.test.ts, ui/App.test.tsx (U), desktop/session-host/terminalApps.int.test.ts (I: 실제 sshd 수집), desktop/e2e/stats.e2e.ts (E: 표시·좁은 창 ◀ ▶) | done | 서버 상태 줄 |
| AC36 | U | (테스트 삭제) | excluded | 계정 키 계층(2-S) — F8 제외(2026-11-26, 범위 밖) |
| AC37 | U | (테스트 삭제) | excluded | 레코드 바꿔치기·되돌림·레코드 누락 탐지(2-S, 계정 헤드) — F8 제외(2026-11-26, 범위 밖) |
| AC38 | U+I+E | (테스트 삭제) | excluded | 병합·충돌 사본(2-S) — F8 제외(2026-11-26, 범위 밖) |
| AC39 | I | (테스트 삭제) | excluded | 서버 DB 덤프·로그 평문 0건(2-S) — F8 제외(2026-11-26, 범위 밖) |
| AC40 | E | (테스트 삭제) | excluded | 두 기기 동기화: 비밀번호·호스트 키 다시 묻지 않고 접속(2-S) — F8 제외(2026-11-26, 범위 밖) |
