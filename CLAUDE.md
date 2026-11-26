@AGENTS.md

## Claude Code 전용

- 라이브러리 API(Electron, xterm.js, ssh2, electron-builder 등)는 사용 전에 현재 문서로 확인한다. 버전 기준은 `docs/PRD.md` §5.5.
- 일반 서브에이전트(general-purpose, executor 계열)는 이 파일을 로드한다. **Explore·Plan 에이전트, `omitClaudeMd` 에이전트, 외부 CLI(`omc ask` 등)** 에 구현·리뷰를 맡길 때만 AGENTS.md §3·§4를 프롬프트에 직접 넣는다.
- AGENTS.md §4의 보안 검토 트리거에 해당하면 `security-reviewer` 에이전트로 별도 리뷰 패스를 돈다. 쓸 수 없으면 구현과 다른 세션에서 §4 체크리스트로 검토한다.
- 하위 디렉터리 지침이 필요해지면(`client/core`, `client/ui`, `client/desktop/src/session-host`) 그 디렉터리에 `AGENTS.md` + `@AGENTS.md` 한 줄짜리 `CLAUDE.md`를 둔다.
