import { ResourceTracker } from '../resource/ResourceTracker';

const active: ResourceTracker[] = [];

/** 테스트에서 쓰는 tracker. setup.ts가 각 테스트 뒤에 누수를 검사한다. */
export function newTestTracker(): ResourceTracker {
  const tracker = new ResourceTracker();
  active.push(tracker);
  return tracker;
}

export function assertTestTrackersDisposed(): void {
  const trackers = active.splice(0);
  for (const tracker of trackers) tracker.assertAllDisposed();
}
