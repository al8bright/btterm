import type { AppSettings, RendererToMainRequest } from '@btterm/core';
import type { SettingsRepository } from './store/SettingsRepository';

const TYPES = [
  'settings.get',
  'settings.update',
  'clipboard.readText',
  'clipboard.writeText',
  'link.open',
] as const;
type AppRequest = Extract<RendererToMainRequest, { type: (typeof TYPES)[number] }>;

interface AppRequestsDeps {
  settings: SettingsRepository;
  clipboard: {
    readText(): string | Promise<string>;
    writeText(text: string): void | Promise<void>;
  };
  openExternal(url: string): Promise<boolean>;
  /** 설정이 바뀐 뒤(화면 모드에 맞춰 창 크롬을 다시 칠한다) */
  onSettingsChanged?(settings: AppSettings): void;
}

/** 세션과 무관한 renderer 요청: 설정(F6.7), 클립보드(SEC-7), 외부 링크(SEC-6). */
export class AppRequests {
  constructor(private readonly deps: AppRequestsDeps) {}

  handles(request: RendererToMainRequest): request is AppRequest {
    return (TYPES as readonly string[]).includes(request.type);
  }

  async handle(request: AppRequest): Promise<unknown> {
    switch (request.type) {
      case 'settings.get':
        return this.deps.settings.current;
      case 'settings.update': {
        const settings = await this.deps.settings.update(request.patch);
        this.deps.onSettingsChanged?.(settings);
        return settings;
      }
      case 'clipboard.readText':
        return { text: await this.deps.clipboard.readText() };
      case 'clipboard.writeText':
        await this.deps.clipboard.writeText(request.text);
        return { ok: true };
      case 'link.open':
        return { ok: await this.deps.openExternal(request.url) };
    }
  }
}
