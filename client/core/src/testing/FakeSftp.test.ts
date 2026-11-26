import { FakeRemoteFs, FakeSftp } from './FakeSftp';
import { describeSftpContract } from './sftpContract';

describeSftpContract('FakeSftp', async () => {
  const fs = new FakeRemoteFs('/home/alice');
  fs.nodes.set('/home/alice/work', {
    type: 'dir',
    data: new Uint8Array(),
    mode: 0o755,
    mtimeMs: 0,
  });
  return { sftp: new FakeSftp(fs), workDir: 'work' };
});
