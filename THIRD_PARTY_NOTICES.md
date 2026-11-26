# 서드파티 고지

## 코드

btterm은 다른 프로젝트의 코드를 복사하지 않았다. Tabby·electerm(MIT)은 설계 참고만 했다. 앞으로 다른 프로젝트의 코드를 가져오면 원본 저작권 헤더를 유지하고 이 파일에 적는다([AGENTS.md §5](AGENTS.md#5-클린룸라이선스)).

## 터미널 테마 팔레트

`client/ui/src/terminal/themes.ts`의 내장 터미널 테마는 아래 공개 색 구성을 바탕으로 값을 일부 조정했다(대비 보정 등).

| btterm 테마 | 출처 | 라이선스·비고 |
|---|---|---|
| btterm Dark | btterm 자체(DESIGN §7) | MIT(이 저장소) |
| One Dark | Atom One Dark | MIT |
| Dracula | Dracula Theme | MIT |
| Nord | Nord(Arctic Ice Studio) | MIT |
| Gruvbox Dark | Gruvbox | MIT |
| Solarized Dark / Solarized Light | Solarized(Ethan Schoonover) | MIT |
| GitHub Light | GitHub Primer 계열 색 구성 | MIT. btterm은 GitHub와 관계가 없다 |
| Monokai | Monokai(Wimer Hazenberg) | 색 구성만 참고 |

## 번들 의존성

앱이 설치 파일에 함께 넣는 의존성(Electron, React, xterm.js, ssh2 등)의 라이선스 고지는 설치 파일을 배포하기 전에 별도 고지 파일로 넣는다.
