import {
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import type { TreeItemRef } from '@btterm/core';
import { useAppState, useStore } from '../app/context';
import { t } from '../i18n';
import { buildServerTree, type TreeRow } from '../servers/serverTree';
import { dropTarget, dropZoneAt, moveChangesInheritance, type DropZone } from '../servers/treeDrop';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { Icon } from './Icon';
import { isIconColor, ServerIcon } from './ServerIcon';

type ItemRow = Exclude<TreeRow, { kind: 'section' }>;
const rowKey = (row: ItemRow) => (row.kind === 'group' ? `group:${row.id}` : row.key);
/** 트리 끌기 표시. 다른 영역(탭바·칸·SFTP)은 이 끌기를 받지 않는다 */
const TREE_DRAG_TYPE = 'application/x-btterm-tree';
/** 목록 빈 곳(최상위 맨 끝)에 놓을 때의 표시 키 */
const END = 'end';

/** 서버 트리(F1.2, DESIGN §5.2): 고정·그룹, 퍼지 검색, 키보드 조작, 컨텍스트 메뉴. */
export function ServerTree() {
  const store = useStore();
  const view = useAppState((s) => s.profiles);
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; row: ItemRow } | null>(null);
  const dragged = useRef<TreeItemRef | null>(null);
  const [drop, setDrop] = useState<{ key: string; zone: DropZone } | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);

  const rows = useMemo(
    () => (view ? buildServerTree(view, { query, collapsed }) : []),
    [view, query, collapsed],
  );
  const items = rows.filter((r): r is ItemRow => r.kind !== 'section');
  const focusIndex = Math.max(
    0,
    items.findIndex((r) => rowKey(r) === focusKey),
  );

  const toggle = (groupId: string, open?: boolean) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      const isOpen = !next.has(groupId);
      if (open ?? !isOpen) next.delete(groupId);
      else next.add(groupId);
      return next;
    });

  const moveFocus = (index: number) => {
    const row = items[Math.max(0, Math.min(index, items.length - 1))];
    if (!row) return;
    setFocusKey(rowKey(row));
    document.querySelector<HTMLElement>(`[data-row="${CSS.escape(rowKey(row))}"]`)?.focus();
  };

  const menuItems = (row: ItemRow): MenuItem[] => {
    if (row.kind === 'group') {
      return [
        {
          label: t('menu.newHostHere'),
          onSelect: () => store.openDialog({ kind: 'host', profileId: null, groupId: row.id }),
        },
        {
          label: t('menu.newSubgroup'),
          onSelect: () => store.openDialog({ kind: 'group', groupId: null, parentId: row.id }),
        },
        {
          label: t('menu.edit'),
          onSelect: () => store.openDialog({ kind: 'group', groupId: row.id }),
        },
        {
          label: t('menu.delete'),
          danger: true,
          onSelect: () => void confirmDelete(row.label, () => store.deleteGroup(row.id)),
        },
      ];
    }
    const pinned = view?.profiles.find((p) => p.id === row.id)?.pinned === true;
    return [
      { label: t('menu.connect'), onSelect: () => void store.openProfile(row.id) },
      {
        label: t('menu.edit'),
        onSelect: () => store.openDialog({ kind: 'host', profileId: row.id }),
      },
      {
        label: t(pinned ? 'menu.unpin' : 'menu.pin'),
        onSelect: () => void store.togglePin(row.id),
      },
      {
        label: t('menu.delete'),
        danger: true,
        onSelect: () => void confirmDelete(row.label, () => store.deleteProfile(row.id)),
      },
    ];
  };

  const confirmDelete = async (name: string, remove: () => Promise<unknown>) => {
    if (await store.requestConfirm({ kind: 'delete', name })) await remove();
  };

  const openMenu = (row: ItemRow, x: number, y: number) => setMenu({ row, x, y });

  const onKeyDown = (event: KeyboardEvent, row: ItemRow, index: number) => {
    const key = event.key;
    if (key === 'ArrowDown') moveFocus(index + 1);
    else if (key === 'ArrowUp') moveFocus(index - 1);
    else if (key === 'Home') moveFocus(0);
    else if (key === 'End') moveFocus(items.length - 1);
    else if (key === 'ArrowRight' && row.kind === 'group') {
      if (row.expanded) moveFocus(index + 1);
      else toggle(row.id, true);
    } else if (key === 'ArrowLeft') {
      if (row.kind === 'group' && row.expanded) toggle(row.id, false);
      else moveFocus(parentIndex(items, index));
    } else if (key === 'Enter') {
      if (row.kind === 'group') toggle(row.id);
      else void store.openProfile(row.id);
    } else if (key === 'F2') {
      store.openDialog(
        row.kind === 'group'
          ? { kind: 'group', groupId: row.id }
          : { kind: 'host', profileId: row.id },
      );
    } else if (key === 'ContextMenu' || (key === 'F10' && event.shiftKey)) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      openMenu(row, rect.left + 24, rect.bottom);
    } else {
      return;
    }
    event.preventDefault();
  };

  const onContextMenu = (event: MouseEvent, row: ItemRow) => {
    event.preventDefault();
    openMenu(row, event.clientX, event.clientY);
  };

  // 서버 트리 끌어 놓기(F1.2a, DESIGN §5.2). 행이 처리하면 목록(빈 곳)으로 올리지 않는다.
  const targetOf = (event: DragEvent, row: ItemRow | null) => {
    const item = dragged.current;
    if (!item || !view) return null;
    let zone: DropZone = 'after';
    if (row) {
      const box = event.currentTarget.getBoundingClientRect();
      zone = dropZoneAt(row, box.height > 0 ? (event.clientY - box.top) / box.height : 0.5);
    }
    const target = dropTarget(view, item, row, zone);
    return target ? { zone, target } : null;
  };

  const onDragOver = (event: DragEvent, row: ItemRow | null) => {
    if (!dragged.current) return;
    event.stopPropagation();
    const hit = targetOf(event, row);
    const key = row ? rowKey(row) : END;
    if (hit) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
    setDrop((prev) => {
      if (!hit) return null;
      return prev?.key === key && prev.zone === hit.zone ? prev : { key, zone: hit.zone };
    });
  };

  const onDrop = (event: DragEvent, row: ItemRow | null) => {
    const item = dragged.current;
    const hit = targetOf(event, row);
    endDrag();
    if (!item || !hit || !view) return;
    event.preventDefault();
    event.stopPropagation();
    const { parentId, index } = hit.target;
    void (async () => {
      // 접속 계정·인증·시작 명령이 바뀌는 이동은 확인을 거친다(보안 리뷰 L1)
      if (moveChangesInheritance(view, item, parentId, index)) {
        const name =
          (item.kind === 'group' ? view.groups : view.profiles).find((x) => x.id === item.id)
            ?.name ?? item.id;
        if (!(await store.requestConfirm({ kind: 'move', name }))) return;
      }
      await store.moveTreeItem(item, parentId, index);
    })();
  };

  const endDrag = () => {
    dragged.current = null;
    setDrop(null);
    setDraggingKey(null);
  };

  const empty = (view?.profiles.length ?? 0) === 0 && (view?.groups.length ?? 0) === 0;

  return (
    <aside className="sidebar" aria-label={t('sidebar.label')}>
      <div className="sidebar-head">
        <span>{t('sidebar.title')}</span>
        <div className="sidebar-actions">
          <button
            type="button"
            className="iconbtn"
            aria-label={t('tree.newHost')}
            title={t('tree.newHost')}
            onClick={() => store.openDialog({ kind: 'host', profileId: null })}
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t('tree.newGroup')}
            title={t('tree.newGroup')}
            onClick={() => store.openDialog({ kind: 'group', groupId: null })}
          >
            <Icon name="folder" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t('tree.keys')}
            title={t('tree.keys')}
            onClick={() => store.openDialog({ kind: 'keys' })}
          >
            <Icon name="key" size={16} />
          </button>
        </div>
      </div>
      <input
        className="sidebar-search"
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === 'ArrowDown' && moveFocus(0)}
        placeholder={t('sidebar.search')}
        aria-label={t('sidebar.search')}
      />
      {empty && (
        <div className="sidebar-empty">
          <p>{t('sidebar.empty')}</p>
          <button
            type="button"
            className="btn small primary"
            onClick={() => store.openDialog({ kind: 'host', profileId: null })}
          >
            {t('empty.addServer')}
          </button>
          <button type="button" className="btn small" onClick={() => void store.importSshConfig()}>
            {t('sidebar.import')}
          </button>
        </div>
      )}
      {!empty && query && items.length === 0 && (
        <p className="sidebar-empty">{t('sidebar.noMatch')}</p>
      )}
      <div
        className="tree"
        role="tree"
        aria-label={t('sidebar.label')}
        data-drop={drop?.key === END ? 'end' : undefined}
        onDragOver={(e) => onDragOver(e, null)}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDrop(null);
        }}
        onDrop={(e) => onDrop(e, null)}
      >
        {rows.map((row) => {
          if (row.kind === 'section') {
            return (
              <div key={`section:${row.id}`} className="tree-section" role="presentation">
                {t(`tree.section.${row.id}`)}
              </div>
            );
          }
          const index = items.indexOf(row);
          const key = rowKey(row);
          return (
            <div
              key={key}
              data-row={key}
              role="treeitem"
              aria-level={row.level}
              aria-expanded={row.kind === 'group' ? row.expanded : undefined}
              aria-label={row.kind === 'profile' ? `${row.label} ${row.host}` : row.label}
              tabIndex={index === focusIndex ? 0 : -1}
              className={`tree-row ${row.kind}`}
              draggable={!query}
              data-drop={drop?.key === key ? drop.zone : undefined}
              data-dragging={draggingKey === key || undefined}
              onDragStart={(e) => {
                dragged.current = { kind: row.kind, id: row.id };
                setDraggingKey(key);
                e.dataTransfer.setData(TREE_DRAG_TYPE, row.id);
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDragEnd={endDrag}
              onDragOver={(e) => onDragOver(e, row)}
              onDrop={(e) => onDrop(e, row)}
              style={{ paddingLeft: `calc(var(--space-6) + ${(row.level - 1) * 12}px)` }}
              onFocus={() => setFocusKey(key)}
              onKeyDown={(e) => onKeyDown(e, row, index)}
              onContextMenu={(e) => onContextMenu(e, row)}
              onClick={() => row.kind === 'group' && toggle(row.id)}
              onDoubleClick={() => row.kind === 'profile' && void store.openProfile(row.id)}
            >
              {row.kind === 'group' ? (
                <>
                  <span className="tree-chevron" data-open={row.expanded} aria-hidden="true">
                    <Icon name="chevron" size={12} />
                  </span>
                  {/* 그룹을 서버와 구분하는 폴더(열림·닫힘), 그룹 아이콘 색이 있으면 그 색 */}
                  <span
                    className="folder-icon"
                    data-open={row.expanded}
                    data-color={isIconColor(row.color) ? row.color : undefined}
                    aria-hidden="true"
                  >
                    <Icon name={row.expanded ? 'folderOpen' : 'folder'} size={16} />
                  </span>
                </>
              ) : (
                <ServerIcon icon={row.icon} />
              )}
              <span className="tree-label">{row.label}</span>
              {row.kind === 'profile' && <span className="tree-host">{row.host}</span>}
              <button
                type="button"
                className="tree-more"
                tabIndex={-1}
                aria-label={t('tree.menu', { name: row.label })}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  openMenu(row, rect.left, rect.bottom);
                }}
              >
                <Icon name="more" size={14} />
              </button>
            </div>
          );
        })}
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={t('tree.menu', { name: menu.row.label })}
          items={menuItems(menu.row)}
          onClose={() => setMenu(null)}
        />
      )}
    </aside>
  );
}

/** 바로 위 단계(level - 1)의 가장 가까운 앞 행 */
function parentIndex(items: ItemRow[], index: number): number {
  const level = items[index]?.level ?? 1;
  for (let i = index - 1; i >= 0; i--) if ((items[i]?.level ?? 1) < level) return i;
  return index;
}
