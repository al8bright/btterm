import { useAppState, useStore } from '../app/context';
import { t } from '../i18n';

/** 로컬에서 편집하다 저장된 파일(F4.8, DESIGN §5.3): 업로드는 누를 때만 */
export function EditChanges() {
  const store = useStore();
  const changes = useAppState((s) => s.editChanges);
  if (changes.length === 0) return null;
  return (
    <div className="edit-changes" role="status" aria-label={t('edit.label')}>
      {changes.map((change) => (
        <div key={change.editId} className="edit-change">
          <span>{t('edit.changed', { name: change.name })}</span>
          <button
            type="button"
            className="btn small primary"
            onClick={() => store.uploadEdit(change.editId)}
          >
            {t('edit.upload')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => store.dismissEdit(change.editId)}
          >
            {t('edit.dismiss')}
          </button>
        </div>
      ))}
    </div>
  );
}
