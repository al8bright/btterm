// 터미널 폴더 따라가기용 셸 통합(F4.5, D10). 원격에 shell.sh를 두고 rc에는 마커로 감싼 한 줄만 넣는다.

export const SHELL_SCRIPT_PATH = '.config/btterm/shell.sh';
export const RC_FILES = ['.bashrc', '.zshrc'] as const;
export const LOGIN_FILES = ['.bash_profile', '.bash_login', '.profile'] as const;

const BEGIN = '# >>> btterm >>>';
const END = '# <<< btterm <<<';

export const RC_BLOCK = [
  BEGIN,
  `[ -f "$HOME/${SHELL_SCRIPT_PATH}" ] && . "$HOME/${SHELL_SCRIPT_PATH}"`,
  END,
].join('\n');

/**
 * 프롬프트마다 현재 폴더를 OSC 7(file://host/path)로 알린다. 경로는 바이트 단위로 퍼센트 인코딩한다.
 * bash는 기존 PROMPT_COMMAND 앞에 붙이고, zsh는 precmd 훅을 더한다. 여러 번 읽혀도 한 번만 등록한다.
 */
export const SHELL_SCRIPT = String.raw`# btterm 셸 통합: 현재 폴더를 OSC 7로 알린다. 제거는 btterm의 "셸 통합 제거".
__btterm_urlencode() {
  local LC_ALL=C s="$1" out="" c i n hex
  for ((i = 0; i < ${'$'}{#s}; i++)); do
    c="${'$'}{s:i:1}"
    case "$c" in
      [a-zA-Z0-9/._~-]) out+="$c" ;;
      # C 로케일에서 0x80 이상 바이트는 값이 부호 확장돼 나오므로 하위 8비트만 쓴다.
      *) printf -v n '%d' "'$c"; printf -v hex '%%%02X' "$(( n & 255 ))"; out+="$hex" ;;
    esac
  done
  printf '%s' "$out"
}
__btterm_osc7() {
  printf '\033]7;file://%s%s\033\\' "${'$'}{HOSTNAME:-$(hostname)}" "$(__btterm_urlencode "$PWD")"
}
if [ -n "${'$'}{BASH_VERSION:-}" ]; then
  case ";${'$'}{PROMPT_COMMAND:-};" in
    *";__btterm_osc7;"*) ;;
    *) PROMPT_COMMAND="__btterm_osc7${'$'}{PROMPT_COMMAND:+;$PROMPT_COMMAND}" ;;
  esac
elif [ -n "${'$'}{ZSH_VERSION:-}" ]; then
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd __btterm_osc7
fi
`;

export interface RcEdit {
  text: string;
  changed: boolean;
}

export function hasRcBlock(text: string): boolean {
  return text.includes(BEGIN) && text.includes(END);
}

/** 블록이 없으면 끝에 덧붙인다(멱등). */
export function addRcBlock(text: string): RcEdit {
  if (hasRcBlock(text)) return { text, changed: false };
  if (text === '') return { text: `${RC_BLOCK}\n`, changed: true };
  const base = text.endsWith('\n') ? text : `${text}\n`;
  return { text: `${base}\n${RC_BLOCK}\n`, changed: true };
}

/** addRcBlock이 넣은 블록(앞 빈 줄 포함)을 뺀다. */
export function removeRcBlock(text: string): RcEdit {
  const start = text.indexOf(BEGIN);
  const end = text.indexOf(END);
  if (start < 0 || end < start) return { text, changed: false };
  let before = text.slice(0, start);
  let after = text.slice(end + END.length);
  if (after.startsWith('\n')) after = after.slice(1);
  if (before.endsWith('\n\n')) before = before.slice(0, -1);
  return { text: before + after, changed: true };
}

/** 로그인 셸 파일이 .bashrc를 읽는지(읽지 않으면 SSH 로그인 셸에서 통합이 동작하지 않을 수 있다). */
export function sourcesBashrc(text: string): boolean {
  return /(^|[\s;&|])(\.|source)\s+["']?(~|\$HOME|\$\{HOME\})\/\.bashrc/m.test(text);
}
