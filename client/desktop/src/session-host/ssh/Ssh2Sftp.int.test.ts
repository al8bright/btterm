import { randomUUID } from 'node:crypto';
import { RemoteFiles, type SshConnection } from '@btterm/core';
import { describeSftpContract } from '@btterm/core/testing';
import { Ssh2Transport } from './Ssh2Transport';

// test/sshd/compose.yml 의 target 서비스. 스위트마다 홈 아래 빈 폴더를 만들어 쓰고 지운다.
const env = { host: '127.0.0.1', port: 2222, username: 'btterm', keepaliveSec: 0 };

describeSftpContract('ssh2 + Docker sshd', async () => {
  const conn: SshConnection = await new Ssh2Transport().connect(
    env,
    [{ kind: 'password', password: 'btterm-pw' }],
    { verifyHostKey: async () => true },
  );
  const sftp = await conn.openSftp();
  const workDir = `btterm-contract-${randomUUID()}`;
  await sftp.mkdir(workDir);
  return {
    sftp,
    workDir,
    cleanup: async () => {
      const files = new RemoteFiles(() => conn.openSftp());
      await files.remove(workDir);
      files.close();
      conn.end();
    },
  };
});
