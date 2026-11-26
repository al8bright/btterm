import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent } from 'react';
import {
  joinRemote,
  parentRemote,
  type RemoteEntry,
  type ShellIntegrationStatus,
} from '@btterm/core';
import { useAppState, useStore } from '../app/context';
import { messageFor, t } from '../i18n';
import { Icon } from './Icon';
import { TransferList } from './TransferList';

type Edit =
  | { kind: 'mkdir'; value: string }
  | { kind: 'rename'; name: string; value: string }
  | { kind: 'chmod'; name: string; value: string };

interface Listing {
  path: string;
  entries: RemoteEntry[];
}

/**
 * 활성 탭의 원격 파일(F4.1~F4.5b): 브레드크럼 직접 편집, 숨김 토글, 파일 작업,
 * 끌어 놓기 업로드, 터미널 폴더 따라가기(셸 통합 동의 후 설치).
 */
export function SftpPanel() {
  const tab = useAppState((s) => s.tabs.find((x) => x.sessionId === s.activeId));
  if (!tab || tab.state !== 'ready') {
    return (
      <aside className="sidebar" aria-label={t('files.label')}>
        <div className="sidebar-head">
          <span>{t('files.label')}</span>
        </div>
        <p className="sidebar-empty">{t('files.noSession')}</p>
        <TransferList />
      </aside>
    );
  }
  return <SessionFiles key={tab.sessionId} sessionId={tab.sessionId} cwd={tab.cwd} />;
}

function SessionFiles({ sessionId, cwd }: { sessionId: string; cwd: string | undefined }) {
  const store = useStore();
  const [listing, setListing] = useState<Listing | null>(null);
  const [pathInput, setPathInput] = useState('');
  // 사용자가 경로를 고치는 중이면 목록이 새로 와도 입력란을 덮어쓰지 않는다.
  const editingPath = useRef(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [follow, setFollow] = useState(true);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [shell, setShell] = useState<ShellIntegrationStatus | null>(null);
  const doneCount = useAppState(
    (s) => s.transfers.filter((x) => x.sessionId === sessionId && x.state === 'done').length,
  );

  const fail = (error: string) =>
    setMessage(t(messageFor('files.error', error, 'files.error.unknown')));

  // 마지막 목록 요청의 응답만 반영한다(늦게 온 이전 응답이 덮어쓰지 않게).
  const latest = useRef(0);
  const open = useCallback(
    async (path: string) => {
      const request = ++latest.current;
      const result = await store.filesOp(sessionId, { kind: 'list', path });
      if (request !== latest.current) return;
      if (!result.ok) {
        fail(result.error);
        return;
      }
      const next = result.result as Listing;
      setListing(next);
      if (!editingPath.current) setPathInput(next.path);
      setSelected(null);
      setMessage(null);
    },
    [store, sessionId],
  );

  // 처음: 터미널 폴더(알면) 또는 홈. 셸 통합 상태도 확인한다.
  useEffect(() => {
    void open(cwd ?? '.');
    void store.filesOp(sessionId, { kind: 'shellStatus' }).then((result) => {
      if (result.ok) setShell(result.result as ShellIntegrationStatus);
    });
    // 처음 한 번만 실행한다.
  }, []);

  // F4.5 따라가기: 터미널이 폴더를 옮기면 따라간다.
  useEffect(() => {
    if (follow && cwd && cwd !== listing?.path) void open(cwd);
    // listing.path를 넣으면 사용자가 다른 폴더로 갔을 때 되돌아가 버린다.
  }, [cwd, follow, open]);

  // 업로드가 끝나면 목록을 새로 읽는다.
  useEffect(() => {
    if (doneCount > 0 && listing) void open(listing.path);
  }, [doneCount]);

  const current = listing?.path ?? '';
  const refresh = () => listing && void open(listing.path);
  const run = async (op: Parameters<typeof store.filesOp>[1]) => {
    const result = await store.filesOp(sessionId, op);
    if (!result.ok) fail(result.error);
    else refresh();
    return result.ok;
  };

  const submitEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!edit || !edit.value.trim()) return;
    const value = edit.value.trim();
    let ok = false;
    if (edit.kind === 'mkdir') ok = await run({ kind: 'mkdir', path: joinRemote(current, value) });
    if (edit.kind === 'rename') {
      ok = await run({
        kind: 'rename',
        from: joinRemote(current, edit.name),
        to: joinRemote(current, value),
      });
    }
    if (edit.kind === 'chmod' && /^[0-7]{3,4}$/.test(value)) {
      ok = await run({
        kind: 'chmod',
        path: joinRemote(current, edit.name),
        mode: parseInt(value, 8),
      });
    }
    if (ok) setEdit(null);
  };

  const remove = async (name: string) => {
    if (await store.requestConfirm({ kind: 'delete', name })) {
      await run({ kind: 'remove', path: joinRemote(current, name) });
    }
  };

  const installShell = async () => {
    if (!(await store.requestConfirm({ kind: 'shellInstall' }))) return;
    const result = await store.filesOp(sessionId, { kind: 'shellInstall' });
    if (!result.ok) {
      fail(result.error);
      return;
    }
    setShell(result.result as ShellIntegrationStatus);
    setMessage(t('shell.installed'));
  };

  const uninstallShell = async () => {
    const result = await store.filesOp(sessionId, { kind: 'shellUninstall' });
    if (result.ok) {
      setShell(result.result as ShellIntegrationStatus);
      setMessage(t('shell.removed'));
    } else fail(result.error);
  };

  const onDrop = (event: DragEvent) => {
    setDragOver(false);
    if (!hasFiles(event)) return;
    event.preventDefault();
    const paths = [...event.dataTransfer.files]
      .map((file) => store.pathForFile(file))
      .filter(Boolean);
    if (paths.length > 0 && listing) void store.upload(sessionId, listing.path, paths);
  };

  const entries = (listing?.entries ?? []).filter((e) => showHidden || !e.name.startsWith('.'));
  const selectedEntry = entries.find((e) => e.name === selected);

  return (
    <aside className="sidebar files" aria-label={t('files.label')}>
      <div className="sidebar-head">
        <span>{t('files.label')}</span>
        <div className="sidebar-actions">
          <button
            type="button"
            className="iconbtn"
            aria-label={t('files.up')}
            title={t('files.up')}
            onClick={() => void open(parentRemote(current))}
          >
            <Icon name="up" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t('files.refresh')}
            title={t('files.refresh')}
            onClick={refresh}
          >
            <Icon name="refresh" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t('files.mkdir')}
            title={t('files.mkdir')}
            onClick={() => setEdit({ kind: 'mkdir', value: '' })}
          >
            <Icon name="folder" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t('files.upload')}
            title={t('files.upload')}
            onClick={() => listing && void store.upload(sessionId, listing.path)}
          >
            <Icon name="plus" size={16} />
          </button>
          <button
            type="button"
            className="iconbtn"
            aria-label={t('files.uploadFolder')}
            title={t('files.uploadFolder')}
            onClick={() => listing && void store.uploadFolder(sessionId, listing.path)}
          >
            <Icon name="folderOpen" size={16} />
          </button>
        </div>
      </div>

      <form
        className="crumb"
        onSubmit={(e) => {
          e.preventDefault();
          editingPath.current = false;
          void open(pathInput);
        }}
      >
        <input
          name="remote-path"
          value={pathInput}
          spellCheck={false}
          aria-label={t('files.path')}
          onChange={(e) => {
            editingPath.current = true;
            setPathInput(e.target.value);
          }}
          onBlur={() => (editingPath.current = false)}
        />
      </form>

      <div className="follow-row">
        <button
          type="button"
          className="follow"
          aria-pressed={follow}
          disabled={!shell?.installed}
          onClick={() => setFollow((f) => !f)}
        >
          {t('files.followTerminal')}
        </button>
        <button
          type="button"
          className="btn small"
          disabled={!cwd}
          title={cwd ? undefined : t('files.noCwd')}
          onClick={() => cwd && void open(cwd)}
        >
          {t('files.syncNow')}
        </button>
        <label className="hidden-toggle">
          <input
            type="checkbox"
            checked={showHidden}
            onChange={(e) => setShowHidden(e.target.checked)}
          />
          {t('files.hidden')}
        </label>
      </div>

      {shell && !shell.installed && (
        <div className="shell-bar">
          <span>{t('shell.notInstalled')}</span>
          <button type="button" className="btn small primary" onClick={() => void installShell()}>
            {t('shell.install')}
          </button>
        </div>
      )}
      {shell?.installed && shell.loginCovered === false && (
        <p className="warn">{t('shell.loginWarn')}</p>
      )}

      {edit && (
        <form className="inline-edit" onSubmit={(e) => void submitEdit(e)}>
          <input
            name="files-edit"
            autoFocus
            value={edit.value}
            aria-label={t(
              edit.kind === 'mkdir'
                ? 'files.mkdirPrompt'
                : edit.kind === 'rename'
                  ? 'files.rename'
                  : 'files.chmod',
            )}
            onChange={(e) => setEdit({ ...edit, value: e.target.value })}
            onKeyDown={(e) => e.key === 'Escape' && setEdit(null)}
          />
        </form>
      )}

      {message && (
        <p className="note" role="status">
          {message}
        </p>
      )}

      <div
        className="file-list"
        role="listbox"
        aria-label={current}
        data-drag={dragOver}
        onDragOver={(e) => {
          // OS 파일만 받는다. 탭 끌기(F3.10a)는 지나가게 둔다.
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {dragOver && <div className="drop">{t('files.drop', { path: current })}</div>}
        {listing && entries.length === 0 && <p className="sidebar-empty">{t('files.empty')}</p>}
        {entries.map((entry) => (
          <div
            key={entry.name}
            role="option"
            aria-selected={entry.name === selected}
            tabIndex={0}
            className="file-row"
            data-type={entry.type}
            onClick={() => setSelected(entry.name)}
            onDoubleClick={() =>
              entry.type === 'dir'
                ? void open(joinRemote(current, entry.name))
                : void store.download(sessionId, [joinRemote(current, entry.name)])
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter' && entry.type === 'dir')
                void open(joinRemote(current, entry.name));
              if (e.key === 'Delete') void remove(entry.name);
              if (e.key === 'F2') setEdit({ kind: 'rename', name: entry.name, value: entry.name });
            }}
          >
            <span className="file-name">
              <Icon name={entry.type === 'dir' ? 'folder' : 'server'} size={14} />
              {entry.name}
            </span>
            <span className="file-size">{entry.type === 'dir' ? '' : formatSize(entry.size)}</span>
            <span className="file-mode">{formatMode(entry)}</span>
          </div>
        ))}
      </div>

      {selectedEntry && (
        <div className="file-actions">
          <button
            type="button"
            className="btn small"
            onClick={() =>
              void store.download(sessionId, [joinRemote(current, selectedEntry.name)])
            }
          >
            {t('files.download')}
          </button>
          {selectedEntry.type === 'file' && (
            <button
              type="button"
              className="btn small"
              onClick={() =>
                void store.editLocal(sessionId, joinRemote(current, selectedEntry.name))
              }
            >
              {t('files.editLocal')}
            </button>
          )}
          <button
            type="button"
            className="btn small"
            onClick={() =>
              setEdit({ kind: 'rename', name: selectedEntry.name, value: selectedEntry.name })
            }
          >
            {t('files.rename')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() =>
              setEdit({
                kind: 'chmod',
                name: selectedEntry.name,
                value: selectedEntry.mode.toString(8).padStart(3, '0'),
              })
            }
          >
            {t('files.chmod')}
          </button>
          <button
            type="button"
            className="btn small"
            onClick={() => void remove(selectedEntry.name)}
          >
            {t('files.delete')}
          </button>
        </div>
      )}

      {shell?.installed && (
        <button type="button" className="link-btn" onClick={() => void uninstallShell()}>
          {t('shell.uninstall')}
        </button>
      )}
      <TransferList sessionId={sessionId} />
    </aside>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

function formatMode(entry: RemoteEntry): string {
  const bits = 'rwxrwxrwx';
  const perms = [...bits].map((ch, i) => (entry.mode & (1 << (8 - i)) ? ch : '-')).join('');
  return (entry.type === 'dir' ? 'd' : entry.type === 'link' ? 'l' : '-') + perms;
}

function hasFiles(event: DragEvent): boolean {
  return [...event.dataTransfer.types].includes('Files');
}
