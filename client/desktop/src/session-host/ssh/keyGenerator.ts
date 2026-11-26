import ssh2 from 'ssh2';

export interface KeyGenRequest {
  keyType: 'ed25519' | 'rsa';
  passphrase?: string | undefined;
  comment: string;
}

const RSA_BITS = 4096;
// passphrase가 있을 때 OpenSSH(ssh-keygen) 기본값과 같은 암호화·bcrypt 라운드
const CIPHER = 'aes256-ctr';
const ROUNDS = 16;

/** 키 쌍 생성(F7.7, 결정 TR4). ssh2를 쓰므로 session host에서만 호출한다. 결과는 OpenSSH 형식 텍스트 */
export function generateKey(
  request: KeyGenRequest,
): Promise<{ privateKey: string; publicKey: string }> {
  const encryption =
    request.passphrase !== undefined && request.passphrase !== ''
      ? { passphrase: request.passphrase, cipher: CIPHER, rounds: ROUNDS }
      : {};
  return new Promise((resolve, reject) => {
    const done = (error: Error | null, keys: ssh2.utils.KeyPairReturn) => {
      if (error) reject(error);
      else resolve({ privateKey: keys.private, publicKey: keys.public });
    };
    if (request.keyType === 'rsa') {
      ssh2.utils.generateKeyPair(
        'rsa',
        { bits: RSA_BITS, comment: request.comment, ...encryption },
        done,
      );
    } else {
      ssh2.utils.generateKeyPair('ed25519', { comment: request.comment, ...encryption }, done);
    }
  });
}
