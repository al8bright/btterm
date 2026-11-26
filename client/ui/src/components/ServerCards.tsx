import { useAppState, useStore } from '../app/context';
import { t } from '../i18n';
import { serverCards } from '../servers/serverTree';
import { ServerIcon } from './ServerIcon';

/** 빈 칸 서버 카드(F1.2b, DESIGN §5.4d): 고정 → 최근 접속 순으로 최대 8개, 누르면 접속 */
export function ServerCards() {
  const store = useStore();
  const view = useAppState((s) => s.profiles);
  const cards = view ? serverCards(view) : [];
  if (cards.length === 0) return null;
  return (
    <section className="server-cards" aria-label={t('empty.cards')}>
      {cards.map((card) => (
        <button
          key={card.id}
          type="button"
          className="server-card"
          aria-label={t('empty.cardLabel', { name: card.name, host: card.host })}
          onClick={() => void store.openProfile(card.id)}
        >
          <ServerIcon icon={card.icon} size={14} />
          <span className="server-card-text">
            <span className="server-card-name">{card.name}</span>
            <span className="server-card-host">{card.host}</span>
          </span>
        </button>
      ))}
    </section>
  );
}
