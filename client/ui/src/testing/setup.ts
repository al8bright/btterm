import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom에는 ResizeObserver가 없다. 레이아웃이 없으니 관찰만 받아 두는 대체물로 충분하다.
class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver ??= NoopResizeObserver;

afterEach(() => {
  cleanup();
});
