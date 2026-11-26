import { watch, type FSWatcher } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

const SETTLE_MS = 500;

/**
 * 로컬 편집 파일의 저장을 감시한다(F4.8). 편집기 다수가 "새 파일에 쓰고 이름 바꾸기"로 저장하므로
 * 파일이 아니라 그 폴더를 보고, 0.5초 모아 크기·수정 시각이 바뀌었을 때만 알린다.
 */
export function watchFile(path: string, onChange: () => void): () => void {
  const name = basename(path);
  let last = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  void stat(path).then(
    (info) => (last = `${info.size}:${info.mtimeMs}`),
    () => undefined,
  );
  const check = async () => {
    const info = await stat(path).catch(() => null);
    if (!info) return;
    const now = `${info.size}:${info.mtimeMs}`;
    if (now === last) return;
    last = now;
    onChange();
  };
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(dirname(path), (_event, changed) => {
      if (changed !== null && changed !== name) return;
      clearTimeout(timer);
      timer = setTimeout(() => void check(), SETTLE_MS);
    });
    watcher.on('error', () => undefined);
  } catch {
    // 감시를 못 하면 바뀜 알림만 없다(업로드는 다시 열어서)
  }
  return () => {
    clearTimeout(timer);
    watcher?.close();
  };
}
