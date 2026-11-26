import { useAppState, useShortcut, useStore } from '../app/context';
import { t } from '../i18n';
import { Icon } from './Icon';

/** 액티비티 바(DESIGN §4.1): 서버 목록·SFTP. 도구 패널은 칸 손잡이로 연다(결정 UX8). */
export function ActivityBar() {
  const store = useStore();
  const sidebarOpen = useAppState((s) => s.ui.sidebarOpen);
  const sideView = useAppState((s) => s.ui.sideView);
  const serversLabel = t('activity.servers', { key: useShortcut('toggleSidebar') });
  const filesLabel = t('activity.files', { key: useShortcut('focusSftp') });
  return (
    <nav className="activity" aria-label={t('activity.label')}>
      <button
        type="button"
        className="activity-btn"
        aria-pressed={sidebarOpen && sideView === 'servers'}
        title={serversLabel}
        aria-label={serversLabel}
        onClick={() =>
          sidebarOpen && sideView === 'servers'
            ? store.toggleSidebar()
            : store.setSideView('servers')
        }
      >
        <Icon name="servers" />
      </button>
      <button
        type="button"
        className="activity-btn"
        aria-pressed={sidebarOpen && sideView === 'files'}
        title={filesLabel}
        aria-label={filesLabel}
        onClick={() =>
          sidebarOpen && sideView === 'files' ? store.toggleSidebar() : store.setSideView('files')
        }
      >
        <Icon name="folder" />
      </button>
    </nav>
  );
}
