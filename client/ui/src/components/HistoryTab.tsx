import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { searchHistory } from '@btterm/core';
import { useAppState, useRegistry, useStore } from '../app/context';
import { t } from '../i18n';
import { Icon } from './Icon';

const LIMIT = 200;

/**
 * 명령 기록 탭(F3.17a): 활성 서버의 ~/.bash_history(없으면 zsh)를 퍼지 검색한다.
 * Enter는 프롬프트에 입력만 한다(실행하지 않음). 기록은 메모리에서만 쓴다.
 */
export function HistoryTab() {
  const store = useStore();
  const registry = useRegistry();
  const activeId = useAppState((s) => s.activeId);
  const ready = useAppState(
    (s) => s.tabs.find((x) => x.sessionId === s.activeId)?.state === 'ready',
  );
  const history = useAppState((s) => s.history);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [blocked, setBlocked] = useState(false);

  const loaded = history !== null && history.sessionId === activeId;
  useEffect(() => {
    if (activeId && ready && !loaded) void store.loadHistory();
  }, [store, activeId, ready, loaded]);

  const results = useMemo(
    () => (loaded ? searchHistory(history.entries, query, LIMIT) : []),
    [loaded, history, query],
  );

  const insert = (command: string) => {
    if (!activeId) return;
    setBlocked(!registry.insertText(activeId, command));
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((i) => Math.max(i - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const entry = results[selected];
      if (entry) insert(entry.command);
    }
  };

  if (!activeId) return <p className="note">{t('history.noSession')}</p>;

  return (
    <div className="hist">
      <div className="search">
        <input
          type="search"
          name="history-search"
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t('history.search')}
          aria-label={t('history.search')}
          aria-controls="history-results"
          aria-activedescendant={results[selected] ? `hist-${selected}` : undefined}
        />
        <button
          type="button"
          className="iconbtn"
          aria-label={t('history.reload')}
          title={t('history.reload')}
          onClick={() => void store.loadHistory()}
        >
          <Icon name="refresh" size={16} />
        </button>
      </div>
      <p className="note">{t('history.hint')}</p>
      {blocked && (
        <p className="warn" role="status">
          {t('history.altBuffer')}
        </p>
      )}
      {!loaded && <p className="note">{t('history.loading')}</p>}
      {loaded && history.status !== 'ok' && (
        <p className="note">{t(`history.${history.status}`)}</p>
      )}
      {loaded && history.status === 'ok' && results.length === 0 && (
        <p className="note">{t('history.empty')}</p>
      )}
      <ul
        id="history-results"
        className="hist-list"
        role="listbox"
        aria-label={t('history.search')}
      >
        {results.map((entry, index) => (
          <li
            key={`${index}-${entry.command}`}
            id={`hist-${index}`}
            role="option"
            aria-selected={index === selected}
            className="hitem"
            onClick={() => setSelected(index)}
            onDoubleClick={() => insert(entry.command)}
          >
            <code>{entry.command}</code>
            {entry.timestamp !== null && (
              <span className="meta">{new Date(entry.timestamp).toLocaleString()}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
