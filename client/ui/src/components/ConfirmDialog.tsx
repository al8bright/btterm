import { useAppState, useStore } from '../app/context';
import { t, type MessageKey } from '../i18n';
import type { ConfirmRequest } from '../store/AppStore';
import { Modal } from './Modal';

const TEXT: Record<ConfirmRequest['kind'], { title: MessageKey; ok: MessageKey }> = {
  paste: { title: 'confirm.paste.title', ok: 'confirm.paste.ok' },
  link: { title: 'confirm.link.title', ok: 'confirm.link.ok' },
  delete: { title: 'confirm.delete.title', ok: 'menu.delete' },
  move: { title: 'confirm.move.title', ok: 'confirm.move.ok' },
  shellInstall: { title: 'shell.title', ok: 'shell.install' },
  sudo: { title: 'confirm.sudo.title', ok: 'snippet.run' },
};

function body(confirm: ConfirmRequest): string {
  if (confirm.kind === 'paste') return t('confirm.paste.body', { count: confirm.lineCount });
  if (confirm.kind === 'link') return t('confirm.link.body');
  if (confirm.kind === 'shellInstall') return t('shell.body');
  if (confirm.kind === 'move') return t('confirm.move.body', { name: confirm.name });
  if (confirm.kind === 'sudo') return t('confirm.sudo.body', { name: confirm.name });
  return t('confirm.delete.body', { name: confirm.name });
}

/** 여러 줄 붙여넣기(F3.9)·외부 링크(SEC-6)·삭제 확인. 기본 포커스는 안전한 "취소". */
export function ConfirmDialog() {
  const store = useStore();
  const confirm = useAppState((s) => s.confirm);
  if (!confirm) return null;
  const text = TEXT[confirm.kind];
  return (
    <Modal onCancel={() => store.resolveConfirm(false)}>
      <div
        className={confirm.kind === 'delete' ? 'dialog danger' : 'dialog'}
        role="alertdialog"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-body"
      >
        <h2 id="confirm-title">{t(text.title)}</h2>
        <p id="confirm-body">{body(confirm)}</p>
        {confirm.kind === 'link' && <div className="fp">{confirm.url}</div>}
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => store.resolveConfirm(true)}>
            {t(text.ok)}
          </button>
          <button
            type="button"
            className="btn"
            autoFocus
            onClick={() => store.resolveConfirm(false)}
          >
            {t('prompt.cancel')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
