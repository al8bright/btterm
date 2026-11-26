import { useState, type FormEvent } from 'react';
import type { Prompt, PromptResponse } from '@btterm/core';
import { useStore } from './app/context';
import { FileConflictDialog } from './components/FileConflictDialog';
import { t } from './i18n';
import { Modal } from './components/Modal';

interface Props {
  prompt: Prompt;
  onRespond(response: PromptResponse): void;
}

/** 비밀번호·passphrase·추가 인증·호스트 키 확인(F2.3). 위험한 경우 기본 버튼은 "연결 취소"(DESIGN §5.7). */
export function PromptDialog({ prompt, onRespond }: Props) {
  if (prompt.kind === 'hostKey') return <HostKeyDialog prompt={prompt} onRespond={onRespond} />;
  if (prompt.kind === 'fileConflict') {
    return <FileConflictDialog prompt={prompt} onRespond={onRespond} />;
  }
  if (prompt.kind === 'keyboardInteractive') {
    return <KeyboardInteractiveDialog prompt={prompt} onRespond={onRespond} />;
  }
  return <SecretDialog prompt={prompt} onRespond={onRespond} />;
}

function SecretDialog({
  prompt,
  onRespond,
}: {
  prompt: Extract<Prompt, { kind: 'password' | 'passphrase' }>;
  onRespond(response: PromptResponse): void;
}) {
  const [secret, setSecret] = useState('');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRespond({ kind: 'secret', secret });
    setSecret('');
  };
  const isPassword = prompt.kind === 'password';
  const subtitle = isPassword ? `${prompt.username}@${prompt.host}` : prompt.keyLabel;
  return (
    <Modal onCancel={() => onRespond({ kind: 'cancel' })}>
      <form className="dialog" role="dialog" aria-labelledby="secret-title" onSubmit={submit}>
        <h2 id="secret-title">
          {t(isPassword ? 'prompt.password.title' : 'prompt.passphrase.title')}
        </h2>
        <p>{subtitle}</p>
        <label>
          {t(isPassword ? 'prompt.password.label' : 'prompt.passphrase.label')}{' '}
          <input
            name="secret"
            type="password"
            autoFocus
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
          />
        </label>
        <DialogActions onCancel={() => onRespond({ kind: 'cancel' })} />
      </form>
    </Modal>
  );
}

/** 서버가 보낸 질문(OTP 등)을 그대로 보여준다. 서버 문자열은 텍스트로만 렌더링한다(SEC-5). */
function KeyboardInteractiveDialog({
  prompt,
  onRespond,
}: {
  prompt: Extract<Prompt, { kind: 'keyboardInteractive' }>;
  onRespond(response: PromptResponse): void;
}) {
  const [answers, setAnswers] = useState(() => prompt.prompts.map(() => ''));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onRespond({ kind: 'answers', answers });
  };
  return (
    <Modal onCancel={() => onRespond({ kind: 'cancel' })}>
      <form className="dialog" role="dialog" aria-labelledby="kbd-title" onSubmit={submit}>
        <h2 id="kbd-title">{prompt.name || t('prompt.kbd.title')}</h2>
        <p>{prompt.host}</p>
        {prompt.instructions && <p>{prompt.instructions}</p>}
        {prompt.prompts.map((item, index) => (
          <label key={index}>
            {item.prompt}{' '}
            <input
              name={`answer-${index}`}
              type={item.echo ? 'text' : 'password'}
              autoFocus={index === 0}
              value={answers[index] ?? ''}
              onChange={(e) =>
                setAnswers((prev) => prev.map((v, i) => (i === index ? e.target.value : v)))
              }
            />
          </label>
        ))}
        <DialogActions onCancel={() => onRespond({ kind: 'cancel' })} />
      </form>
    </Modal>
  );
}

function DialogActions({ onCancel }: { onCancel(): void }) {
  return (
    <div className="actions">
      <button type="submit" className="btn primary">
        {t('prompt.submit')}
      </button>
      <button type="button" className="btn" onClick={onCancel}>
        {t('prompt.cancel')}
      </button>
    </div>
  );
}

function HostKeyDialog({
  prompt,
  onRespond,
}: {
  prompt: Extract<Prompt, { kind: 'hostKey' }>;
  onRespond(response: PromptResponse): void;
}) {
  const decide = (decision: 'reject' | 'accept-once' | 'accept-save') =>
    onRespond({ kind: 'hostKey', decision });
  const store = useStore();
  const mismatch = prompt.verdict === 'mismatch';
  const command = removeCommand(prompt.host, prompt.port);
  const target = `${prompt.host}:${prompt.port}`;
  return (
    <Modal onCancel={() => decide('reject')}>
      <div
        className={mismatch ? 'dialog danger' : 'dialog'}
        role="alertdialog"
        aria-labelledby="hk-title"
      >
        <h2 id="hk-title">{t(mismatch ? 'hostkey.mismatch.title' : 'hostkey.unknown.title')}</h2>
        <p>
          {target} · {t(mismatch ? 'hostkey.mismatch.body' : 'hostkey.unknown.body')}
        </p>
        {mismatch &&
          prompt.knownFingerprints?.map((fp) => (
            <div key={fp} className="fp">
              {t('hostkey.known')}: {fp}
            </div>
          ))}
        <div className="fp" data-testid="hostkey-fingerprint">
          {mismatch ? `${t('hostkey.new')}: ` : ''}
          {prompt.keyType} {prompt.fingerprint}
        </div>
        {mismatch && (
          <p className="note">
            {command
              ? t('hostkey.mismatch.hint', { command })
              : t('hostkey.mismatch.hintNoCommand')}
          </p>
        )}
        <div className="actions">
          {!mismatch && (
            <>
              <button type="button" className="btn primary" onClick={() => decide('accept-save')}>
                {t('hostkey.acceptSave')}
              </button>
              <button type="button" className="btn" onClick={() => decide('accept-once')}>
                {t('hostkey.acceptOnce')}
              </button>
            </>
          )}
          {mismatch && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                decide('reject');
                store.openDialog({ kind: 'knownHosts' });
              }}
            >
              {t('knownHosts.manage')}
            </button>
          )}
          <button
            type="button"
            className={mismatch ? 'btn safe' : 'btn'}
            autoFocus={mismatch}
            onClick={() => decide('reject')}
          >
            {t('hostkey.reject')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// 복사해 셸에 붙여 넣을 명령이므로 호스트 이름 문자만 허용한다(보안 리뷰 L-4)
const SAFE_HOST = /^[A-Za-z0-9._:%-]+$/;

/** ~/.ssh/known_hosts에서 이 호스트 키를 지우는 명령. 이름이 이상하면 보여 주지 않는다 */
function removeCommand(host: string, port: number): string | null {
  if (!SAFE_HOST.test(host)) return null;
  return `ssh-keygen -R "${port === 22 ? host : `[${host}]:${port}`}"`;
}
