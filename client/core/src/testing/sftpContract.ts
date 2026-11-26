import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SftpSession } from '../sftp/SftpSession';

export interface SftpContractEnv {
  sftp: SftpSession;
  /** 이 스위트가 마음대로 쓸 수 있는 빈 원격 폴더(홈 기준 상대 경로 가능) */
  workDir: string;
  cleanup?: () => Promise<void> | void;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** SftpSession 계약(F4.1, F4.2, AC7). FakeSftp(단위)와 ssh2 어댑터(통합)에 같은 스위트를 돌린다. */
export function describeSftpContract(name: string, createEnv: () => Promise<SftpContractEnv>) {
  describe(`SftpSession 계약: ${name}`, () => {
    let env: SftpContractEnv;
    let dir: string;

    beforeAll(async () => {
      env = await createEnv();
      dir = await env.sftp.realpath(env.workDir);
    });

    afterAll(async () => {
      env.sftp.close();
      await env.cleanup?.();
    });

    it('AC7 한글 이름 파일을 쓰고 읽으면 이름·내용이 같다', async () => {
      await env.sftp.writeFile(`${dir}/보고서_최종.txt`, enc('내용'));
      const names = (await env.sftp.list(dir)).map((e) => e.name);
      expect(names).toContain('보고서_최종.txt');
      expect(dec(await env.sftp.readFile(`${dir}/보고서_최종.txt`))).toBe('내용');
    });

    it('폴더 만들기·이름 바꾸기·지우기', async () => {
      await env.sftp.mkdir(`${dir}/new-dir`);
      expect((await env.sftp.stat(`${dir}/new-dir`))?.type).toBe('dir');
      await env.sftp.rename(`${dir}/new-dir`, `${dir}/renamed`);
      expect(await env.sftp.stat(`${dir}/new-dir`)).toBeNull();
      await env.sftp.removeDir(`${dir}/renamed`);
      expect(await env.sftp.stat(`${dir}/renamed`)).toBeNull();
    });

    it('없는 파일은 missing, 이미 있는 폴더 만들기는 실패한다', async () => {
      await expect(env.sftp.readFile(`${dir}/nope`)).rejects.toMatchObject({ code: 'missing' });
      await env.sftp.mkdir(`${dir}/dup`);
      await expect(env.sftp.mkdir(`${dir}/dup`)).rejects.toMatchObject({
        code: expect.stringMatching(/exists|failure/),
      });
      await env.sftp.removeDir(`${dir}/dup`);
    });

    it('chmod는 권한 비트를 바꾼다', async () => {
      await env.sftp.writeFile(`${dir}/mode.txt`, enc('x'));
      await env.sftp.chmod(`${dir}/mode.txt`, 0o600);
      expect((await env.sftp.stat(`${dir}/mode.txt`))?.mode).toBe(0o600);
      await env.sftp.removeFile(`${dir}/mode.txt`);
    });

    it('TR5 덧붙이기: 없으면 주어진 권한으로 만들고, 있으면 권한을 두고 끝에 붙인다', async () => {
      await env.sftp.appendFile(`${dir}/ak`, enc('a\n'), 0o600);
      expect((await env.sftp.stat(`${dir}/ak`))?.mode).toBe(0o600);
      await env.sftp.chmod(`${dir}/ak`, 0o644);
      await env.sftp.appendFile(`${dir}/ak`, enc('b\n'), 0o600);
      expect(dec(await env.sftp.readFile(`${dir}/ak`))).toBe('a\nb\n');
      expect((await env.sftp.stat(`${dir}/ak`))?.mode).toBe(0o644);
      await env.sftp.removeFile(`${dir}/ak`);
    });

    it('원자적 쓰기는 기존 파일을 통째로 바꾸고 임시 파일을 남기지 않는다', async () => {
      await env.sftp.writeFile(`${dir}/rc`, enc('old content that is longer'));
      await env.sftp.writeFileAtomic(`${dir}/rc`, enc('new'));
      expect(dec(await env.sftp.readFile(`${dir}/rc`))).toBe('new');
      expect(
        (await env.sftp.list(dir)).map((e) => e.name).filter((n) => n.startsWith('rc')),
      ).toEqual(['rc']);
      await env.sftp.removeFile(`${dir}/rc`);
    });

    it('조각 쓰기·읽기, abort하면 부분 파일이 남지 않는다', async () => {
      const sink = await env.sftp.openWrite(`${dir}/stream.bin`);
      await sink.write(enc('abc'));
      await sink.write(enc('def'));
      await sink.finish();
      const source = await env.sftp.openRead(`${dir}/stream.bin`);
      expect(source.size).toBe(6);
      const first = await source.read(4);
      const second = await source.read(4);
      expect(dec(first!) + dec(second!)).toBe('abcdef');
      expect(await source.read(4)).toBeNull();
      await source.close();

      const partial = await env.sftp.openWrite(`${dir}/partial.bin`);
      await partial.write(enc('half'));
      await partial.abort();
      expect(await env.sftp.stat(`${dir}/partial.bin`)).toBeNull();
    });

    it('TR2 keep은 부분 파일을 남기고, offset부터 이어 쓰고 읽으며, replace는 대상을 바꿔 넣는다', async () => {
      const first = await env.sftp.openWrite(`${dir}/resume.part`);
      await first.write(enc('0123'));
      await first.keep();
      expect((await env.sftp.stat(`${dir}/resume.part`))?.size).toBe(4);

      const rest = await env.sftp.openWrite(`${dir}/resume.part`, 4);
      await rest.write(enc('4567'));
      await rest.finish();
      const source = await env.sftp.openRead(`${dir}/resume.part`, 2);
      expect(source.size).toBe(8);
      expect(dec((await source.read(16))!)).toBe('234567');
      await source.close();

      // 새로 쓰기는 배타 생성: 이미 있는 이름(미리 심은 링크 포함)에 쓰지 않는다(보안 리뷰 M1)
      await expect(env.sftp.openWrite(`${dir}/resume.part`)).rejects.toMatchObject({
        code: 'exists',
      });

      await env.sftp.writeFile(`${dir}/target.txt`, enc('old'));
      await env.sftp.replace(`${dir}/resume.part`, `${dir}/target.txt`);
      expect(dec(await env.sftp.readFile(`${dir}/target.txt`))).toBe('01234567');
      expect(await env.sftp.stat(`${dir}/resume.part`)).toBeNull();
    });
  });
}
