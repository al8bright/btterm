import { ResourceTracker, type HostToMainControl } from '@btterm/core';
import { createHostControl } from './hostControl';
import { Ssh2Transport } from './ssh/Ssh2Transport';

// session host(utilityProcess) 진입점. ssh2는 이 프로세스에서만 로드한다(AGENTS §3).
// 메시지 처리는 hostControl.ts(테스트에서 parentPort 없이 돌린다).

const control = createHostControl({
  post: (message: HostToMainControl) => process.parentPort.postMessage(message),
  transport: new Ssh2Transport(),
  tracker: new ResourceTracker(),
});

process.parentPort.on('message', (event) => control.onMessage(event.data, event.ports));
