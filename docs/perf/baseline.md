# 성능 기준선 (PRD §7, PLAN 1-7)

| 항목 | 값 |
|---|---|
| 측정일 | 2026-10-20 |
| 장비 | Intel Core Ultra 7 265K (20코어), RAM 31GB, Windows 11 Pro 10.0.26200 |
| 대상 | E2E 빌드(`pnpm --filter @btterm/desktop build:e2e`), Electron 44.9.0 |
| 원격 | Docker `linuxserver/openssh-server` (127.0.0.1:2222, 같은 PC) |
| 측정 방법 | `client/desktop/e2e/perf.e2e.ts` → `client/desktop/test-results/perf-baseline.json` |

## 결과

| 영역 | 지표 | 목표(PRD §7) | 측정 | 판정 |
|---|---|---|---|---|
| 시작 | 실행 → 첫 화면 | ≤ 2.0초 | 311ms | 통과 |
| 메모리 | 창 1개·탭 1개, 모든 Electron 프로세스 작업 집합 합계 | ≤ 200MB | 475MB | **미달** |
| 메모리 | 탭당 추가 | ≤ 25MB | 6MB | 통과 |
| 메모리 | SSH 탭 5개 유휴 | ≤ 350MB | 500MB | **미달** |
| 응답성 | AC17 `yes` 중 Ctrl+C: 화면 갱신 정지 | ≤ 200ms | 27~45ms (6회) | 통과 |
| 응답성 | AC17 Ctrl+C 이후 추가 수신 | ≤ 256KB | 78~216KB (6회) | 통과 |
| 처리량 | `yes` 출력 수신 | — | 약 18MB / 1.5초 | 참고 |

## AC17 튜닝 기록

렌더러가 확인(ACK)하지 않은 바이트 상한을 100KB → 32KB(재개 8KB)로 낮췄다(`HostSession`의 `DEFAULT_FLOW`).

| 상한 | Ctrl+C 이후 추가 수신(5~6회) | 처리량 |
|---|---|---|
| 100KB / 10KB | 101~484KB (2회 기준 초과) | 약 18MB / 1.5초 |
| 32KB / 8KB | 78~216KB (모두 통과) | 약 18MB / 1.5초 (변화 없음) |

남는 추가분은 Ctrl+C가 원격에 닿기 전에 서버가 보낸 데이터(ssh2 채널 창 2MB 안)다. ssh2는 채널별 창 크기를 공개 옵션으로 열어 두지 않아 더 줄이려면 별도 검토가 필요하다.

## 메모리 미달 분석과 다음 단계

- 합계에는 Electron이 띄우는 프로세스(브라우저 main, GPU, 네트워크 서비스, renderer, session host utility) 작업 집합이 모두 들어간다. 작업 집합은 공유 페이지를 중복 계산하므로 실제 고유 사용량보다 크다.
- 탭당 추가는 6MB로 작아, 기본 비용(약 470MB)이 대부분이다. 목표 200MB는 Electron 기본 구성에서는 현실적이지 않을 가능성이 크다.
- 다음 측정에서 `privateBytes`(고유 메모리)를 함께 기록하고, 목표치를 실측 근거로 재조정할지 결정한다(PRD §7 "목표치, 실측 후 조정"). 결정은 `docs/decisions/`에 남긴다.

## 아직 측정하지 않은 항목

| 지표 | 이유 / 계획 |
|---|---|
| 접속 오버헤드(세션 선택 → 프롬프트) | 원격이 같은 PC라 RTT 분리가 어렵다. 실제 LAN 서버에서 측정 필요 |
| SFTP 처리량(1GB, OpenSSH `sftp` 대비) | `pnpm perf`(M1.5)에서 측정 |
| 자동 재접속 성공률(30초 단절 20회) | toxiproxy 시나리오 스크립트 필요(M1.5 `pnpm perf`) |
| 패키징 빌드 기준 측정 | 지금은 E2E 빌드 기준. 패키징 빌드는 `pnpm smoke:packaged`로 동작만 확인 |
