# btterm 디자인 가이드 (DESIGN)

| 항목 | 내용 |
|---|---|
| 버전 | v0.2 (2026-10-20) — [문서 종합 검토](./reviews/2026-10-20-doc-review.md)(AI 에이전트 13개 관점 검토) 반영 |
| 기준 | [mockup/](./mockup/index.html), [PRD.md](./PRD.md) |
| 범위 | M1 다크·라이트 UI(§2.7). macOS 변형은 §10 |
| 원천 | **단축키(§8.1)의 단일 원천은 이 문서다.** PRD·AGENTS는 이곳을 참조한다 |

목업은 v0.1 기준이다. 이 문서와 다르면 이 문서가 맞다(목업은 M0 0-D에서 갱신).

---

## 1. 원칙

1. **터미널이 주인공.** 앱 크롬은 무채색, 색은 상태와 강조에만. 터미널 폭은 패널에 양보하지 않는다(§4.3).
2. **기능 밀도는 MobaXterm, 표면은 단순하게.** 자주 쓰는 것은 화면에, 나머지는 패널·팔레트 뒤로.
3. **상태는 색만으로 전달하지 않는다.** 모양·텍스트·`aria-label`을 병행한다.
4. **위험한 동작은 기본값이 안전한 쪽.** 기본 포커스와 기본 버튼은 되돌릴 수 있는 쪽.
5. **상속은 보이게.** 점선 테두리 하나가 "상속됨"의 유일한 신호다(§5.8).
6. **최소 기준은 양보하지 않는다.** "낮은 대비 크롬"(1)보다 WCAG 최소 기준(§9)이 우선한다.
7. MobaXterm의 시각적 정체성(아이콘, 색, 메뉴 배치)은 따라 하지 않는다.

---

## 2. 색상 토큰

`client/ui/src/theme/tokens.css`의 CSS 커스텀 속성. 컴포넌트는 아래 **이름만** 쓴다(AGENTS §8).

### 2.1 표면
| 토큰 | 값 | 용도 |
|---|---|---|
| `--surface-base` | `#0F1115` | 앱 배경, 입력 배경 |
| `--surface-chrome` | `#13161B` | 헤더, 액티비티 바, 탭바, 상태바 |
| `--surface-panel` | `#161A20` | 사이드바, 도구 패널, 다이얼로그 |
| `--surface-sunken` | `#12161C` | 패널 안 보조 박스 |
| `--surface-raised` | `#1E232B` | hover, 배지, 칩 |
| `--surface-selected` | `#222833` | 선택 행, 세그먼트 선택 |
| `--surface-overlay` | `#0B0D10` | 다이얼로그·오버레이 패널 뒤 |

### 2.2 선
| 토큰 | 값 | 대비 | 용도 |
|---|---|---|---|
| `--border-subtle` | `#262B33` | 장식 | 영역 안 구분선(탭 사이, 패널 머리 등) |
| `--border-divider` | `#3A414C`, 굵기 `--divider-width` 2px | 장식 | **큰 영역 경계**: 헤더 아래, 액티비티 바·사이드바 오른쪽, 상태바 위, 도구 패널 왼쪽, 칸 경계 (2026-10-22 사용자 요청: 영역이 잘 안 구분됨) |
| `--border-control` | `#5F6874` | 3.35 / 3.09 / 3.21 (base / panel / sunken) | **입력·체크박스·라디오·보조 버튼 테두리** (WCAG 1.4.11) |
| `--border-dashed` | `#5F6874` (점선) | 위와 같음 | 상속 필드, 드롭 영역, "추가" 버튼 |

### 2.3 텍스트
대비는 `--surface-panel` 기준, WCAG 2.x 상대휘도 공식으로 계산.

| 토큰 | 값 | 대비 | 용도 |
|---|---|---|---|
| `--text-primary` | `#E6E8EB` | 14.2:1 | 본문, 제목 |
| `--text-secondary` | `#C9CED6` | 11.0:1 | 보조 값, 경로 |
| `--text-muted` | `#9AA3AE` | 6.8:1 | 라벨, 메타, 탭 닫기 아이콘 |
| `--text-faint` | `#6B7480` | 3.7:1 | **텍스트·아이콘·placeholder 사용 금지.** 장식 구분점만 |

### 2.4 의미 색
| 토큰 | 값 | 용도 |
|---|---|---|
| `--accent` | `#4C9BFF` | 주 버튼 배경, 선택 테두리 |
| `--accent-on` | `#0B0D10` | 주 버튼 글자(6.9:1) |
| `--accent-subtle-bg` | `#1B2A40` | 선택 행, 활성 칩, 토스트 배경 |
| `--accent-subtle-fg` | `#CFE3FF` | 위 배경 위 글자(11.1:1) |
| `--accent-border` | `#2E4A72` | 토스트 테두리 |
| `--focus-ring` | `#7DB5FF` | 포커스 링(패널 위 8.3:1) |
| `--success` | `#3FBF7F` | 연결됨, 검증 성공 |
| `--success-border` | `#23402F` | 검증 결과 박스 |
| `--warning` | `#F5A524` | 재접속 중, 경고 로그 |
| `--danger` | `#F26B6B` | 오류, production 표시 |
| `--danger-subtle-bg` | `#2A1A1C` | 경고 띠 |
| `--danger-strong-bg` | `#3A1D20` | 위험 아이콘 타일, 위험 배지 |
| `--danger-subtle-fg` | `#FFD7D7` | 위 배경 위 글자(11.6:1) |
| `--danger-border` | `#5A2A2E` | 위험 다이얼로그·경고 띠 테두리 |
| `--highlight` | `#FFD27A` | 검색 일치 |
| `--chip-var-bg` / `--chip-var-fg` | `#2A2140` / `#D9C6FF` | 스니펫 변수 칩(9.7:1) |

### 2.5 상태 토큰 (의미 → 의미 색)
| 토큰 | 참조 | 모양 |
|---|---|---|
| `--status-connected` | `--success` | 채운 원 7px |
| `--status-reconnecting` | `--warning` | 2px 테두리 원 |
| `--status-disconnected` | `--text-muted` | 1.5px 테두리 원 |

### 2.7 라이트 UI (F5.3, 2026-10-21 M1로 당김)

화면 모드는 시스템(기본) / 라이트 / 다크. `<html data-theme="light|dark">`로 고르고, 라이트는 `:root[data-theme='light']`에서 아래 값으로 토큰을 덮는다(이름은 같고 값만 다름). `color-scheme`도 맞춰 기본 컨트롤·스크롤바가 따라온다. 터미널 테마(F3.16)는 화면 모드와 따로 고른다.

| 토큰 | 라이트 값 | 비고 |
|---|---|---|
| `--surface-base` / `-chrome` / `-panel` / `-sunken` / `-raised` / `-selected` / `-overlay` | `#FFFFFF` / `#EEF0F3` / `#F6F7F9` / `#F0F2F5` / `#E4E7EC` / `#DCE3EE` / `#FFFFFF` | |
| `--border-subtle` / `--border-divider` / `--border-control` | `#D9DDE3` / `#B9BFC8` / `#8A929D` | control은 base 위 3.3:1 |
| `--text-primary` / `-secondary` / `-muted` | `#1A1D21` / `#3B424B` / `#5B6470` | muted는 panel 위 5.6:1 |
| `--accent` / `-on` / `-subtle-bg` / `-subtle-fg` / `--focus-ring` | `#1F6FEB` / `#FFFFFF` / `#DDEAFE` / `#0B3D91` / `#1F6FEB` | |
| `--success` / `--warning` / `--danger` | `#1A7F45` / `#9A6200` / `#C62828` | 흰 바탕 4.5:1 이상 |
| `--danger-strong-bg` / `-subtle-fg` / `-border` | `#FDE2E2` / `#8A1C1C` / `#F3B4B4` | |
| 아이콘 타일·팔레트 | 같은 색상의 진한 톤(흰 바탕 3:1 이상) | §2.6 |
| `--shadow-popover` / `--shadow-dialog` / `--scrim` | 그림자 불투명도 12% / 18%, scrim 35% | |

### 2.6 서버 아이콘 타일
| 종류 | 배경 / 전경 |
|---|---|
| web | `--icon-web-bg #1E2D45` / `--icon-web-fg #7DB5FF` |
| database | `--icon-db-bg #2A2140` / `--icon-db-fg #C4A6FF` |
| container | `--icon-box-bg #16302A` / `--icon-box-fg #5FD3A8` |
| 기타 | `--surface-raised` / `--text-secondary` |

사용자 지정 색(F1.11)은 전경 색만 받고, 배경은 전경의 18% 불투명도를 CSS 변수로 주입한다.

**내장 아이콘 21종(F1.11, 2026-10-21)**: server, web, database, container, router, cloud, terminal, monitor, laptop, cpu, storage, shield, lock, mail, code, branch, network, chart, flask, home, bolt. 24 격자 선 아이콘(stroke 1.75)으로 직접 그린다.

**아이콘 색 팔레트 10종**: blue, cyan, teal, green, lime, yellow, orange, red, pink, purple → `--icon-color-<이름>`. 저장값은 팔레트 이름(`IconRef.color`)이고, 모르는 값은 기본 색으로 보인다. 어두운 배경(`--surface-chrome`) 위에서 3:1 이상인 밝은 톤만 쓴다.

### 2.8 로고·앱 아이콘 (2026-10-22, 사용자 선택: "bt 모노그램")

| 항목 | 값 |
|---|---|
| 모양 | 둥근 사각 타일(256 격자, 240×240, 모서리 56) 위에 소문자 `bt`를 둥근 끝 선으로 그린다. 글꼴 글리프가 아니라 직접 그린 선이다 |
| 타일 | 대각 그라데이션 `--brand-tile-start #5AA6FF` → `--brand-tile-end #2F7FE8` |
| 글자 | `--brand-glyph #0B0D10` (타일 위 대비 4.9:1~7.7:1) |
| 크기별 원본 | 32px 이상 `icon.svg`(획 24), 16·24px `icon-small.svg`(획 32, `t` 꼬리 없음). `b`의 둥근 부분과 `t` 사이를 띄워 16px에서도 두 글자로 읽히게 한다 |
| 산출물 | `client/desktop/build/icon.ico`(16·24·32·48·64·128·256), `icon.png`(512). `pnpm icons`로 원본 SVG에서 다시 만든다 |
| 헤더 | 브랜드 글자 앞에 20px 로고(`icon-small` 형태) |

MobaXterm의 아이콘·색·명칭을 쓰지 않는다(원칙 7, AGENTS §5).

---

## 3. 타이포그래피·간격·모서리

| 역할 | 글꼴 | 크기 / 굵기 |
|---|---|---|
| UI 기본 | IBM Plex Sans KR (번들, OFL) | 13px / 400 |
| 브랜드 | 같음 | 14px / 600 |
| 다이얼로그 제목 | 같음 | 17px / 600 |
| 보조 | 같음 | 12px / 400 |
| 섹션 라벨 | 같음 | 11px / 600, letter-spacing 0.8px |
| 모노(UI) | JetBrains Mono (번들) | 11~13px |
| 터미널 | 사용자 선택, 기본 JetBrains Mono | 13px, line-height 1.6 |

| 토큰 | 값 |
|---|---|
| `--space-1`…`--space-10` | 4, 6, 8, 10, 12, 14, 16, 18, 24, 32 |
| `--radius-xs` / `-sm` / `-md` / `-lg` / `-pill` | 4 / 6 / 8 / 12 / 999 |
| `--motion-fast` / `--motion-base` / `--ease-out` | 120ms / 200ms / `cubic-bezier(.2,.8,.2,1)` (§8.3) |
| `--control-sm` / `-md` / `-lg` | 28 / 32 / 36 (작은 버튼 / 입력·버튼·메뉴 항목 / 대화상자 입력) |
| `--font-xs` / `-sm` / `-md` / `-lg` / `-xl` | 11 / 12 / 13 / 14 / 17px. 본문 line-height 1.5 |
| `--shadow-popover` / `--shadow-dialog` | 메뉴·토스트·찾기 막대·빠른 연결 목록 / 대화상자 |

그림자는 떠 있는 층(메뉴·토스트·대화상자)에만 쓴다. 고정 영역의 깊이는 표면 단계와 선으로만(UX 검토 U1·U4, 2026-10-21).

---

## 4. 레이아웃

### 4.1 영역
```
┌──────────────────────────────────────────────────────────── header 48 ─┐
│ [로고] [ 빠른 연결 ……………… Ctrl+Shift+K ]                [⚙] [창 버튼] │
├────┬──────────────┬────────────────────────────────────────────────────┤
│ 52 │ sidebar 300  │ tabbar 40 (칸마다) … [+][▥ 도구 패널]              │
│    │ 서버 트리     ├──────────────────────────────────┬─────────────────┤
│    │  또는         │ terminal                        ▐│ tool panel      │
│    │ SFTP          │                                 │ (활성 칸 안)    │
├────┴──────────────┴──────────────────────────────────┴─────────────────┤
│ status 28                                                              │
└────────────────────────────────────────────────────────────────────────┘
```

| 영역 | 크기 | 비고 |
|---|---|---|
| 헤더 | 48 | 창 드래그 영역(빠른 연결 필드·버튼은 no-drag) |
| 액티비티 바 | 52, 버튼 44×44 | |
| 사이드바 | 300(접기 가능, Ctrl+Shift+B) | |
| 탭바 / 상태바 | 40 / 28 | |
| 도구 패널 | 활성 칸 안 오른쪽, 340(칸 폭의 절반까지) | §4.3, §5.6 |
| 영역 경계 | 2px `--border-divider` | §2.2 |
| 최소 창 | 960×600 | |

### 4.2 창 크롬
- **Windows**: `titleBarStyle: 'hidden'` + `titleBarOverlay`. 헤더가 제목 표시줄을 겸하고, 최소화·최대화·닫기는 Windows가 헤더 오른쪽에 그린다(스냅 레이아웃·닫기 hover 빨강·비활성 흐림은 OS 기본). 2026-10-22 구현.
  - 높이 46(헤더 48 − 아래 구분선 2, 버튼 밑에서 구분선이 끊기지 않게). 색 `--surface-chrome`, 기호 `--text-secondary`. 화면 모드(라이트·다크·시스템)가 바뀌면 main이 `setTitleBarOverlay`로 다시 칠한다. main은 CSS를 읽을 수 없어 두 토큰 값을 복사해 두고, 단위 테스트가 `tokens.css`와 같은지 검사한다.
  - 끌기: 헤더 빈 곳만 `app-region: drag`. 빠른 연결 칸·버튼·목록은 `no-drag`. 끌기 영역 더블클릭 = 최대화/이전 크기, 우클릭 = 창 메뉴(OS 기본).
  - 오른쪽 여백: `env(titlebar-area-width)`로 버튼 영역만큼 비운다.
  - 첫 배경색: 저장된 화면 모드의 `--surface-base`(라이트로 켤 때 어두운 화면이 비치지 않게).
- **macOS(M2)**: `hiddenInset` + `trafficLightPosition`(헤더 48 세로 가운데). 헤더 왼쪽 92px 확보(macOS 26 신호등이 약 79px까지 온다, `--mac-traffic-light-inset`), 전체 화면에서는 여백 제거. 메뉴는 앱·편집·창의 표준 역할만 두고(SEC-8), 단축키 표기는 OS별 키맵에서 만든다.

### 4.3 터미널 폭 보호
| 창 폭 | 도구 패널 | 사이드바 |
|---|---|---|
| ≥ 1280px | 인라인(터미널 폭 감소, PTY resize 발생) | 펼침 |
| < 1280px | **오버레이**(터미널 위에 겹침, PTY resize 없음, 바깥 클릭·Esc로 닫힘) | 펼침, 사용자가 접을 수 있음 |
| < 960px | 오버레이 | 기본 접힘 |

터미널이 80열 미만이면 상태바에 `72×38` 처럼 열·행을 강조 표시한다.

---

## 5. 컴포넌트

### 5.0 상태 매트릭스 (모든 인터랙티브 컴포넌트 공통)
| 상태 | 규칙 |
|---|---|
| default | 각 컴포넌트 사양 |
| hover | 배경 한 단계 위(`--surface-raised`), 전환 `--motion-fast` |
| active(누름) | 배경 `--surface-selected` |
| focus-visible | `outline: 2px solid var(--focus-ring); outline-offset: 2px`. `outline:none` 금지(컨테이너는 `:focus-within`) |
| selected | `--accent-subtle-bg` + 필요 시 `--accent` 테두리 |
| disabled | 불투명도 0.4, `cursor: not-allowed`, 툴팁으로 이유 표시 |
| error | 테두리 `--danger`, 아래 12px 메시지(`--danger-subtle-fg`), `aria-invalid` + `aria-describedby` |
| loading | 목록은 행 높이 그대로 스켈레톤 3줄, 버튼은 라벨 유지 + 스피너 14px |
| empty | 아이콘 + 한 줄 설명 + 주 행동 버튼 1개(예: 빈 서버 트리 → "서버 추가", "~/.ssh/config 가져오기") |

### 5.1 앱 크롬
| 컴포넌트 | 사양 |
|---|---|
| 빠른 연결 필드 | 높이 30, `--surface-base`, 테두리 `--border-control`, 오른쪽 키캡 |
| 액티비티 버튼 | 44×44, `--radius-md`, 선택 시 `--surface-raised` + `--text-primary`. 서버 목록 / SFTP 두 개(도구 패널은 탭바의 패널 버튼·Ctrl+Shift+L, 결정 UX8) |
| 상태바 | 12px `--text-muted`, 연결 정보는 `--text-primary` + 상태 점, 전송 막대 80×4 |

### 5.2 서버 트리
| 요소 | 사양 |
|---|---|
| 행 | 높이 36, `--radius-sm`, 그룹당 들여쓰기 12, `role="treeitem"`, `aria-level/expanded/selected/setsize/posinset` |
| 아이콘 타일 | 24×24, 아이콘 14 (§2.6) |
| 상태 | 상태 점(§2.5) + 행의 `aria-label`에 "연결됨" 등 포함 |
| production | 3×14 막대 `--danger` + `aria-label`에 "production" |
| 그룹 헤더 | 높이 32, 600, 오른쪽에 상속 요약 11px. 펼침 화살표 + 폴더 아이콘 16(펼치면 열린 폴더), 색은 무채색 또는 그룹(상위 포함) 아이콘 색 |
| 키보드 | roving tabindex. ↑↓ 이동, ← 접기/부모, → 펼치기/자식, Enter 접속, F2 편집, Shift+F10·Menu 키 컨텍스트 메뉴, 문자 입력 시 타입어헤드 |
| 대량 | 평탄화 후 가상 스크롤(고정 행 높이) |
| 끌어 놓기 (F1.2a) | 행 위쪽 1/4 = 앞, 아래쪽 1/4 = 뒤(서버 행은 위·아래 절반), 그룹 행 가운데 = 그 그룹 안 맨 끝. 목록 아래 빈 곳 = 최상위 맨 끝. 앞/뒤는 행 위·아래 2px `--accent` 선, 안은 행 테두리 `--accent`. 고정 구역 행은 끌 수만 있고 놓을 곳이 아니다. 검색 중에는 끌지 않는다 |

### 5.3 SFTP 패널
| 요소 | 사양 |
|---|---|
| 따라가기 토글 | 필 26, ON: `--accent-subtle-bg` + `--accent` 테두리, OFF: 투명 + `--border-control`, `aria-pressed`. 동작 불가 셸이면 ⚠ + 툴팁 |
| 브레드크럼 | 높이 28, 모노 12, 클릭 이동 + 직접 편집 |
| 파일 목록 | 그리드 `1fr 64px 76px`, 행 28, 가상 스크롤, 선택 `--accent-subtle-bg` |
| 드롭 영역 | 점선 `--border-dashed`, 대상 경로 명시 |
| 폴더 전송 (F4.7, TR1) | 폴더를 고르면 "내려받기"가 폴더째, 머리줄에 "폴더 올리기" 버튼(폴더 선택 창). 탐색기에서 폴더를 끌어 놓아도 된다. 전송 목록에는 폴더 한 줄만: 폴더 아이콘 + 진행 "끝난 파일 수/찾은 파일 수", 취소하면 남은 하위 전송 모두 취소. 링크·특수 파일은 건너뛴다 |
| 로컬에서 편집 (F4.8, TR3) | 파일 행 메뉴·버튼 "로컬에서 편집": 앱 데이터 아래 임시 폴더로 받아 OS 기본 앱으로 연다. 실행 가능한 확장자(.exe .bat .cmd .ps1 .vbs .js .msi .lnk 등)는 열지 않고 이유를 보인다. 저장을 감지하면 사이드바 위 띠 "app.conf가 바뀌었습니다 · 업로드 · 무시"(자동 업로드 없음). 업로드는 원격 파일을 원자적으로 바꿔 넣는다. 탭을 닫으면 감시를 멈추고 임시 파일을 지운다 |
| 이어받기 (F4.7, TR2) | 실패한 줄에 "다시 시도"(같은 실행 동안). 누르면 남은 부분 파일 지점부터 잇는다. 취소는 부분 파일을 지운다 |

### 5.4 세션 탭
탭바는 칸(탭 그룹)마다 하나씩 그 칸 바로 위에 있다(§5.4b). 분할하지 않았을 때는 칸이 하나라 예전 위치와 같다.

| 상태 | 사양 |
|---|---|
| 활성 | 배경 = 터미널 배경, **글자 = 터미널 테마 fg, 닫기 = 테마 muted**, 위 2px 선택 선 |
| 탭 색 (F3.1) | 서버·그룹 편집의 "탭 색"(팔레트 10색, `HostDefaults.tabColor` 상속). 색이 있는 탭은 활성 여부와 상관없이 위 3px 색 띠(선택 선보다 우선). 빠른 연결 탭은 색 없음 |
| 이름 바꾸기 (F3.1b) | 탭 더블클릭·F2·메뉴 "이름 바꾸기" → 탭 자리에서 입력칸(Enter·포커스 잃음 = 확정, Esc = 취소, 빈 값 = 원래 이름). 이 실행 동안만 유지(저장 안 함). 툴팁에 원래 이름 |
| 비활성 | 투명, `--text-muted` |
| 밝은 터미널 테마 | 활성 탭 배경은 `--surface-chrome` 유지, 위 2px 탭 색 + 아래 2px `--accent`로 구분 |
| 닫기 | 탭 안 중첩 버튼 금지. 형제 버튼(`tabindex=-1`, `aria-label="web-01 탭 닫기"`, 24×24), 탭에서 Delete 키로도 닫기, 중클릭 닫기 |
| 접근성 | `role="tab"` + `aria-controls` → 터미널 `role="tabpanel"` |
| 활성 칸 표시 | 활성 칸 탭바의 선택 탭만 위 2px `--accent`. 다른 칸의 선택 탭은 위 2px `--text-muted` |
| 새 탭 | 칸마다 탭바 끝에 [+]. 누르면 그 칸이 활성이 되고 빠른 연결로 포커스 |
| 도구 패널 버튼 | [+] 오른쪽, 패널 아이콘 16(28×28 `iconbtn`), `aria-expanded`·`aria-controls`, 툴팁에 단축키. 그 칸에 패널이 열려 있으면 `--accent` 아이콘 + `--surface-raised` 배경. 다른 칸의 버튼을 누르면 그 칸이 활성이 되고 패널이 그 칸으로 옮겨 열린다. 터미널 위 손잡이는 두지 않는다(2026-10-22 사용자 요청: 손잡이가 눈에 잘 띄지 않고 탭 놓기와 겹침) |
| 우클릭 메뉴 | 이름 바꾸기 / 같은 서버를 오른쪽·아래에 열기 / 오른쪽으로 분할 / 아래로 분할 / 칸 합치기 (키보드: 메뉴 키·Shift+F10). 지금 배치에서 할 수 없는 항목은 없다 |

### 5.4d 빈 칸 (F1.2b, F6.9)
| 요소 | 사양 |
|---|---|
| 서버 카드 | 탭이 없는 칸 가운데 안내 아래. 고정 서버 먼저, 그다음 최근 접속 순으로 최대 8개. 카드 = 아이콘 타일 24 + 이름 + 주소(모노 11px), 180×56, `--surface-panel` + 1px `--border-subtle`, hover `--surface-raised`. 클릭·Enter = 접속. 저장된 서버가 없으면 카드 대신 "새 서버 추가" |
| 이전 탭 다시 열기 | 지난번 종료 때 탭이 있었으면 맨 위에 주 버튼 "이전 탭 N개 다시 열기". 누르면 칸 배치를 되살리고 각 탭을 연다(빠른 연결은 비밀번호를 다시 묻는다). 탭을 하나라도 열면 사라진다. 자동 재접속 없음(결정 DF8) |

### 5.4b 탭 그룹 분할 (F3.10a)
| 요소 | 사양 |
|---|---|
| 구조 | 작업 영역 = 칸(탭 그룹) 1~8개를 담은 나무. 칸 = 탭바 + 그 칸의 선택 탭 터미널. 분할 묶음마다 방향(좌우 또는 위아래)이 있고 묶음 안은 균등 분할. 어느 칸이든 다시 좌우·위아래로 나눌 수 있다 |
| 끌기 | 탭이 2개 이상일 때 탭을 끈다. 칸 터미널 위: 가장자리 근처(가장 가까운 변, 25% 안쪽) = 그 쪽에 새 칸, 가운데 = 그 칸으로 옮기기. 다른 칸 탭바의 탭 위 = 그 자리로 옮기기, 빈 곳 = 맨 끝으로. 미리보기는 `--accent-subtle-bg` + `--accent` 점선(새 칸은 절반, 옮기기는 칸 전체) |
| 배치 규칙 | 놓은 칸이 속한 묶음과 같은 방향이면 그 칸 옆에 끼우고, 다른 방향이면 그 칸 자리를 새 묶음(그 칸 + 새 칸)으로 바꾼다. 칸이 빠져 묶음에 하나만 남으면 묶음을 풀고, 부모와 방향이 같으면 합친다 |
| 제약 | 최대 8칸. 나누면 새 칸이 160×120px보다 작아지는 방향은 놓기 미리보기에 나오지 않는다. 탭이 하나뿐인 칸은 자기 칸 가장자리로 나눌 수 없다. 자기 칸 가운데에 놓으면 아무 일도 없다. 칸이 사라지면 같은 묶음의 이웃 칸이 활성 |
| 칸 경계 | 4px `--border-divider`(hover·끌기 `--accent`). 활성 칸 터미널은 안쪽 1px `--accent` 테두리 |
| 터미널 여백 | 터미널 둘레 여백은 그 탭의 터미널 테마 배경색. 화면 모드와 터미널 테마가 달라도(라이트 화면 + 어두운 터미널) 액자처럼 보이지 않게 |
| 활성 | 칸의 터미널·탭을 누르면 그 칸이 활성. 새 연결은 활성 칸에 열린다. 배너·찾기·도구 패널은 활성 칸 기준 |
| 해제 | 칸의 마지막 탭을 닫거나 옮기면 칸이 사라진다. 탭 메뉴 "칸 합치기"는 모든 탭을 활성 칸 하나로 모은다 |
| 크기 | 칸에서 숨겨진 탭도 그 칸 크기를 유지해 원격 PTY 크기가 오가지 않는다 |

### 5.4c 서버 상태 줄 (F3.18)
| 요소 | 사양 |
|---|---|
| 위치 | 칸마다 터미널 아래 24px 줄(`--surface-chrome`, 위 1px `--border-subtle`). 그 칸의 선택 세션 기준 |
| 항목 순서 | OS · CPU · RAM · 네트워크(↑ 업로드 ↓ 다운로드) · 가동 · 아이디 · 디스크. 라벨 `--text-muted` + 값 `--text-primary`, 항목 사이 `--space-6` |
| 값 형식 | CPU `12%`, RAM·디스크 `1.2 / 3.8 GB`, 네트워크 `12 KB/s`, 가동 `3일 4시간`(1일 미만은 `5시간 12분`). 모르는 값은 `—` |
| 넘침 | 스크롤바 없음. 넘치면 양 끝에 ◀ ▶ 버튼(24×24, `aria-label`), 끝에 닿은 쪽은 비활성. 한 번에 보이는 폭의 80%씩 이동 |
| 상태 | 연결 중·끊김이면 항목 대신 상태 문구. 서버가 Linux가 아니면 아는 항목만 |
| 갱신 | 3초. 보이는 칸의 ready 세션만 조회 |
| 끄기 | 서버 편집 "서버 상태 줄": 자동(그룹 값 상속, 없으면 production·prod 태그면 끔) / 켜기 / 끄기. 꺼진 서버는 줄을 그리지 않고 원격 명령도 실행하지 않는다 |

### 5.5 터미널 위 요소
| 요소 | 사양 |
|---|---|
| 토스트 | 대화상자(scrim)보다 아래 층. 오른쪽 아래(상태바·서버 상태 줄 위, 칸 탭바·상태 줄을 가리지 않게), `--accent-subtle-bg` + `--accent-border`, `role="status"`. 정보 토스트 4초(hover·focus 중 유지), **오류 토스트는 자동으로 닫지 않음** + "로그 보기" |
| 끊김 배너 | 터미널 상단 띠, 사유 + [재접속 R] [닫기 Esc], 터미널 내용 유지 |
| 연결 실패 | 탭 본문에 오류 코드별 메시지(F6.5) + 다음 행동 버튼 |

### 5.6 터미널 도구 패널
| 요소 | 사양 |
|---|---|
| 디자인 탭 순서 | 화면 모드(앱 전체)를 맨 위에 따로 두고, 구분선 아래 "터미널" 묶음: 적용 범위 → 테마 → 글꼴 → 크기·커서. 적용 범위가 화면 모드에도 걸리는 것처럼 보이지 않게 |
| 위치 | 활성 칸 안, 터미널 오른쪽(터미널 폭이 줄고 PTY resize). 폭 340, 칸 폭의 50%를 넘지 않음. 활성 칸이 바뀌면 따라간다. 왼쪽 2px `--border-divider` (결정 UX8) |
| 탭 | 디자인 / **명령 기록** / 스니펫. 높이 36, 선택 시 아래 2px `--accent` |
| 테마 카드 | 패널 폭 ≥ 360이면 3열, 미만이면 2열. 미리보기 44, 선택 테두리 2px `--accent`. 대비 경고 테마는 배지 표시 |
| 글꼴 행 | 높이 36, 해당 글꼴로 이름 + `가나다 0O1lI` |
| 크기 / 커서 | 스테퍼 32×32(10~20) / 세그먼트 블록·밑줄·막대 |
| 적용 범위 | M1: 이 탭 / 전체 기본값. M1.5: 이 서버 / 그룹 |
| 기록 검색 | 높이 36 입력, 필터 칩, 항목 = 명령(모노, 일치 `--highlight`) + 메타 11px + 출처(원격 파일 / 셸 통합) |
| 기록 입력 규칙 | Enter = 커서 위치에 **입력만**(`term.paste()`, 제어문자·개행 제거). alternate buffer(vim 등)에서는 비활성 + 이유 표시. Shift+Enter 실행은 M1.5(셸 통합으로 프롬프트 상태를 알 때만, 실행 `\r`은 paste 괄호 밖에서) |
| 스니펫 카드 | 명령 모노, 변수 칩, 버튼: 실행(주) / 입력만 / 모든 탭(production 포함 시 확인 체크) |
| 스니펫 (1단계, DF7) | 목록 = 이름 + 명령 한 줄 미리보기(모노, 말줄임). 행 버튼: 입력만 / 실행 / 편집 / 삭제. [+ 새 스니펫] → 이름·명령 폼. 명령의 `{{이름}}`은 실행 전 작은 폼으로 값을 묻는다. 활성 탭이 없거나 alternate buffer면 버튼 비활성 + 이유. production 태그 서버에서 `sudo`가 들어간 스니펫을 실행하면 확인. 저장은 설정 파일 `snippets`(최대 200개, 이름 80자, 명령 4000자). "모든 탭"은 M2 |

### 5.6b 명령 팔레트 (F5.1b, DF6)
| 요소 | 사양 |
|---|---|
| 열기 | Ctrl+Shift+P. 화면 위쪽 가운데 폭 560 모달(배경 scrim), 입력 + 목록 최대 12행(행 36) |
| 항목 | 앱 동작(키맵 §8.1, 이름 + 단축키) · 저장된 서버(아이콘 + 이름 + 주소) · 열린 탭(상태 점 + 이름). 비우면 동작 목록 |
| 접두사 | `>` 동작만, `#` 열린 탭만, 없으면 셋을 섞어 퍼지 점수 순 |
| 키 | ↑↓ 이동, Enter 실행, Esc 닫기. 실행 뒤 원래 포커스(대개 터미널)로 |

### 5.7 다이얼로그
| 요소 | 사양 |
|---|---|
| 컨테이너 | 폭 560~640, padding 24, `--radius-lg`, 간격 18, 포커스 트랩, Esc 닫기, 닫힌 뒤 포커스는 연 요소로 복귀 |
| 위험 다이얼로그 | 테두리 `--danger-border`, 40×40 아이콘 타일 `--danger-strong-bg`, `role="alertdialog"` |
| 버튼 종류 | 주: `--accent` / `--accent-on`. **안전 기본**: `--text-primary` 배경 + `--surface-base` 글자(위험 다이얼로그의 "연결 취소"). 위험: 투명 + `--danger` 테두리·글자. 보조: 투명 + `--border-control`. 높이 40 |
| **버튼 순서** | **Windows: [주 동작] [취소]** (오른쪽 정렬). macOS: [취소] [주 동작]. 부가 동작(연결 테스트)은 왼쪽 끝. 순서는 플랫폼 변수로 |
| 기본 포커스 | 일반: 주 동작. 위험: 안전 기본 버튼 |
| 이동 | 제목줄(h2, 커서 move)을 끌어 옮긴다. 창 전체가 화면 안에 남게 막고, 위치는 기억하지 않는다(다시 열면 가운데) |
| 위험 확인 | 체크박스를 켜야 위험 버튼 활성 |
| **셸 통합 동의** | 대상 서버·계정, 추가될 파일 경로(`~/.config/btterm/shell.sh`, rc 파일), rc에 들어갈 한 줄 원문, 공유 계정 경고, [설치] [이번만 건너뛰기] [이 서버에서 다시 묻지 않기]. 설치 후 "제거" 경로 안내 |

### 5.9 키·알려진 호스트 관리 (F7, F2.4b)
| 요소 | 사양 |
|---|---|
| 키 만들기 (F7.7, TR4) | 키 관리 창의 [새 키 만들기]: 이름, 종류(ed25519 기본 / RSA 4096), passphrase(선택, 확인 입력), 저장 위치(보관소 / 파일로 내보내기). 만든 뒤 공개키 한 줄과 [복사] |
| 서버에 등록 (F7.8, TR5) | 키 행 메뉴 "서버에 등록": 연결된 탭 고르기 → `~/.ssh`(700)·`authorized_keys`(600) 확인 후 없을 때만 한 줄 추가. 결과 문구: 등록함 / 이미 있음 / 권한 문제 |
| 알려진 호스트 (F2.4b, TR6) | 키 관리 창의 탭 또는 팔레트 "알려진 호스트": 호스트:포트 · 키 종류 · 지문(SHA256, 모노) · [삭제] 버튼(확인 후 삭제). 검색 칸. 사용자 `~/.ssh/known_hosts`에서 읽은 항목은 읽기 전용 표시 |
| 키 불일치 경고 | 지금처럼 차단만(SEC-3). 본문에 "서버를 다시 설치했다면 알려진 호스트에서 이 서버의 키를 지운 뒤 다시 연결하세요" + [알려진 호스트 열기] 버튼(연결은 취소된 채) |

### 5.10 계정·동기화 — 제외(2026-11-26)

F8을 범위에서 뺐으므로(나중에 다시 검토, [공개 범위](./decisions/2026-11-26-public-scope.md)) 상태바 동기화 표시·계정 대화상자·팔레트의 계정/동기화 동작은 없다. 자동 업데이트(F5.6)도 제외라 업데이트 알림이 없다.

### 5.8 폼
| 요소 | 사양 |
|---|---|
| 라벨 | 위 12px `--text-muted`, 간격 6 |
| 입력 | 높이 36, `--radius-sm`, 테두리 `--border-control`. 호스트·포트·경로는 모노 |
| **상속 필드** | 점선 테두리(`--border-dashed`) + 값 `--text-muted` + 오른쪽 "[그룹명]에서 상속" + [재정의]. 배경은 바꾸지 않는다. `aria-describedby`로 출처 |
| 재정의됨 | 실선 테두리 + 일반 값 + 끝에 ↺ 아이콘 버튼("상속값으로 되돌리기") |
| 선택 카드 | 2열, 선택 시 `--accent-subtle-bg` + 2px `--accent` |
| 검증 결과 | 성공: `--success-border` + 체크 아이콘 + 배지 |
| 아이콘 선택 | 44×44 타일 격자(`role="radiogroup"`), 첫 칸 "그룹 값 사용", 선택 시 2px `--accent`, 각 타일 `aria-label`=아이콘 이름(한국어), 마지막에 점선 "이미지"(M1.5) |
| 색 선택 | 26px 원 + 선택 시 2px `--text-primary` 테두리, 각 색 `aria-label`, 첫 원 "기본 색". 아이콘을 "그룹 값 사용"으로 두면 색도 그룹 값을 따른다(비활성) |
| 연결 직후 명령 (F6.11) | 서버 편집 고급 설정·그룹 기본값의 한 줄 입력(모노). 비우면 그룹 값. 셸이 준비될 때마다(재접속 포함) 1회 입력 + Enter |

---

## 6. 아이콘

- Lucide 계열 선 아이콘(MIT, 번들), viewBox 24, stroke 2, round.
- 크기 12 / 14 / 16 / 18~20 / 22. 장식은 `aria-hidden`, 아이콘 버튼은 `aria-label`. 이모지 금지.
- 이름: terminal, server, folder, arrows-up-down, globe, database, box, cloud, router, link, key, alert-triangle, check, search, plus, settings, chevron.

---

## 7. 터미널 테마

- 테마 원천은 `client/core/src/themes/*.json`. 형식은 xterm `ITheme` 전 필드: `background`, `foreground`, `cursor`, `cursorAccent`, `selectionBackground`(반투명), `selectionForeground`, `selectionInactiveBackground`, ANSI 16색(`black`…`brightWhite`), 스크롤바 색.
- 아래 표는 요약(목업에 쓰인 역할). **muted = brightBlack**.
- xterm `minimumContrastRatio: 4.5`를 기본 ON(설정에서 끌 수 있음). 원색이 4.5 미만인 테마는 카드에 "대비 보정" 배지.
- 테마 로드 시 zod로 검증한다(색은 `#RRGGBB(AA)`만, 알 수 없는 키 거부, 파일 크기 상한). 가져오기(M1.5)는 외부 엔티티를 막은 plist 파서만.

| 테마 | 시점 | bg | fg | green | blue | yellow | red | muted | 4.5 미만(보정 대상) |
|---|---|---|---|---|---|---|---|---|---|
| btterm Dark (기본) | M1 | `#0B0D10` | `#D5DAE1` | `#3FBF7F` | `#7DB5FF` | `#F5A524` | `#F26B6B` | `#9AA3AE` | 없음 |
| One Dark | M1 | `#282C34` | `#ABB2BF` | `#98C379` | `#61AFEF` | `#E5C07B` | `#E06C75` | `#8B929E` | red 4.38, muted 4.47 |
| GitHub Light | M1 | `#FFFFFF` | `#24292F` | `#116329` | `#0550AE` | `#7D4E00` | `#CF222E` | `#57606A` | 없음 |
| Dracula | M1(2026-10-22) | `#282A36` | `#F8F8F2` | `#50FA7B` | `#BD93F9` | `#F1FA8C` | `#FF5555` | `#A0A7C4` | 없음(red 4.53) |
| Solarized Dark | M1(2026-10-22) | `#002B36` | `#93A1A1` | `#859900` | `#268BD2` | `#B58900` | `#DC322F` | `#839496` | blue 4.08, red 3.25, brightBlack=bg 주의 |
| Gruvbox Dark | M1(2026-10-22) | `#282828` | `#EBDBB2` | `#B8BB26` | `#83A598` | `#FABD2F` | `#FB4934` | `#A89984` | red 4.29 |
| Solarized Light | M1(2026-10-22) | `#FDF6E3` | `#657B83` | `#859900` | `#268BD2` | `#B58900` | `#DC322F` | `#93A1A1` | fg 4.13, green 2.97, blue 3.41, yellow 2.98, red 4.29, muted 2.48 |
| Nord | M1(2026-10-22) | `#2E3440` | `#D8DEE9` | `#A3BE8C` | `#81A1C1` | `#EBCB8B` | `#BF616A` | `#4C566A` | red 3.05, muted 1.69 |
| Monokai | M1(2026-10-22) | `#272822` | `#F8F8F2` | `#A6E22E` | `#66D9EF` | `#E6DB74` | `#F92672` | `#75715E` | red 3.93, muted 3.03 |

- 적용 우선순위: 탭 미리보기 > 서버 > 그룹 > 전체 기본값(`resolveEffectiveSettings`). 테마는 xterm `options.theme`과 `--term-*` CSS 변수에 한 함수로 동시에 반영한다.
- 커서: 블록(기본) / 밑줄 / 막대(`cursorWidth: 2`), 비활성 탭은 `cursorInactiveStyle: 'outline'`.

---

## 8. 상호작용

### 8.1 단축키 (단일 원천)

**메뉴 규칙:** Electron 기본 메뉴를 쓰지 않는다. 앱 메뉴는 이 표에서 생성하고, Ctrl+(문자) 가속키(reload, close, zoom, devtools)를 두지 않는다(AGENTS SEC-8). 터미널에 포커스가 있을 때는 xterm `attachCustomKeyEventHandler`에서 이 표의 키만 가로채고(`e.code` 기준, IME 조합 중 `isComposing`이면 무시) `preventDefault` 후 `false`를 반환한다.

| 동작 | Windows | macOS(M2) |
|---|---|---|
| 서버 검색·빠른 연결 | Ctrl+Shift+K | Cmd+Shift+K |
| 명령 팔레트(M1.5) | Ctrl+Shift+P | Cmd+Shift+P |
| 새 탭 / 탭 닫기 | Ctrl+Shift+T / Ctrl+Shift+W | Cmd+T / Cmd+W |
| 탭 이동(활성 칸 안에서 순환) | Ctrl+Shift+PgUp / PgDn | Cmd+Shift+[ / ] |
| 활성 칸의 N번째 탭(9 = 마지막) | Ctrl+Shift+1~9 | Cmd+1~9 |
| 칸 포커스 이동(칸 2개 이상일 때만) | Ctrl+Alt+←→↑↓ | Cmd+Option+←→↑↓ |
| 칸 크기 조절(칸 2개 이상일 때만, 5%씩) | Ctrl+Alt+Shift+←→↑↓ | Cmd+Option+Shift+←→↑↓ |
| 같은 서버로 오른쪽 분할 | Ctrl+Shift+D | Cmd+D |
| 복사 / 붙여넣기 | Ctrl+Shift+C / Ctrl+Shift+V, Ctrl+Insert / Shift+Insert | Cmd+C / Cmd+V |
| 스크롤백 한 페이지 / 한 줄 | Shift+PgUp·PgDn / Ctrl+Shift+↑·↓ | Shift+PgUp·PgDn / Cmd+↑·↓ |
| 스크롤백 지우기 | Ctrl+Shift+Delete | Cmd+K |
| 사이드바 / SFTP 포커스 | Ctrl+Shift+B / Ctrl+Shift+E | Cmd+B / Cmd+Shift+E |
| 터미널 검색 | Ctrl+Shift+F | Cmd+F |
| 재접속 | Ctrl+Shift+R | Cmd+Shift+R (Cmd+R은 쓰지 않음) |
| 도구 패널 / 명령 기록 | Ctrl+Shift+L / Ctrl+Shift+H | Cmd+Shift+L / Cmd+Shift+H |
| 영역 순환 | F6 / Shift+F6 | F6 / Shift+F6 |

- Ctrl+Alt+방향키는 칸이 하나면 가로채지 않고 터미널로 보낸다. Ctrl+6(^^)·Ctrl+2(^@)는 Shift 없이 누르면 그대로 터미널로 간다.
- Ctrl+(문자), Alt+(문자)는 항상 터미널로 전달한다. Ctrl+Tab도 전달한다(향후 modifyOtherKeys 대비, 현재는 Tab과 구분되지 않음).
- alternate buffer(vim, less)에서는 스크롤 키를 원격으로 전달한다.
- macOS: `macOptionIsMeta` 기본 ON(설정 가능), `macOptionClickForcesSelection: true`.

### 8.2 마우스
- 터미널: 선택 = 복사, 우클릭 = 붙여넣기(`rightClickSelectsWord: false`, 기본 컨텍스트 메뉴 차단). 원격 앱이 마우스 모드(`term.modes.mouseTrackingMode !== 'none'`)면 우클릭은 원격으로, **Shift+우클릭 = 강제 붙여넣기, Shift+드래그 = 강제 선택**.
- 서버 행: 더블클릭 = 접속, 우클릭 = 컨텍스트 메뉴.
- 탭: 중클릭 = 닫기, 탭바 위로 드래그 = 순서 변경·칸 옮기기, 터미널 위로 드래그 = 분할·칸 옮기기(§5.4b). 우클릭 = 탭 메뉴.
- 드롭: `webUtils.getPathForFile`로 경로를 얻는다(sandbox).

### 8.3 모션 (UX 검토 U1, 2026-10-21)
- 토큰: `--motion-fast` 120ms(색·그림자), `--motion-base` 200ms(이동·크기·등장), `--ease-out` `cubic-bezier(.2,.8,.2,1)`. `prefers-reduced-motion`이면 토큰을 0으로 바꿔 한 곳에서 끈다.
- hover·active: 버튼·탭·트리 행·메뉴 항목·파일 행은 배경·테두리·글자색을 `--motion-fast`로 바꾸고, 버튼은 누를 때 `scale(.97)`.
- 등장: 오버레이 opacity 0→1, 대화상자·메뉴·토스트 `translateY(6px)`·opacity 0에서 `--motion-base`. 퇴장 애니메이션은 두지 않는다.
- 연결 중 상태 점은 1.2s 펄스. 끌기 중인 원본(탭·트리 행)은 opacity .5.

---

## 9. 접근성

| 항목 | 기준 |
|---|---|
| 텍스트 대비 | 4.5:1 이상(§2.3). `--text-faint`는 텍스트에 쓰지 않는다 |
| 비텍스트 대비 | 입력 테두리·아이콘·포커스 링 3:1 이상(§2.2) |
| 클릭 대상 | 24×24 이상(WCAG 2.5.8). 밀집 행 28, 주요 버튼 40, 액티비티 44 |
| 포커스 | 항상 표시(§5.0). F6으로 헤더 → 사이드바 → 탭바 → 터미널 → 도구 패널 → 상태바 순환. 터미널은 Tab을 소비하므로 F6이 유일한 탈출 경로 |
| 역할 | 탭바 `tablist/tab/tabpanel`, 서버 트리 `tree/treeitem`(§5.2), 토글 `aria-pressed`, 손잡이 `aria-expanded`, 경고 `alertdialog`, 토스트 `status` |
| 상태 전달 | 시각 라벨이 없을 때도 `aria-label`에 상태·production 포함 |
| 고대비 | **M1부터** `@media (forced-colors: active)`: 포커스는 outline(시스템 색), 상태 점은 `forced-color-adjust: none` + 모양 유지, 테두리는 `CanvasText` |
| 스크린리더 | 설정에서 xterm `screenReaderMode` 켜기, 스크린리더 감지 시 제안. 대량 출력은 요약 알림 |
| 시간 | 정보 토스트는 hover·focus 중 유지, 오류는 수동 닫기 |

---

## 10. 향후 변형

| 항목 | 방향 | 시점 |
|---|---|---|
| 라이트 UI | §2.7로 구현 | M1(2026-10-21 당김) |
| macOS | §4.2, §8.1 오른쪽 열, 시스템 메뉴바 | M2 |
| 목업 갱신 | 이 문서 v0.2 반영 + 끊김 배너, 연결 실패, 빈 서버 트리, 셸 통합 동의 | M0 0-D |
| 목업 추가 | 전송 큐 패널, 키 목록, 가져오기 마법사, 온보딩 | 해당 기능 착수 1주 전 |

---

## 11. 구현 지침

| 주제 | 결정 |
|---|---|
| 스타일 | CSS Modules + `tokens.css`. stylelint `color-no-hex`, `declaration-strict-value`(color, background, border-color, border-radius, gap, padding, margin). 예외: `tokens.css`, 테마 JSON |
| 상태 | 외부 store(zustand 또는 `useSyncExternalStore` 기반) + selector 구독. 슬라이스: sessions / tabs / profiles / sftp / transfers / ui. 진행률·지연시간은 250ms throttle. **터미널 바이트는 store를 거치지 않는다** |
| xterm 생명주기 | `TerminalRegistry`(sessionId → Terminal·addon·port)가 React 밖에서 소유. `TerminalView`는 컨테이너에 attach/detach. 비활성 탭은 mount 유지 + `visibility:hidden`, 크기 0이면 fit·resize 차단. WebGL addon은 활성 탭 전환 시 dispose/load, ResourceTracker 등록. StrictMode 이중 mount에 안전해야 한다 |
| API 주입 | `BtTermApi` 타입은 core zod 스키마에서 유도. `<ApiProvider api>`로 주입, `window.btterm`은 엔트리에서 한 번만 읽는다. `FakeBtTermApi`는 이벤트 emit 헬퍼 제공, preload와 같은 계약 테스트 |
| xterm 테스트 | `TerminalEngine` 포트로 감싸 RTL에서는 fake, 실제 xterm은 `@xterm/headless`와 E2E |
| i18n | 타입 있는 키 사전(`ko.ts satisfies Messages`), 리터럴 금지 린트. core 오류는 코드 → UI에서 메시지로 |
| 설정 저장 | 패널 열림·마지막 탭·탭 복원 상태는 `window.btterm.settings`(F6.7 파일). localStorage 금지 |
| 컴포넌트 | AppChrome, ActivityBar, QuickConnect, ServerTree, SftpPanel, TransferQueue, SessionTabs, TerminalView, ToolPanel(DesignTab, HistoryTab, SnippetTab), Toast, DisconnectBanner, ConnectionError, ContextMenu, ConfirmDialog(링크 열기·여러 줄 붙여넣기), HostKeyDialog, HostEditDialog, KeyAddDialog, ShellIntegrationDialog, StatusBar |
| 자동 검증 | `tokens.css` 텍스트 토큰 쌍 대비 계산 테스트, 키맵 "Windows는 Ctrl+Shift 외 앱 단축키 없음" 테스트, `vitest-axe`로 역할·이름·포커스 트랩 |
