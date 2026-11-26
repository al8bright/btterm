import { useEffect, useState } from 'react';
import type { KnownHostView } from '@btterm/core';
import { useStore } from '../app/context';
import { t } from '../i18n';
import { Modal } from './Modal';

/**
 * 알려진 호스트(F2.4b, 결정 TR6): 저장된 호스트 키의 지문을 보고 btterm 항목을 지운다.
 * 지운 뒤 다시 연결하면 처음 보는 키로 확인받는다. ~/.ssh/known_hosts는 읽기 전용.
 */
export function KnownHostsDialog() {
  const store = useStore();
  const [entries, setEntries] = useState<KnownHostView[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const reload = () => void store.loadKnownHosts().then(setEntries, () => setEntries([]));
  useEffect(reload, [store]);
  const close = () => store.closeDialog();

  // 확인은 main의 시스템 확인창이 한다(보안 리뷰 M-1). 취소했거나 파일이 바뀌었으면 목록만 새로 읽는다
  const remove = async (entry: KnownHostView) => {
    const name = entry.hosts ?? t('knownHosts.hashed');
    setMessage((await store.removeKnownHost(entry)) ? t('knownHosts.removed', { name }) : null);
    reload();
  };

  return (
    <Modal onCancel={close}>
      <div className="dialog wide" role="dialog" aria-labelledby="known-hosts-title">
        <h2 id="known-hosts-title">{t('knownHosts.title')}</h2>
        <p className="note">{t('knownHosts.note')}</p>
        {entries !== null && entries.length === 0 && <p>{t('knownHosts.empty')}</p>}
        <ul className="key-list">
          {(entries ?? []).map((entry) => (
            <li key={`${entry.source}:${entry.line}`} className="key-item">
              <div className="key-head">
                <strong>{entry.hosts ?? t('knownHosts.hashed')}</strong>
                <span className="chip">{entry.keyType}</span>
                <span className="chip">
                  {t(entry.source === 'app' ? 'knownHosts.source.app' : 'knownHosts.source.user')}
                </span>
                {entry.marker && <span className="chip">{entry.marker}</span>}
              </div>
              <code className="fp">{entry.fingerprint}</code>
              {entry.source === 'app' && (
                <div className="key-actions">
                  <button
                    type="button"
                    className="btn small"
                    aria-label={t('knownHosts.remove', {
                      name: entry.hosts ?? t('knownHosts.hashed'),
                    })}
                    onClick={() => void remove(entry)}
                  >
                    {t('knownHosts.removeShort')}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {message && (
          <p className="note" role="status">
            {message}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={close}>
            {t('toast.dismiss')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
