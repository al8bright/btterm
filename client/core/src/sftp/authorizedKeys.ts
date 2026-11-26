// 공개키 서버 등록(F7.8, 결정 TR5): ~/.ssh/authorized_keys에 없을 때만 한 줄 덧붙인다.

const KEY_TYPES = new Set([
  'ssh-ed25519',
  'ssh-rsa',
  'ecdsa-sha2-nistp256',
  'ecdsa-sha2-nistp384',
  'ecdsa-sha2-nistp521',
]);
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const MAX_LINE = 16 * 1024;

/** 옵션 없는 "형식 base64 [주석]" 한 줄인지. 옵션(command= 등)은 넣지 않는다 */
export function isPublicKeyLine(line: string): boolean {
  if (line.length > MAX_LINE || /[\r\n\0]/.test(line)) return false;
  const [type, blob] = line.split(' ');
  return type !== undefined && KEY_TYPES.has(type) && blob !== undefined && BASE64.test(blob);
}

/** 줄에서 "형식 본문" 쌍을 찾는다. 앞에 옵션이 붙어 있어도 된다 */
function keyOf(line: string): string | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const tokens = trimmed.split(/\s+/);
  const at = tokens.findIndex((token) => KEY_TYPES.has(token));
  const blob = at >= 0 ? tokens[at + 1] : undefined;
  return blob === undefined ? null : `${tokens[at]} ${blob}`;
}

export function addAuthorizedKey(
  text: string,
  publicKey: string,
): { text: string; changed: boolean } {
  const wanted = keyOf(publicKey);
  if (text.split('\n').some((line) => wanted !== null && keyOf(line) === wanted)) {
    return { text, changed: false };
  }
  const base = text === '' || text.endsWith('\n') ? text : `${text}\n`;
  return { text: `${base}${publicKey}\n`, changed: true };
}
