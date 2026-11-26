import { useAppState, useStore } from '../app/context';
import { t } from '../i18n';
import { Icon } from './Icon';

/** 전송 목록(F4.4): 진행률·상태·취소. sessionId가 있으면 그 세션 것만. */
export function TransferList({ sessionId }: { sessionId?: string }) {
  const store = useStore();
  const all = useAppState((s) => s.transfers);
  // 폴더를 펼친 하위 전송은 폴더 한 줄로 보인다(TR1)
  const top = all.filter((x) => x.parentId === undefined);
  const transfers = sessionId ? top.filter((x) => x.sessionId === sessionId) : top;
  if (transfers.length === 0) return null;
  const finished = transfers.some((x) => x.state !== 'queued' && x.state !== 'running');
  return (
    <section className="transfers" aria-label={t('transfers.label')}>
      <div className="sechead-row">
        <span>{t('transfers.label')}</span>
        {finished && (
          <button type="button" className="link-btn" onClick={() => store.clearFinishedTransfers()}>
            {t('transfers.clear')}
          </button>
        )}
      </div>
      <ul>
        {transfers.map((transfer) => {
          const percent =
            transfer.total > 0 ? Math.round((transfer.bytes / transfer.total) * 100) : 0;
          const active = transfer.state === 'queued' || transfer.state === 'running';
          return (
            <li key={transfer.id} className="transfer" data-state={transfer.state}>
              <span className="transfer-name">
                <Icon
                  name={
                    transfer.folder ? 'folder' : transfer.direction === 'upload' ? 'up' : 'down'
                  }
                  size={12}
                />
                {transfer.name}
              </span>
              <progress max={100} value={percent} aria-label={transfer.name} />
              <span className="transfer-state">
                {t(`transfers.state.${transfer.state}`)}
                {transfer.state === 'running'
                  ? transfer.folder
                    ? ` ${transfer.bytes}/${transfer.total}`
                    : ` ${percent}%`
                  : ''}
              </span>
              {transfer.state === 'failed' && (
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t('transfers.retry', { name: transfer.name })}
                  title={t('transfers.retry', { name: transfer.name })}
                  onClick={() => store.retryTransfer(transfer.id)}
                >
                  <Icon name="refresh" size={12} />
                </button>
              )}
              {active && (
                <button
                  type="button"
                  className="iconbtn"
                  aria-label={t('transfers.cancel', { name: transfer.name })}
                  onClick={() => store.cancelTransfer(transfer.id)}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
