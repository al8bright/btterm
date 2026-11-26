/** 청크 경계에서 멀티바이트 문자가 잘려도 복원하는 UTF-8 디코더(AC6). */
export class Utf8StreamDecoder {
  readonly #decoder = new TextDecoder('utf-8');

  decode(chunk: Uint8Array): string {
    return this.#decoder.decode(chunk, { stream: true });
  }

  flush(): string {
    return this.#decoder.decode();
  }
}
