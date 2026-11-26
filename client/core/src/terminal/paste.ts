// 터미널로 들어가는 텍스트 정리(F3.9, SEC-5). 순수 함수.

// ESC로 시작하는 CSI·OSC 등 시퀀스의 시작 바이트와 그 밖의 C0/C1 제어문자(탭·개행 제외).
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

export interface PreparedPaste {
  text: string;
  multiline: boolean;
  lineCount: number;
}

/** 붙여넣기 텍스트에서 제어문자를 지우고 개행을 LF로 맞춘다. 여러 줄이면 경고 대상(F3.9). */
export function preparePaste(raw: string): PreparedPaste {
  const text = raw.replace(/\r\n?/g, '\n').replace(CONTROL, '');
  const lines = text.replace(/\n$/, '').split('\n');
  return { text, multiline: lines.length > 1, lineCount: lines.length };
}

/** 기록·스니펫을 프롬프트에 "입력만" 할 때 쓰는 한 줄 텍스트(F3.17a). */
export function toPromptInput(raw: string): string {
  return raw
    .replace(/[\r\n]+/g, ' ')
    .replace(CONTROL, '')
    .trim();
}

const OPENABLE = new Set(['http:', 'https:']);

/** 터미널 링크로 열어도 되는 URL인지(SEC-6). */
export function isOpenableUrl(value: string): boolean {
  try {
    return OPENABLE.has(new URL(value).protocol);
  } catch {
    return false;
  }
}
