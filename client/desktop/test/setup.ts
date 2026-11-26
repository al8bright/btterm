// desktop 단위 테스트에도 자원 누수 자동 검사를 건다(AGENTS.md §6).
import { afterEach } from 'vitest';
import { assertTestTrackersDisposed } from '@btterm/core/testing';

afterEach(() => {
  assertTestTrackersDisposed();
});
