import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { serverStatsEnabled, type ServerStats } from '@btterm/core';
import { useAppState, useStore } from '../app/context';
import { t, type MessageKey } from '../i18n';
import { formatBytes, formatRate, formatUptime } from '../stats/format';
import { Icon } from './Icon';

/** 서버 상태 조회 간격(ST2) */
const POLL_MS = 3000;
/** 한 번 넘길 때 보이는 폭의 비율(DESIGN §5.4c) */
const PAGE = 0.8;

interface Item {
  key: string;
  label: MessageKey;
  value: string;
}

function usedOf(value: { usedBytes: number; totalBytes: number } | null): string | null {
  return value ? `${formatBytes(value.usedBytes)} / ${formatBytes(value.totalBytes)}` : null;
}

function itemsOf(stats: ServerStats): Item[] {
  const unknown = t('stats.unknown');
  const diskPercent =
    stats.disk && stats.disk.totalBytes > 0
      ? ` (${Math.round((stats.disk.usedBytes / stats.disk.totalBytes) * 100)}%)`
      : '';
  const rows: Array<[string, MessageKey, string | null]> = [
    ['os', 'stats.os', stats.os],
    ['cpu', 'stats.cpu', stats.cpuPercent === null ? null : `${stats.cpuPercent}%`],
    ['ram', 'stats.ram', usedOf(stats.mem)],
    [
      'net',
      'stats.net',
      stats.net ? `↑ ${formatRate(stats.net.txPerSec)} ↓ ${formatRate(stats.net.rxPerSec)}` : null,
    ],
    ['uptime', 'stats.uptime', stats.uptimeSec === null ? null : formatUptime(stats.uptimeSec)],
    ['user', 'stats.user', stats.user],
    ['disk', 'stats.disk', stats.disk ? `${usedOf(stats.disk)}${diskPercent}` : null],
  ];
  return rows.map(([key, label, value]) => ({ key, label, value: value ?? unknown }));
}

/**
 * 칸 아래 서버 상태 줄(F3.18, DESIGN §5.4c). 보이는 ready 세션만 3초마다 읽는다.
 * 칸 폭을 넘으면 스크롤바 없이 ◀ ▶로 넘겨 본다.
 */
export function StatsBar({ sessionId }: { sessionId: string | null }) {
  const store = useStore();
  const state = useAppState((s) => s.tabs.find((tab) => tab.sessionId === sessionId)?.state);
  const stats = useAppState((s) => (sessionId ? s.stats[sessionId] : undefined));
  // 서버·그룹별 끄기, 정하지 않았으면 production 태그 서버는 끔(ST10)
  const enabled = useAppState((s) => {
    const profileId = s.tabs.find((tab) => tab.sessionId === sessionId)?.profileId;
    const profile = s.profiles?.profiles.find((p) => p.id === profileId);
    return serverStatsEnabled(profile, s.profiles?.groups ?? []);
  });
  const ready = state === 'ready';

  useEffect(() => {
    if (!sessionId || !ready || !enabled) return;
    // 창이 가려져 있으면 원격 부하를 만들지 않는다(보안 리뷰 #8).
    const poll = () => {
      if (document.visibilityState !== 'hidden') void store.readStats(sessionId);
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => clearInterval(timer);
  }, [store, sessionId, ready, enabled]);

  if (!enabled) return null;

  let content: string | Item[];
  if (!sessionId || !state) content = '';
  else if (!ready) content = t(`state.${state}` as MessageKey);
  else if (!stats) content = t('stats.loading');
  else content = itemsOf(stats);

  return (
    <div className="statsbar" role="group" aria-label={t('stats.label')}>
      {typeof content === 'string' ? (
        <span className="stats-note">{content}</span>
      ) : (
        <Pager items={content} />
      )}
    </div>
  );
}

/** 넘치면 좌우 버튼으로 넘긴다(스크롤바 없음). */
function Pager({ items }: { items: Item[] }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ view: 0, content: 0 });
  const [offset, setOffset] = useState(0);
  const max = Math.max(0, size.content - size.view);
  const shown = Math.min(offset, max);

  useLayoutEffect(() => {
    const measure = () => {
      const view = viewportRef.current?.clientWidth ?? 0;
      const content = trackRef.current?.scrollWidth ?? 0;
      setSize((prev) =>
        prev.view === view && prev.content === content ? prev : { view, content },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (viewportRef.current) observer.observe(viewportRef.current);
    if (trackRef.current) observer.observe(trackRef.current);
    return () => observer.disconnect();
  });

  const step = Math.max(1, Math.round(size.view * PAGE));
  const overflow = max > 0;

  return (
    <>
      {overflow && (
        <button
          type="button"
          className="iconbtn stats-nav"
          aria-label={t('stats.prev')}
          title={t('stats.prev')}
          disabled={shown <= 0}
          onClick={() => setOffset(Math.max(0, shown - step))}
        >
          <Icon name="left" size={14} />
        </button>
      )}
      <div ref={viewportRef} className="stats-viewport">
        <div
          ref={trackRef}
          className="stats-track"
          style={{ transform: `translateX(-${shown}px)` }}
        >
          {items.map((item) => (
            <span key={item.key} className="stat" data-stat={item.key}>
              <span className="stat-label">{t(item.label)}</span>
              <span className="stat-value">{item.value}</span>
            </span>
          ))}
        </div>
      </div>
      {overflow && (
        <button
          type="button"
          className="iconbtn stats-nav"
          aria-label={t('stats.next')}
          title={t('stats.next')}
          disabled={shown >= max}
          onClick={() => setOffset(Math.min(max, shown + step))}
        >
          <Icon name="chevron" size={14} />
        </button>
      )}
    </>
  );
}
