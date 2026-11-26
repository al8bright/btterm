import { lstat, mkdir, open, readdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  joinRemote,
  SftpError,
  type RemoteEntry,
  type SftpSession,
  type SourceKind,
  type TransferEndpoints,
  type TransferJob,
  type TransferSink,
  type TransferSource,
} from '@btterm/core';

const PART_SUFFIX = '.btterm-part';

/** SEC-11: 정규화한 이름이라도 결과 경로가 대상 폴더 바로 아래인지 한 번 더 확인한다. */
export function safeLocalTarget(dir: string, name: string): string {
  const base = resolve(dir);
  const target = resolve(base, name);
  if (dirname(target) !== base)
    throw Object.assign(new Error('대상 폴더 밖'), { code: 'invalid-name' });
  return target;
}

/** 다운로드는 원격 → 로컬 파일, 업로드는 로컬 파일 → 원격. 원격은 전송 전용 SFTP 채널을 쓴다(F4.4). */
export function createTransferEndpoints(
  sftpFor: (sessionId: string) => Promise<SftpSession>,
): TransferEndpoints {
  return {
    /** 맨 위 항목(사용자가 고른 것)은 링크를 따라가고, 폴더 안에서 만난 링크는 건너뛴다(TR1) */
    async kindOf(job: TransferJob): Promise<SourceKind> {
      const top = job.depth === undefined;
      if (job.direction === 'download') {
        const entry = await (await sftpFor(job.sessionId)).stat(job.sourcePath);
        if (!entry) throw new SftpError('missing');
        if (entry.type === 'link') return top ? 'file' : 'skip';
        return remoteKind(entry);
      }
      const info = top ? await stat(job.sourcePath) : await lstat(job.sourcePath);
      return info.isDirectory() ? 'dir' : info.isFile() ? 'file' : 'skip';
    },
    async children(job: TransferJob) {
      if (job.direction === 'download') {
        const entries = await (await sftpFor(job.sessionId)).list(job.sourcePath);
        return entries.map((entry) => ({
          name: entry.name,
          path: joinRemote(job.sourcePath, entry.name),
          kind: remoteKind(entry),
        }));
      }
      const entries = await readdir(job.sourcePath, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        path: join(job.sourcePath, entry.name),
        kind: entry.isDirectory()
          ? ('dir' as const)
          : entry.isFile()
            ? ('file' as const)
            : ('skip' as const),
      }));
    },
    /** 대상 폴더 아래에 만들고(있으면 그대로), 같은 이름 파일이 있으면 exists */
    async makeDir(job: TransferJob, name: string): Promise<string> {
      if (job.direction === 'download') {
        const target = safeLocalTarget(job.targetDir, name);
        await mkdir(target).catch(async (error: NodeJS.ErrnoException) => {
          if (error.code !== 'EEXIST') throw error;
          // 이미 있는 정션·링크를 따라가 대상 폴더 밖에 쓰지 않는다(보안 리뷰 L1, SEC-11)
          const info = await lstat(target);
          if (info.isSymbolicLink() || !info.isDirectory()) {
            throw Object.assign(new Error('링크 또는 파일'), { code: 'invalid-name' });
          }
        });
        return target;
      }
      const sftp = await sftpFor(job.sessionId);
      const target = joinRemote(job.targetDir, name);
      const existing = await sftp.stat(target);
      if (existing?.type === 'dir') return target;
      if (existing) throw new SftpError('exists');
      await sftp.mkdir(target);
      return target;
    },
    async openSource(job: TransferJob, offset = 0): Promise<TransferSource> {
      if (job.direction === 'download')
        return (await sftpFor(job.sessionId)).openRead(job.sourcePath, offset);
      return localSource(job.sourcePath, offset);
    },
    async partSize(job: TransferJob, name: string): Promise<number> {
      if (job.direction === 'download') {
        const info = await lstat(safeLocalTarget(job.targetDir, name) + PART_SUFFIX).catch(
          () => null,
        );
        return info?.isFile() ? info.size : 0;
      }
      const entry = await (await sftpFor(job.sessionId)).stat(remotePart(job, name));
      return entry?.type === 'file' ? entry.size : 0;
    },
    async discardPart(job: TransferJob, name: string): Promise<void> {
      if (job.direction === 'download') {
        await unlink(safeLocalTarget(job.targetDir, name) + PART_SUFFIX).catch(() => undefined);
        return;
      }
      await (await sftpFor(job.sessionId)).removeFile(remotePart(job, name)).catch(() => undefined);
    },
    async targetNames(job: TransferJob): Promise<ReadonlySet<string>> {
      if (job.direction === 'download') {
        return new Set(await readdir(job.targetDir).catch(() => []));
      }
      const entries = await (await sftpFor(job.sessionId)).list(job.targetDir);
      return new Set(entries.map((e) => e.name));
    },
    async openSink(job: TransferJob, name: string, offset = 0): Promise<TransferSink> {
      if (job.direction === 'download') {
        return localSink(safeLocalTarget(job.targetDir, name), offset);
      }
      // 올리는 동안은 .btterm-part에 쓰고 끝나면 바꿔 넣는다: 원격 원본은 마지막까지 그대로(TR2)
      const sftp = await sftpFor(job.sessionId);
      const part = remotePart(job, name);
      // 새로 쓸 때 남아 있는 부분 파일 이름(링크면 링크만)을 지우고 배타 생성으로 연다(보안 리뷰 M1)
      if (offset === 0) await sftp.removeFile(part).catch(() => undefined);
      const sink = await sftp.openWrite(part, offset);
      return {
        write: (chunk) => sink.write(chunk),
        finish: async () => {
          await sink.finish();
          const target = joinRemote(job.targetDir, name);
          // 바꿔 넣으면 새 파일이 되므로 원래 권한(실행 비트 등)을 먼저 입힌다(TR3).
          // setuid·setgid·sticky는 옮기지 않는다(보안 리뷰 L1)
          const existing = await sftp.stat(target);
          if (existing?.type === 'file')
            await sftp.chmod(part, existing.mode & 0o777).catch(() => undefined);
          await sftp.replace(part, target);
        },
        abort: () => sink.abort(),
        keep: () => sink.keep(),
      };
    },
  };
}

function remotePart(job: TransferJob, name: string): string {
  return joinRemote(job.targetDir, name + PART_SUFFIX);
}

function remoteKind(entry: RemoteEntry): SourceKind {
  return entry.type === 'dir' ? 'dir' : entry.type === 'file' ? 'file' : 'skip';
}

async function localSource(path: string, offset = 0): Promise<TransferSource> {
  const handle = await open(path, 'r');
  const { size } = await handle.stat();
  let position = offset;
  return {
    size,
    read: async (max) => {
      const buffer = Buffer.alloc(max);
      const { bytesRead } = await handle.read(buffer, 0, max, position);
      position += bytesRead;
      return bytesRead === 0 ? null : new Uint8Array(buffer.subarray(0, bytesRead));
    },
    close: () => handle.close(),
  };
}

/**
 * 받는 동안은 .btterm-part에 쓰고, 끝나면 제자리로 옮긴다. 취소하면 부분 파일을 지우고(AC11),
 * 실패하면 남겨 다시 시도가 offset부터 잇는다(TR2).
 */
async function localSink(target: string, offset = 0): Promise<TransferSink> {
  const part = target + PART_SUFFIX;
  // 새로 쓰기: 남은 부분 파일(링크면 링크만)을 지우고 배타 생성. 이어 쓰기: 일반 파일만(보안 리뷰 L1)
  if (offset === 0) await unlink(part).catch(() => undefined);
  else if (!(await lstat(part)).isFile())
    throw Object.assign(new Error('링크'), { code: 'invalid-name' });
  const handle = await open(part, offset > 0 ? 'r+' : 'wx');
  if (!(await handle.stat()).isFile()) {
    await handle.close();
    throw Object.assign(new Error('일반 파일 아님'), { code: 'invalid-name' });
  }
  let position = offset;
  let isOpen = true;
  const close = async () => {
    if (!isOpen) return;
    isOpen = false;
    await handle.close();
  };
  return {
    write: async (chunk) => {
      await handle.write(chunk, 0, chunk.length, position);
      position += chunk.length;
    },
    finish: async () => {
      await close();
      await rename(part, target);
    },
    abort: async () => {
      await close().catch(() => undefined);
      await unlink(part).catch(() => undefined);
    },
    keep: close,
  };
}
