import { describe, expect, it } from 'vitest';
import type { WebContents } from 'electron';
import { PromptBroker } from './PromptBroker';

function fakeSender() {
  const sent: Array<{ type: string; promptId: string; sessionId?: string }> = [];
  const sender = {
    once: () => undefined,
    removeListener: () => undefined,
    isDestroyed: () => false,
    send: (_channel: string, event: { type: string; promptId: string }) => sent.push(event),
  } as unknown as WebContents;
  return { sender, sent };
}

describe('PromptBroker(보안 리뷰 #6)', () => {
  it('프롬프트를 받은 창의 응답만 받는다', async () => {
    const broker = new PromptBroker();
    const owner = fakeSender();
    const other = fakeSender();
    const answer = broker.request(owner.sender, { kind: 'passphrase', keyLabel: 'k' });
    const promptId = owner.sent[0]!.promptId;

    broker.respond(promptId, { kind: 'secret', secret: 'stolen?' }, other.sender);
    broker.respond(promptId, { kind: 'secret', secret: 'pp' }, owner.sender);
    expect(await answer).toEqual({ kind: 'secret', secret: 'pp' });
  });

  it('DF1 세션이 끝나면 그 세션의 확인창만 취소하고 화면에 알린다', async () => {
    const broker = new PromptBroker();
    const owner = fakeSender();
    const hostKey = broker.request(owner.sender, { kind: 'passphrase', keyLabel: 'a' }, 's1');
    const other = broker.request(owner.sender, { kind: 'passphrase', keyLabel: 'b' }, 's2');
    expect(owner.sent.map((e) => e.sessionId)).toEqual(['s1', 's2']);
    const [first, second] = owner.sent;

    broker.cancelSession('s1');
    expect(await hostKey).toEqual({ kind: 'cancel' });
    expect(owner.sent.at(-1)).toEqual({ type: 'prompt.cancelled', promptId: first!.promptId });

    broker.respond(second!.promptId, { kind: 'secret', secret: 'pp' }, owner.sender);
    expect(await other).toEqual({ kind: 'secret', secret: 'pp' });
  });

  it('창 없이(내부) 취소할 수 있다', async () => {
    const broker = new PromptBroker();
    const owner = fakeSender();
    const answer = broker.request(owner.sender, { kind: 'passphrase', keyLabel: 'k' });
    broker.cancelAll();
    expect(await answer).toEqual({ kind: 'cancel' });
  });
});
