import { randomUUID } from 'node:crypto';
import type { WebContents } from 'electron';
import {
  MainToRendererEventSchema,
  type MainToRendererEvent,
  type Prompt,
  type PromptResponse,
} from '@btterm/core';
import { IPC } from '../shared/api';

interface Pending {
  owner: WebContents;
  /** 세션에 딸린 확인창이면 그 세션 */
  sessionId: string | undefined;
  resolve(response: PromptResponse): void;
  /** 창 종료 리스너를 뗀다(확인창이 쌓여 리스너가 늘지 않게) */
  detach(): void;
}

/**
 * 사용자에게 묻고(비밀번호, 호스트 키) 응답을 기다린다. 창이 닫히면 cancel로 끝난다.
 * 응답은 프롬프트를 받은 창에서 온 것만 받는다(보안 리뷰 #6).
 * 세션에 딸린 확인창은 그 세션이 끝나면 취소하고 화면에서도 내린다(DF1).
 */
export class PromptBroker {
  readonly #pending = new Map<string, Pending>();

  request(sender: WebContents, prompt: Prompt, sessionId?: string): Promise<PromptResponse> {
    const promptId = randomUUID();
    return new Promise((resolve) => {
      const onDestroyed = () => this.#settle(promptId, { kind: 'cancel' });
      sender.once('destroyed', onDestroyed);
      const detach = () => sender.removeListener('destroyed', onDestroyed);
      this.#pending.set(promptId, { owner: sender, sessionId, resolve, detach });
      this.#send(sender, {
        type: 'prompt.request',
        promptId,
        ...(sessionId ? { sessionId } : {}),
        prompt,
      });
    });
  }

  respond(promptId: string, response: PromptResponse, sender: WebContents): void {
    if (this.#pending.get(promptId)?.owner !== sender) return;
    this.#settle(promptId, response);
  }

  /** 세션이 끝났다(탭 닫기 등). 그 세션의 확인창을 취소하고 화면에서 내린다. */
  cancelSession(sessionId: string): void {
    for (const [promptId, pending] of [...this.#pending]) {
      if (pending.sessionId === sessionId) this.#cancel(promptId, pending);
    }
  }

  /** session host가 끝나는 등 더 기다릴 이유가 없을 때 */
  cancelAll(): void {
    for (const [promptId, pending] of [...this.#pending]) this.#cancel(promptId, pending);
  }

  #cancel(promptId: string, pending: Pending): void {
    this.#settle(promptId, { kind: 'cancel' });
    if (!pending.owner.isDestroyed()) {
      this.#send(pending.owner, { type: 'prompt.cancelled', promptId });
    }
  }

  #send(sender: WebContents, event: MainToRendererEvent): void {
    sender.send(IPC.event, MainToRendererEventSchema.parse(event));
  }

  #settle(promptId: string, response: PromptResponse): void {
    const pending = this.#pending.get(promptId);
    if (!pending) return;
    this.#pending.delete(promptId);
    pending.detach();
    pending.resolve(response);
  }
}
