import { readFile, stat } from 'node:fs/promises';

/** 크기 상한을 넘거나 일반 파일이 아니면 읽지 않는다(키 파일 경로로 대용량 파일을 줘 메모리를 고갈시키는 것 방지). */
export async function readLimitedFile(path: string, maxBytes: number): Promise<Uint8Array> {
  const info = await stat(path);
  if (!info.isFile() || info.size > maxBytes) {
    throw Object.assign(new Error(`${path}: 일반 파일이 아니거나 너무 큼`), { code: 'too-large' });
  }
  return new Uint8Array(await readFile(path));
}

/** 개인키 파일 상한. RSA 16384 PEM도 이보다 훨씬 작다. */
export const MAX_KEY_FILE_BYTES = 256 * 1024;
