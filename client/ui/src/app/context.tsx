import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { shortcutOf, type AppAction, type KeymapPlatform } from '@btterm/core';
import type { AppState, AppStore } from '../store/AppStore';
import type { TerminalRegistry } from '../terminal/TerminalRegistry';

interface AppServices {
  store: AppStore;
  registry: TerminalRegistry;
  platform: KeymapPlatform;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({ value, children }: { value: AppServices; children: ReactNode }) {
  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('ServicesProvider 밖에서 호출했습니다');
  return services;
}

export function useStore(): AppStore {
  return useServices().store;
}

export function useRegistry(): TerminalRegistry {
  return useServices().registry;
}

/** 화면에 보일 단축키 표기(OS별 키맵, DESIGN §8.1). 없으면 빈 문자열 */
export function useShortcut(action: AppAction): string {
  return shortcutOf(action, useServices().platform) ?? '';
}

/** 외부 store 구독(DESIGN §11). selector는 같은 값이면 같은 참조를 돌려줘야 한다. */
export function useAppState<T>(selector: (state: AppState) => T): T {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}
