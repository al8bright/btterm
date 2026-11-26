import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { shell } from 'electron';
import { isExecutableName, isOpenableUrl, isPlainTextName } from '@btterm/core';
import { localPlatform, plainTextEditor } from '../../platform/paths';

/** SEC-6: 외부 열기는 이 모듈에서만. http(s)만 허용하고 파싱한 URL로 연다. */
export async function openExternalUrl(url: string): Promise<boolean> {
  if (!isOpenableUrl(url)) return false;
  await shell.openExternal(new URL(url).toString());
  return true;
}

/**
 * 로컬 편집(F4.8): 텍스트 허용 목록만 OS 기본 앱으로 열고, 나머지는 텍스트 편집기로 연다.
 * 기본 동작은 .py·.sh 같은 스크립트를 실행할 수 있다(SEC-11, 보안 리뷰 H1).
 */
export async function openLocalFile(path: string): Promise<boolean> {
  const name = basename(path);
  const platform = localPlatform();
  if (isExecutableName(name, platform)) return false;
  if (isPlainTextName(name, platform)) return (await shell.openPath(path)) === '';
  const editor = plainTextEditor();
  if (!editor) return false;
  return new Promise((resolve) => {
    const child = spawn(editor.command, [...editor.args, path], {
      shell: false,
      detached: true,
      stdio: 'ignore',
    });
    child.once('spawn', () => {
      child.unref();
      resolve(true);
    });
    child.once('error', () => resolve(false));
  });
}
