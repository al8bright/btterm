import { describe, expect, it } from 'vitest';
import { AckFlowController } from './AckFlowController';

const KB = 1024;

function setup() {
  const calls: string[] = [];
  const flow = new AckFlowController({
    highWaterMark: 100 * KB,
    lowWaterMark: 10 * KB,
    pause: () => calls.push('pause'),
    resume: () => calls.push('resume'),
  });
  return { flow, calls };
}

describe('AckFlowController', () => {
  it('HIGH 미만이면 멈추지 않는다', () => {
    const { flow, calls } = setup();
    flow.onSent(99 * KB);
    expect(calls).toEqual([]);
  });

  it('AC17 미확인 바이트가 HIGH를 넘으면 한 번만 pause한다', () => {
    const { flow, calls } = setup();
    flow.onSent(60 * KB);
    flow.onSent(60 * KB);
    flow.onSent(10 * KB);
    expect(calls).toEqual(['pause']);
  });

  it('AC17 ACK로 미확인 바이트가 LOW 아래로 내려가면 한 번만 resume한다', () => {
    const { flow, calls } = setup();
    flow.onSent(120 * KB);
    flow.onAck(115 * KB);
    flow.onAck(1 * KB);
    expect(calls).toEqual(['pause', 'resume']);
  });

  it('ACK 누계가 보낸 양보다 많으면 예외(단위 불일치 버그 조기 발견)', () => {
    const { flow } = setup();
    flow.onSent(10);
    expect(() => flow.onAck(11)).toThrow(/ACK/);
  });

  it('0바이트는 상태를 바꾸지 않는다', () => {
    const { flow, calls } = setup();
    flow.onSent(0);
    flow.onAck(0);
    expect([flow.pending, calls]).toEqual([0, []]);
  });

  it('LOW가 HIGH 이상이면 생성 시 예외', () => {
    expect(
      () =>
        new AckFlowController({
          highWaterMark: 10,
          lowWaterMark: 10,
          pause: () => undefined,
          resume: () => undefined,
        }),
    ).toThrow();
  });
});
