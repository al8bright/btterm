// core에서 허용하는 웹 표준 전역(AGENTS.md §3). lib는 ES2022만 쓰므로 필요한 것만 선언한다.

interface TextDecoderOptions {
  fatal?: boolean;
  ignoreBOM?: boolean;
}

interface TextDecodeOptions {
  stream?: boolean;
}

declare class TextDecoder {
  constructor(label?: string, options?: TextDecoderOptions);
  readonly encoding: string;
  decode(input?: Uint8Array, options?: TextDecodeOptions): string;
}

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare function structuredClone<T>(value: T): T;

declare class URL {
  constructor(url: string, base?: string);
  readonly protocol: string;
  readonly host: string;
  readonly hostname: string;
  readonly href: string;
  toString(): string;
}
