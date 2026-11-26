# 터미널 호환 체크리스트 (PRD §7 정확성)

자동 테스트로 덮은 항목은 근거 테스트를 적고, 사람이 봐야 하는 항목은 확인 날짜와 결과를 적는다.
수동 항목은 실제 서버(또는 `client/desktop/test/sshd` 컨테이너)에 접속해 확인한다. 결과: ✅ 통과 · ⚠ 문제 있음(내용 기록) · ⬜ 미확인.

## 자동 확인

| 항목 | 근거 | 상태 |
|---|---|---|
| vim 열기·편집·저장·종료(alternate buffer) | `session-host/terminalApps.int.test.ts`(AC1) | ✅ |
| top 화면 갱신 | `terminalApps.int.test.ts`(AC2) | ✅ |
| Ctrl+C 인터럽트 | `terminalApps.int.test.ts`(AC3) | ✅ |
| 한글 출력(UTF-8 청크 경계) | `terminalApps.int.test.ts`(AC5), `Utf8StreamDecoder.test.ts`(AC6) | ✅ |
| 리사이즈 후 `stty size` 일치, 스크롤바 진동 없음 | `HostSession.test.ts`, `e2e/smoke.e2e.ts`(AC4) | ✅ |
| 대량 출력 중 Ctrl+C 응답 | `e2e/perf.e2e.ts`(AC17) | ✅ |
| Ctrl+W 등 Ctrl+(문자)가 원격으로 전달 | `e2e/smoke.e2e.ts`(SEC-8) | ✅ |
| vim 안에서 Shift+PgUp은 원격으로 전달 | `TerminalRegistry.test.ts` | ✅ |
| 여러 줄 붙여넣기 확인·bracketed paste | `TerminalRegistry.test.ts`, `e2e/terminal.e2e.ts` | ✅ |
| OSC 7 현재 폴더(한글 경로) | `session-host/files/files.int.test.ts`(AC16) | ✅ |

## 수동 확인

| 항목 | 방법 | 상태 | 기록 |
|---|---|---|---|
| vttest 1 (커서 이동) | 원격에 vttest 설치 후 메뉴 1 | ⬜ | |
| vttest 2 (화면 기능) | 메뉴 2 | ⬜ | |
| vttest 3 (문자 집합) | 메뉴 3 | ⬜ | |
| vttest 8 (VT102 삽입·삭제) | 메뉴 8 | ⬜ | |
| vttest 11 (비 VT100 확장) | 메뉴 11 | ⬜ | |
| tmux: 창 분할·크기 조절·분리/재연결 | `tmux`, `C-b %`, 창 크기 변경, `tmux attach` | ⬜ | |
| htop: 색·마우스 클릭·F 키 | `htop` | ⬜ | |
| mc(Midnight Commander): 선 그리기·마우스 | `mc` | ⬜ | |
| less: 검색·스크롤·종료 후 화면 복구 | `less /var/log/...` | ⬜ | |
| 한글 IME 조합 중 Enter·탭 전환(AC18) | MS 한글 IME로 `echo 한글입력` 조합 중 Enter, Ctrl+Shift+PgDn | ⬜ | S4 |
| 넓은 문자(이모지·CJK) 커서 위치 | `printf '가나다😀abc\n'` 후 커서 이동 | ⬜ | |
| 256색·트루컬러 | 트루컬러 그라디언트 스크립트(`24-bit-color.sh` 등)를 테스트 sshd에 복사해 실행 | ⬜ | |
