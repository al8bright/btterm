import type { Clock } from '@btterm/core';

/** 실제 시계. core는 이 구현을 주입받는다(AGENTS §3). */
export const nodeClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};
