import { useState, type KeyboardEvent } from 'react';
import { useRegistry, useStore } from '../app/context';
import { t } from '../i18n';
import { Icon } from './Icon';

/** 터미널 찾기(Ctrl+Shift+F). Enter 다음, Shift+Enter 이전, Esc 닫기. */
export function FindBar({ sessionId }: { sessionId: string }) {
  const store = useStore();
  const registry = useRegistry();
  const [query, setQuery] = useState('');
  const [missing, setMissing] = useState(false);

  const find = (direction: 'next' | 'previous') => {
    if (!query) return;
    setMissing(!registry.find(sessionId, query, direction));
  };
  const close = () => {
    registry.clearFind(sessionId);
    store.setFindOpen(false);
    registry.focus(sessionId);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      find(event.shiftKey ? 'previous' : 'next');
    } else if (event.key === 'Escape') {
      close();
    }
  };

  return (
    <div className="findbar" role="search" aria-label={t('find.label')}>
      <input
        autoFocus
        name="find"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setMissing(false);
        }}
        onKeyDown={onKeyDown}
        placeholder={t('find.placeholder')}
        aria-label={t('find.label')}
        aria-invalid={missing}
      />
      {missing && (
        <span className="find-status" role="status">
          {t('find.none')}
        </span>
      )}
      <button
        type="button"
        className="iconbtn"
        aria-label={t('find.previous')}
        onClick={() => find('previous')}
      >
        <Icon name="up" size={16} />
      </button>
      <button
        type="button"
        className="iconbtn"
        aria-label={t('find.next')}
        onClick={() => find('next')}
      >
        <Icon name="down" size={16} />
      </button>
      <button type="button" className="iconbtn" aria-label={t('find.close')} onClick={close}>
        <Icon name="close" size={16} />
      </button>
    </div>
  );
}
