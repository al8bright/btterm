import { useState } from 'react';
import type { Prompt, PromptResponse } from '@btterm/core';
import { t } from '../i18n';
import { Modal } from './Modal';

/** 전송 충돌(F4.3, F4.3b): 덮어쓰기 / 건너뛰기 / 이름 바꿔 저장 + 모두 적용. 기본은 안전한 건너뛰기. */
export function FileConflictDialog({
  prompt,
  onRespond,
}: {
  prompt: Extract<Prompt, { kind: 'fileConflict' }>;
  onRespond(response: PromptResponse): void;
}) {
  const [applyAll, setApplyAll] = useState(false);
  const decide = (decision: 'overwrite' | 'skip' | 'rename') =>
    onRespond({ kind: 'conflict', decision, ...(applyAll ? { applyAll } : {}) });
  return (
    <Modal onCancel={() => decide('skip')}>
      <div className="dialog" role="alertdialog" aria-labelledby="conflict-title">
        <h2 id="conflict-title">{t('conflict.title')}</h2>
        <p>{t('conflict.body', { name: prompt.name })}</p>
        <label className="choice-item">
          <input
            type="checkbox"
            checked={applyAll}
            onChange={(e) => setApplyAll(e.target.checked)}
          />
          <span>{t('conflict.applyAll')}</span>
        </label>
        <div className="actions">
          <button type="button" className="btn" onClick={() => decide('overwrite')}>
            {t('conflict.overwrite')}
          </button>
          <button type="button" className="btn" onClick={() => decide('rename')}>
            {t('conflict.rename')}
          </button>
          <button type="button" className="btn primary" autoFocus onClick={() => decide('skip')}>
            {t('conflict.skip')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
