import { useAppState } from '../app/context';
import { t, type MessageKey } from '../i18n';

/** 상태바(DESIGN §5.1): 활성 세션의 연결 상태·재접속 대기. */
export function StatusBar() {
  const tab = useAppState((s) => s.tabs.find((x) => x.sessionId === s.activeId));
  return (
    <footer className="statusbar" aria-label={t('status.label')}>
      {tab ? (
        <>
          <span className={`dot ${tab.state}`} aria-hidden="true" />
          <span className="status-main">{tab.title}</span>
          <span>{t(`state.${tab.state}` as MessageKey)}</span>
          {tab.state === 'reconnecting' && tab.reconnect?.nextDelayMs != null && (
            <span>
              {t('status.reconnectIn', {
                seconds: Math.ceil(tab.reconnect.nextDelayMs / 1000),
                attempt: tab.reconnect.attempt,
              })}
            </span>
          )}
        </>
      ) : (
        <span>{t('status.none')}</span>
      )}
    </footer>
  );
}
