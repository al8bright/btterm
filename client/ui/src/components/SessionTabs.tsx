import { useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { tabColorOf } from '@btterm/core';
import { useAppState, useShortcut, useStore } from '../app/context';
import { t, type MessageKey } from '../i18n';
import {
  allGroups,
  allowedSpots,
  MAX_GROUPS,
  type DropSide,
  type PaneGroup,
} from '../workspace/groupLayout';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Icon } from './Icon';
import { isIconColor } from './ServerIcon';
import { PanelToggle } from './ToolPanel';

/** 탭 끌기 데이터 형식. 파일 드롭(F4.3)과 구분한다. */
export const TAB_DRAG_TYPE = 'application/x-btterm-tab';

interface Props {
  group: PaneGroup;
  /** 활성 칸인지 */
  focused: boolean;
  onNewTab(): void;
}

/**
 * 칸(탭 그룹)의 탭바(DESIGN §5.4). 칸마다 하나씩 칸 바로 위에 있다(F3.10a).
 * 닫기 버튼은 탭의 형제 요소, 중클릭·Delete로도 닫는다. 탭이 2개 이상이면 끌어서 옮기거나 분할한다.
 */
export function SessionTabs({ group, focused, onNewTab }: Props) {
  const store = useStore();
  const allTabs = useAppState((s) => s.tabs);
  const layout = useAppState((s) => s.layout);
  const draggingTab = useAppState((s) => s.ui.draggingTab);
  const profiles = useAppState((s) => s.profiles);
  const newTabLabel = t('tab.new', { key: useShortcut('newTab') });
  const colorOf = (profileId: string | undefined) => {
    const profile = profiles?.profiles.find((p) => p.id === profileId);
    const color = tabColorOf(profile, profiles?.groups ?? []);
    return isIconColor(color) ? color : undefined;
  };
  const [menu, setMenu] = useState<{ sessionId: string; x: number; y: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const tabs = group.tabs.flatMap((id) => allTabs.filter((tab) => tab.sessionId === id));
  const draggable = allTabs.length >= 2;

  const openMenu = (sessionId: string, x: number, y: number) => setMenu({ sessionId, x, y });

  const onKeyDown = (event: KeyboardEvent, sessionId: string) => {
    if (event.key === 'Delete') store.closeTab(sessionId);
    if (event.key === 'F2') {
      event.preventDefault();
      setEditing(sessionId);
    }
    // 포커스한 탭의 칸 안에서 돈다(Tab 키로 다른 칸 탭에 왔을 수 있다).
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      store.activate(sessionId);
      store.cycleTab(event.key === 'ArrowRight' ? 1 : -1);
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(sessionId, rect.left, rect.bottom);
    }
  };

  const onContextMenu = (event: MouseEvent, sessionId: string) => {
    event.preventDefault();
    openMenu(sessionId, event.clientX, event.clientY);
  };

  const onDragStart = (event: DragEvent, sessionId: string) => {
    event.dataTransfer.setData(TAB_DRAG_TYPE, sessionId);
    event.dataTransfer.effectAllowed = 'move';
    store.startTabDrag(sessionId);
  };

  /** 탭을 끄는 중일 때만 놓기를 받는다. */
  const accept = (event: DragEvent): boolean => {
    const isTab = [...event.dataTransfer.types].includes(TAB_DRAG_TYPE);
    if (!isTab || !store.getState().ui.draggingTab) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };

  const menuItems = (sessionId: string): MenuItem[] => {
    const allowed = allowedSpots(layout, group.id, sessionId);
    const choices: Array<[DropSide, MessageKey]> = [
      ['right', 'tab.splitRight'],
      ['bottom', 'tab.splitDown'],
    ];
    // 탭이 하나여도 같은 서버를 옆에 열어 나눌 수 있다(F3.10b)
    const items: MenuItem[] = [{ label: t('tab.rename'), onSelect: () => setEditing(sessionId) }];
    items.push(
      ...(allGroups(layout).length < MAX_GROUPS
        ? [
            {
              label: t('tab.openRight'),
              onSelect: () => void store.openBeside(sessionId, 'right'),
            },
            {
              label: t('tab.openDown'),
              onSelect: () => void store.openBeside(sessionId, 'bottom'),
            },
          ]
        : []),
    );
    items.push(
      ...choices
        .filter(([side]) => allowed.includes(side))
        .map(([side, label]) => ({
          label: t(label),
          onSelect: () => store.splitTab(sessionId, side),
        })),
    );
    if (allGroups(layout).length > 1) {
      items.push({ label: t('tab.merge'), onSelect: () => store.mergeGroups() });
    }
    return items;
  };

  const items = menu && group.tabs.includes(menu.sessionId) ? menuItems(menu.sessionId) : [];

  return (
    <div className="tabbar" data-focused={focused}>
      <div
        className="tabs"
        role="tablist"
        aria-label={t('tabs.label')}
        onDragOver={(e) => {
          if (accept(e)) e.dataTransfer.dropEffect = 'move';
        }}
        onDrop={(e) => {
          if (accept(e)) store.dropTabOnBar(group.id);
        }}
      >
        {tabs.map((tab) => {
          const name = tab.customTitle ?? tab.title;
          const label = `${name} ${t(`state.${tab.state}` as MessageKey)}`;
          const selected = tab.sessionId === group.active;
          return (
            <div
              key={tab.sessionId}
              className="tab-wrap"
              data-active={selected}
              data-color={colorOf(tab.profileId)}
              data-dragging={draggingTab === tab.sessionId || undefined}
              onDragOver={(e) => {
                if (accept(e)) e.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(e) => {
                if (accept(e)) store.dropTabOnTab(tab.sessionId);
              }}
            >
              {editing === tab.sessionId && (
                <TabNameEditor
                  initial={name}
                  onDone={(next) => {
                    setEditing(null);
                    if (next !== null) store.renameTab(tab.sessionId, next);
                  }}
                />
              )}
              <button
                type="button"
                role="tab"
                className="tab"
                hidden={editing === tab.sessionId}
                title={tab.title}
                aria-selected={selected}
                aria-controls={`panel-${tab.sessionId}`}
                aria-label={label}
                tabIndex={selected ? 0 : -1}
                draggable={draggable}
                onClick={() => store.activate(tab.sessionId)}
                onDoubleClick={() => setEditing(tab.sessionId)}
                onAuxClick={(e) => e.button === 1 && store.closeTab(tab.sessionId)}
                onKeyDown={(e) => onKeyDown(e, tab.sessionId)}
                onContextMenu={(e) => onContextMenu(e, tab.sessionId)}
                onDragStart={(e) => onDragStart(e, tab.sessionId)}
                onDragEnd={() => store.startTabDrag(null)}
              >
                <span className={`dot ${tab.state}`} aria-hidden="true" />
                {name}
              </button>
              <button
                type="button"
                className="tab-close"
                tabIndex={-1}
                aria-label={t('tab.closeNamed', { name })}
                onClick={() => store.closeTab(tab.sessionId)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="iconbtn"
        aria-label={newTabLabel}
        title={newTabLabel}
        onClick={() => {
          if (group.active) store.activate(group.active);
          // 칸을 활성으로 하면 그 터미널이 포커스를 가져가므로, 그 뒤에 빠른 연결로 포커스한다.
          setTimeout(onNewTab, 0);
        }}
      >
        <Icon name="plus" size={16} />
      </button>
      {group.active && <PanelToggle sessionId={group.active} focused={focused} />}
      {menu && items.length > 0 && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t('tab.menu')}
          items={items}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

/** 탭 자리 이름 입력칸(F3.1b). Enter·포커스 잃음 = 확정, Esc = 취소(null) */
function TabNameEditor({
  initial,
  onDone,
}: {
  initial: string;
  onDone(name: string | null): void;
}) {
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      className="tab-rename"
      aria-label={t('tab.renameLabel')}
      defaultValue={initial}
      autoFocus
      spellCheck={false}
      maxLength={80}
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(e.currentTarget.value);
        if (e.key === 'Escape') finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  );
}
