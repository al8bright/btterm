import { useState } from 'react';
import { useAppState, useStore } from '../app/context';
import { messageFor, t } from '../i18n';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** 키 목록(F7.5): 종류·지문·공개키 복사·사용처, 서버 등록(F7.8)·내보내기(F7.7), 삭제. */
export function KeysDialog() {
  const store = useStore();
  const view = useAppState((s) => s.profiles);
  const tabs = useAppState((s) => s.tabs);
  const [message, setMessage] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  if (!view) return null;
  const readyTabs = tabs.filter((tab) => tab.state === 'ready');
  const targetTab = readyTabs.find((tab) => tab.sessionId === target) ?? readyTabs[0];
  const targetName = targetTab ? (targetTab.customTitle ?? targetTab.title) : '';
  const close = () => store.closeDialog();

  const usedBy = (keyId: string) => {
    const credentialIds = new Set(
      view.credentials.filter((c) => c.keyId === keyId).map((c) => c.id),
    );
    return view.identities.filter(
      (i) => i.credentialId !== null && credentialIds.has(i.credentialId),
    );
  };

  const install = async (keyId: string) => {
    if (!targetTab) return;
    const result = await store.installKey(keyId, targetTab.sessionId);
    if (!result.ok) setMessage(t(messageFor('keyError', result.error, 'keyError.install-failed')));
    else
      setMessage(
        t(result.added ? 'keys.installed' : 'keys.alreadyInstalled', { name: targetName }),
      );
  };

  const exportKey = async (keyId: string) => {
    const result = await store.exportKey(keyId);
    if (!result.ok) setMessage(t(messageFor('keyError', result.error, 'keyError.unknown')));
    else if (result.exported) setMessage(t('keys.exported'));
  };

  const remove = async (keyId: string, label: string) => {
    if (!(await store.requestConfirm({ kind: 'delete', name: label }))) return;
    const result = await store.deleteKey(keyId);
    setMessage(result.ok ? null : t(messageFor('keyError', result.error, 'keyError.unknown')));
  };

  return (
    <Modal onCancel={close}>
      <div className="dialog wide" role="dialog" aria-labelledby="keys-title">
        <h2 id="keys-title">{t('keys.title')}</h2>
        {view.keys.length === 0 && <p>{t('keys.empty')}</p>}
        <ul className="key-list">
          {view.keys.map((key) => {
            const users = usedBy(key.id);
            return (
              <li key={key.id} className="key-item">
                <div className="key-head">
                  <Icon name="key" size={16} />
                  <strong>{key.label}</strong>
                  <span className="chip">{key.keyType}</span>
                  {key.encrypted && <span className="chip">{t('keys.encrypted')}</span>}
                  <span className="chip">
                    {t(key.source.kind === 'path' ? 'keys.source.path' : 'keys.source.vault')}
                  </span>
                </div>
                {key.source.kind === 'path' && <code className="fp">{key.source.path}</code>}
                {key.fingerprintSha256 && <code className="fp">{key.fingerprintSha256}</code>}
                <p className="note">
                  {users.length > 0
                    ? t('keys.usedBy', { names: users.map((u) => u.label).join(', ') })
                    : t('keys.unused')}
                </p>
                <div className="key-actions">
                  {key.publicKey && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() =>
                        void store.copyText(key.publicKey).then(() => setMessage(t('keys.copied')))
                      }
                    >
                      {t('keys.copy')}
                    </button>
                  )}
                  {key.publicKey && (
                    <button
                      type="button"
                      className="btn small"
                      disabled={!targetTab}
                      title={targetTab ? undefined : t('keys.installNeedsSession')}
                      onClick={() => void install(key.id)}
                    >
                      {t('keys.install')}
                    </button>
                  )}
                  {key.source.kind === 'vault' && (
                    <button
                      type="button"
                      className="btn small"
                      onClick={() => void exportKey(key.id)}
                    >
                      {t('keys.export')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => void remove(key.id, key.label)}
                  >
                    {t('keys.delete')}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
        {view.keys.length > 0 && readyTabs.length > 0 && (
          <label>
            {t('keys.installTarget')}
            <select
              name="install-target"
              value={targetTab?.sessionId ?? ''}
              onChange={(e) => setTarget(e.target.value)}
            >
              {readyTabs.map((tab) => (
                <option key={tab.sessionId} value={tab.sessionId}>
                  {tab.customTitle ?? tab.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {message && (
          <p className="note" role="status">
            {message}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={close}>
            {t('toast.dismiss')}
          </button>
          <button
            type="button"
            className="btn"
            onClick={() => store.openDialog({ kind: 'knownHosts' })}
          >
            {t('knownHosts.title')}
          </button>
          <button
            type="button"
            className="btn primary"
            onClick={() => store.openDialog({ kind: 'keyAdd' })}
          >
            {t('keys.add')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
