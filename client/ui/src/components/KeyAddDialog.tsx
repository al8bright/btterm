import { useState, type FormEvent } from 'react';
import type { GeneratedKeyType, PassphrasePolicy } from '@btterm/core';
import { useStore } from '../app/context';
import { messageFor, t } from '../i18n';
import { Modal } from './Modal';

type Mode = 'path' | 'import' | 'generate';
const MODES: Mode[] = ['path', 'import', 'generate'];
const KEY_TYPES: GeneratedKeyType[] = ['ed25519', 'rsa'];
const POLICIES: PassphrasePolicy[] = ['ask', 'session', 'vault'];

/**
 * 개인키 추가(F7.1~F7.4, F7.7): 경로 참조, 가져오기, 새로 만들기(보관소에 저장). 등록할 때 형식·암호를 바로 확인하고
 * 실패 이유를 보여 준다. 키 내용·암호는 main으로만 가고 화면 상태는 제출 후 비운다(F7.2).
 */
export function KeyAddDialog() {
  const store = useStore();
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<Mode>('path');
  const [path, setPath] = useState('~/.ssh/id_ed25519');
  const [text, setText] = useState('');
  const [keyType, setKeyType] = useState<GeneratedKeyType>('ed25519');
  const [passphrase, setPassphrase] = useState('');
  const [policy, setPolicy] = useState<PassphrasePolicy>('session');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const back = () => store.openDialog({ kind: 'keys' });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const fallback =
      mode === 'path'
        ? path.split(/[\\/]/).pop() || path
        : mode === 'generate'
          ? `id_${keyType}`
          : 'key';
    const name = label.trim() || fallback;
    const common = {
      label: name,
      passphrasePolicy: policy,
      ...(passphrase ? { passphrase } : {}),
    };
    const result = await store.addKey(
      mode === 'path'
        ? { type: 'keys.addFromPath', path: path.trim(), ...common }
        : mode === 'import'
          ? { type: 'keys.importText', text, ...common }
          : { type: 'keys.generate', keyType, ...common },
    );
    setBusy(false);
    setText('');
    setPassphrase('');
    if (result.ok) back();
    else setError(t(messageFor('keyError', result.error, 'keyError.unknown')));
  };

  return (
    <Modal onCancel={back}>
      <form
        className="dialog wide"
        role="dialog"
        aria-labelledby="key-add-title"
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="key-add-title">{t('keyAdd.title')}</h2>
        <label>
          {t('keyAdd.label')}
          <input
            name="key-label"
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <fieldset className="choice">
          <legend>{t('keyAdd.mode')}</legend>
          {MODES.map((value) => (
            <label key={value} className="choice-item">
              <input
                type="radio"
                name="key-mode"
                value={value}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>
                <strong>{t(`keyAdd.mode.${value}`)}</strong>
                <span className="note">{t(`keyAdd.mode.${value}.hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {mode === 'path' ? (
          <label>
            {t('keyAdd.path')}
            <input
              name="key-path"
              value={path}
              spellCheck={false}
              onChange={(e) => setPath(e.target.value)}
            />
          </label>
        ) : mode === 'generate' ? (
          <fieldset className="choice">
            <legend>{t('keyAdd.keyType')}</legend>
            {KEY_TYPES.map((value) => (
              <label key={value} className="choice-item">
                <input
                  type="radio"
                  name="key-type"
                  value={value}
                  checked={keyType === value}
                  onChange={() => setKeyType(value)}
                />
                <span>{t(`keyAdd.keyType.${value}`)}</span>
              </label>
            ))}
          </fieldset>
        ) : (
          <label>
            {t('keyAdd.text')}
            <textarea
              name="key-text"
              rows={6}
              value={text}
              spellCheck={false}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
        )}
        <label>
          {t('keyAdd.passphrase')}
          <input
            name="key-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        <fieldset className="choice">
          <legend>{t('keyAdd.policy')}</legend>
          {POLICIES.map((value) => (
            <label key={value} className="choice-item">
              <input
                type="radio"
                name="key-policy"
                value={value}
                checked={policy === value}
                onChange={() => setPolicy(value)}
              />
              <span>{t(`keyAdd.policy.${value}`)}</span>
            </label>
          ))}
        </fieldset>
        {mode === 'path' && <p className="note">{t('keyAdd.pathNote')}</p>}
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={back}>
            {t('prompt.cancel')}
          </button>
          <button type="submit" className="btn primary" disabled={busy}>
            {t(mode === 'generate' ? 'keyAdd.generate' : 'keyAdd.submit')}
          </button>
        </div>
      </form>
    </Modal>
  );
}
