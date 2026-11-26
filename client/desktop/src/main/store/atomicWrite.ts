import { open, rename, rm } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

let tmpSeq = 0;

/**
 * 텍스트 파일을 원자적으로 쓴다(F6.2): 임시 파일 → fsync → rename.
 * beforeReplace는 바꿔 넣기 직전에 부른다(백업 등). 실패하면 임시 파일을 지운다.
 */
export async function writeTextAtomic(
  path: string,
  text: string,
  beforeReplace?: () => Promise<void>,
): Promise<void> {
  const tmp = `${path}.tmp-${process.pid}-${++tmpSeq}`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(text, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await beforeReplace?.();
    await renameWithRetry(tmp, path);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

/** Windows에서 백신·인덱서가 파일을 잡고 있으면 rename이 EPERM/EBUSY로 실패한다. 짧게 재시도한다. */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 1; ; i++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (i >= attempts || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw error;
      await delay(20 * i);
    }
  }
}
