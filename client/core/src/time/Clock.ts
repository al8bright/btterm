export type Cancel = () => void;

/** 시간 포트. 도메인 코드는 Date.now·setTimeout 대신 이것만 쓴다(AGENTS.md §3). */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): Cancel;
}
