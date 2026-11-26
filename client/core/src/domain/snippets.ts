import { z } from 'zod';

/** 스니펫(F3.14 1단계, 결정 DF7). 설정 파일 snippets에 저장한다 */
export const SnippetSchema = z.object({
  id: z.string().min(1).max(64),
  name: z
    .string()
    .max(80)
    .refine((text) => text.trim().length > 0, { message: 'blank' }),
  command: z
    .string()
    .max(4000)
    .refine((text) => text.trim().length > 0, { message: 'blank' }),
});
export type Snippet = z.infer<typeof SnippetSchema>;

export const SNIPPET_LIMIT = 200;
export const SnippetListSchema = z.array(SnippetSchema).max(SNIPPET_LIMIT);

const VAR = /\{\{\s*([\w-]+)\s*\}\}/g;

/** `{{이름}}` 변수를 처음 나온 순서대로 한 번씩 */
export function snippetVars(command: string): string[] {
  return [...new Set([...command.matchAll(VAR)].map((m) => m[1]!))];
}

/** 변수를 값으로 채운다. 값이 없으면 빈 문자열 */
export function fillSnippet(command: string, values: Readonly<Record<string, string>>): string {
  return command.replace(VAR, (_, name: string) => values[name] ?? '');
}

const PRODUCTION_TAG = /^prod(uction)?$/i;
const SUDO = /(^|[\s;&|(])sudo(\s|$)/;

/** production 태그 서버에서 sudo가 들어간 명령은 실행 전 확인한다(F3.14) */
export function needsSudoConfirm(command: string, tags: readonly string[]): boolean {
  return SUDO.test(command) && tags.some((tag) => PRODUCTION_TAG.test(tag.trim()));
}
