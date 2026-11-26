import { useAppState, useShortcut, useStore } from '../app/context';
import type { ToolPanelTab } from '../store/AppStore';
import { t } from '../i18n';
import { DesignTab } from './DesignTab';
import { HistoryTab } from './HistoryTab';
import { SnippetsTab } from './SnippetsTab';
import { Icon } from './Icon';

const TABS: Array<{
  id: ToolPanelTab;
  label: 'panel.design' | 'panel.history' | 'panel.snippets';
}> = [
  { id: 'design', label: 'panel.design' },
  { id: 'history', label: 'panel.history' },
  { id: 'snippets', label: 'panel.snippets' },
];

/**
 * 도구 패널 열기·닫기 버튼(DESIGN §5.4): 칸 탭바의 [+] 오른쪽.
 * 다른 칸의 버튼을 누르면 그 칸이 활성이 되고, 열려 있던 패널은 그 칸으로 옮겨진다(결정 UX8).
 */
export function PanelToggle({ sessionId, focused }: { sessionId: string; focused: boolean }) {
  const store = useStore();
  const open = useAppState((s) => s.ui.toolPanel !== null);
  const expanded = focused && open;
  const onClick = () => {
    if (!focused) store.activate(sessionId);
    if (focused || !open) store.toggleToolPanel();
  };
  return (
    <button
      type="button"
      className="iconbtn panel-toggle"
      aria-expanded={expanded}
      aria-controls={expanded ? 'tool-panel' : undefined}
      aria-label={t('panel.handle')}
      title={t('panel.toggleTitle', { key: useShortcut('toggleToolPanel') })}
      onClick={onClick}
    >
      <Icon name="panel" size={16} />
    </button>
  );
}

/** 터미널 도구 패널(F3.15). 활성 칸 안 오른쪽에 하나만 연다. 탭: 디자인 / 명령 기록 / 스니펫. */
export function ToolPanel() {
  const store = useStore();
  const tab = useAppState((s) => s.ui.toolPanel);
  if (!tab) return null;
  return (
    <aside id="tool-panel" className="toolpanel" aria-label={t('panel.label')}>
      <div className="ptabs" role="tablist">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className="ptab"
            aria-selected={tab === item.id}
            aria-controls={`ptab-${item.id}`}
            onClick={() => tab !== item.id && store.toggleToolPanel(item.id)}
          >
            {t(item.label)}
          </button>
        ))}
        <button
          type="button"
          className="iconbtn"
          aria-label={t('panel.close')}
          onClick={() => store.toggleToolPanel(tab)}
        >
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="pbody" role="tabpanel" id={`ptab-${tab}`}>
        {tab === 'design' && <DesignTab />}
        {tab === 'history' && <HistoryTab />}
        {tab === 'snippets' && <SnippetsTab />}
      </div>
    </aside>
  );
}
