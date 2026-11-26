import { useAppState, useStore } from '../app/context';
import { t } from '../i18n';

/**
 * 빠른 연결 저장 제안(F1.3). 오른쪽 아래, 사용자가 닫을 때까지 남는다.
 * 탭을 끄는 동안에는 흐려지고 놓기를 가로막지 않는다(F3.10a).
 */
export function Toast() {
  const store = useStore();
  const toast = useAppState((s) => s.toast);
  const dragging = useAppState((s) => s.ui.draggingTab !== null);
  if (!toast) return null;
  return (
    <div className="toast" role="status" data-passthrough={dragging}>
      <span>
        {t('toast.saveQuick', { target: `${toast.username}@${toast.host}:${toast.port}` })}
      </span>
      <button
        type="button"
        className="btn small primary"
        onClick={() => void store.saveQuickTarget()}
      >
        {t('toast.save')}
      </button>
      <button type="button" className="btn small" onClick={() => store.dismissToast()}>
        {t('toast.dismiss')}
      </button>
    </div>
  );
}
