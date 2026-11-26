// Vitest setupFiles: 테스트마다 만든 ResourceTracker의 누수를 자동 검사한다(AGENTS.md §6).
import { afterEach } from 'vitest';
import { assertTestTrackersDisposed } from './trackers';

afterEach(() => {
  assertTestTrackersDisposed();
});
