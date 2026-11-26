export interface AckFlowOptions {
  highWaterMark: number;
  lowWaterMark: number;
  pause: () => void;
  resume: () => void;
}

/**
 * renderer ACK 기반 흐름 제어(F3.4, PRD §5.2).
 * session host가 보낸 원본 바이트 수와 renderer가 xterm에 쓴 뒤 돌려준 ACK 바이트 수의 차이로
 * 원격 채널을 멈추고 재개한다. 양쪽이 같은 단위(원본 바이트)를 세야 한다.
 */
export class AckFlowController {
  readonly #high: number;
  readonly #low: number;
  readonly #pause: () => void;
  readonly #resume: () => void;
  #sent = 0;
  #acked = 0;
  #paused = false;

  constructor(options: AckFlowOptions) {
    if (options.lowWaterMark >= options.highWaterMark) {
      throw new Error('lowWaterMark는 highWaterMark보다 작아야 합니다');
    }
    this.#high = options.highWaterMark;
    this.#low = options.lowWaterMark;
    this.#pause = options.pause;
    this.#resume = options.resume;
  }

  get pending(): number {
    return this.#sent - this.#acked;
  }

  onSent(bytes: number): void {
    this.#sent += bytes;
    if (!this.#paused && this.pending > this.#high) {
      this.#paused = true;
      this.#pause();
    }
  }

  onAck(bytes: number): void {
    if (this.#acked + bytes > this.#sent) {
      throw new Error(`ACK 누계(${this.#acked + bytes})가 보낸 양(${this.#sent})보다 큽니다`);
    }
    this.#acked += bytes;
    if (this.#paused && this.pending < this.#low) {
      this.#paused = false;
      this.#resume();
    }
  }
}
