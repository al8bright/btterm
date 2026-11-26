import { useMemo, useState, type KeyboardEvent } from 'react';
import { shortcutOf, type AppAction, type KeymapPlatform, type UiTheme } from '@btterm/core';
import { useAppState, useStore } from '../app/context';
import { t, type MessageKey } from '../i18n';
import { Modal } from './Modal';

/** 팔레트에 보이는 앱 동작(DESIGN §8.1 키맵). 스크롤·복사처럼 터미널 안에서만 뜻이 있는 동작은 뺀다 */
const ACTIONS: readonly AppAction[] = [
  'quickConnect',
  'newTab',
  'closeTab',
  'nextTab',
  'prevTab',
  'splitSameServer',
  'toggleSidebar',
  'focusSftp',
  'toggleToolPanel',
  'historySearch',
  'findInTerminal',
  'reconnect',
  'clearScrollback',
];

const THEMES: readonly UiTheme[] = ['light', 'dark', 'system'];

interface Item {
  id: string;
  kind: 'action' | 'server' | 'tab';
  label: string;
  detail?: string | undefined;
  run(): void;
}

interface Props {
  platform: KeymapPlatform;
  onAction(action: AppAction): void;
  onClose(): void;
}

/**
 * 명령 팔레트(F5.1b, DESIGN §5.6b): 앱 동작·저장된 서버·열린 탭을 한 목록에서 찾는다.
 * `>` 동작만, `#` 열린 탭만. 실행은 팔레트를 닫고 포커스가 돌아온 뒤에 한다.
 */
export function CommandPalette({ platform, onAction, onClose }: Props) {
  const store = useStore();
  const profiles = useAppState((s) => s.profiles);
  const tabs = useAppState((s) => s.tabs);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const all = useMemo(() => {
    const actions: Item[] = [
      ...ACTIONS.map((action) => ({
        id: `action:${action}`,
        kind: 'action' as const,
        label: t(`action.${action}` as MessageKey),
        detail: shortcutOf(action, platform),
        run: () => onAction(action),
      })),
      {
        id: 'action:newServer',
        kind: 'action',
        label: t('palette.newServer'),
        run: () => store.openDialog({ kind: 'host', profileId: null }),
      },
      {
        id: 'action:newGroup',
        kind: 'action',
        label: t('palette.newGroup'),
        run: () => store.openDialog({ kind: 'group', groupId: null }),
      },
      {
        id: 'action:keys',
        kind: 'action',
        label: t('palette.keys'),
        run: () => store.openDialog({ kind: 'keys' }),
      },
      {
        id: 'action:knownHosts',
        kind: 'action',
        label: t('knownHosts.title'),
        run: () => store.openDialog({ kind: 'knownHosts' }),
      },
      ...THEMES.map((theme): Item => ({
        id: `action:theme-${theme}`,
        kind: 'action',
        label: t('palette.theme', { mode: t(`design.uiTheme.${theme}`) }),
        run: () => void store.setUiTheme(theme),
      })),
    ];
    const servers: Item[] = (profiles?.profiles ?? []).map((profile) => ({
      id: `server:${profile.id}`,
      kind: 'server',
      label: profile.name,
      detail: profile.host,
      run: () => void store.openProfile(profile.id),
    }));
    const open: Item[] = tabs.map((tab) => ({
      id: `tab:${tab.sessionId}`,
      kind: 'tab',
      label: tab.customTitle ?? tab.title,
      run: () => store.activate(tab.sessionId),
    }));
    return { actions, servers, tabs: open };
  }, [store, profiles, tabs, platform, onAction]);

  const items = filterItems(all, query);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    // 팔레트가 닫히며 포커스가 돌아온 뒤 실행한다(빠른 연결 등이 포커스를 가져가게)
    setTimeout(item.run, 0);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && items.length > 0) {
      event.preventDefault();
      setActive((current + step + items.length) % items.length);
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(items[current]);
    }
  };

  return (
    <Modal onCancel={onClose}>
      <div className="dialog palette" role="dialog" aria-label={t('palette.label')}>
        <input
          className="palette-input"
          role="combobox"
          aria-label={t('palette.label')}
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={items[current] ? `palette-${items[current].id}` : undefined}
          placeholder={t('palette.placeholder')}
          autoFocus
          spellCheck={false}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
        />
        <ul
          id="palette-list"
          className="palette-list"
          role="listbox"
          aria-label={t('palette.label')}
        >
          {items.map((item, index) => (
            <li
              key={item.id}
              id={`palette-${item.id}`}
              role="option"
              className="palette-option"
              data-kind={item.kind}
              aria-selected={index === current}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => choose(item)}
            >
              <span className="palette-label">{item.label}</span>
              {item.detail && <span className="palette-detail">{item.detail}</span>}
            </li>
          ))}
          {items.length === 0 && <li className="palette-empty">{t('palette.empty')}</li>}
        </ul>
      </div>
    </Modal>
  );
}

/** 접두사로 종류를 좁히고, 부분 문자열(2) > 순서대로 포함(1) 점수 순. 비우면 동작 목록 */
function filterItems(all: { actions: Item[]; servers: Item[]; tabs: Item[] }, raw: string): Item[] {
  let pool: Item[];
  let text = raw.trim();
  if (text.startsWith('>')) {
    pool = all.actions;
    text = text.slice(1).trim();
  } else if (text.startsWith('#')) {
    pool = all.tabs;
    text = text.slice(1).trim();
  } else if (!text) {
    return all.actions;
  } else {
    pool = [...all.actions, ...all.servers, ...all.tabs];
  }
  if (!text) return pool;
  const query = text.toLowerCase();
  return pool
    .map((item, order) => ({ item, order, score: score(item, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .map(({ item }) => item);
}

function score(item: Item, query: string): number {
  const fields = [item.label, item.detail ?? ''].map((f) => f.toLowerCase());
  if (fields.some((f) => f.includes(query))) return 2;
  if (fields.some((f) => isSubsequence(query, f))) return 1;
  return 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let next = 0;
  for (const ch of haystack) {
    if (ch === needle[next]) next++;
    if (next === needle.length) return true;
  }
  return false;
}
