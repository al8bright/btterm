import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FilesOp, RemoteEntry } from '@btterm/core';
import { App } from '../App';
import { FakeBtTermApi } from '../testing/FakeBtTermApi';
import { FakeTerminalEngine } from '../testing/FakeTerminalEngine';

const file = (name: string, type: RemoteEntry['type'] = 'file'): RemoteEntry => ({
  name,
  type,
  size: 2048,
  mtimeMs: 0,
  mode: type === 'dir' ? 0o755 : 0o644,
});

const tree: Record<string, RemoteEntry[]> = {
  '/home/u': [file('logs', 'dir'), file('.bashrc'), file('notes.txt')],
  '/home/u/logs': [file('app.log')],
  '/var/log': [file('syslog')],
};

function setup(options: { shellInstalled?: boolean } = {}) {
  const ops: FilesOp[] = [];
  let installed = options.shellInstalled ?? false;
  const engines: FakeTerminalEngine[] = [];
  const api = new FakeBtTermApi()
    .on('session.openQuick', () => ({ sessionId: 's1' }))
    .on('files.op', (r) => {
      ops.push(r.op);
      if (r.op.kind === 'list') {
        const path = r.op.path === '.' ? '/home/u' : r.op.path;
        const entries = tree[path];
        return entries ? { ok: true, result: { path, entries } } : { ok: false, error: 'missing' };
      }
      if (r.op.kind === 'shellStatus' || r.op.kind === 'shellInstall') {
        if (r.op.kind === 'shellInstall') installed = true;
        return {
          ok: true,
          result: { installed, rcFiles: installed ? ['.bashrc'] : [], loginCovered: true },
        };
      }
      return { ok: true, result: null };
    })
    .on('files.upload', () => ({ ok: true, transferIds: ['t1'] }))
    .on('files.download', () => ({ ok: true, transferIds: ['t2'] }));
  render(
    <App
      api={api}
      createEngine={(hooks) => {
        const engine = new FakeTerminalEngine(hooks);
        engines.push(engine);
        return engine;
      }}
    />,
  );
  return { api, ops, engines };
}

const flush = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

async function connectAndOpenFiles(env: ReturnType<typeof setup>) {
  fireEvent.change(screen.getByRole('combobox', { name: '빠른 연결' }), {
    target: { value: 'u@h' },
  });
  fireEvent.submit(screen.getByRole('search', { name: '빠른 연결' }));
  await flush();
  act(() => env.api.emit({ type: 'session.state', sessionId: 's1', state: 'ready' }));
  fireEvent.keyDown(window, { code: 'KeyE', ctrlKey: true, shiftKey: true });
  await flush();
  return screen.getByRole('complementary', { name: '원격 파일' });
}

describe('SFTP 패널(F4.1, F4.2)', () => {
  it('홈 목록을 폴더 먼저 보여 주고, 숨김 파일은 토글로 본다', async () => {
    const env = setup();
    const panel = await connectAndOpenFiles(env);
    const names = () =>
      within(panel)
        .getAllByRole('option')
        .map((o) => o.textContent);
    expect(names()[0]).toContain('logs');
    expect(names().some((n) => n?.includes('.bashrc'))).toBe(false);
    fireEvent.click(within(panel).getByRole('checkbox', { name: '숨김 파일 보기' }));
    expect(names().some((n) => n?.includes('.bashrc'))).toBe(true);
  });

  it('폴더를 더블클릭하면 들어가고, 경로를 직접 입력해 이동한다', async () => {
    const env = setup();
    const panel = await connectAndOpenFiles(env);
    fireEvent.doubleClick(within(panel).getByText('logs'));
    await flush();
    expect(within(panel).getByText('app.log')).toBeTruthy();
    const path = within(panel).getByRole('textbox', { name: '원격 경로' });
    fireEvent.change(path, { target: { value: '/var/log' } });
    fireEvent.submit(path);
    await flush();
    expect(within(panel).getByText('syslog')).toBeTruthy();
  });

  it('늦게 도착한 이전 목록 응답이 나중 요청의 결과를 덮어쓰지 않는다', async () => {
    const env = setup();
    let releaseHome: () => void = () => undefined;
    env.api.on('files.op', (r) => {
      if (r.op.kind !== 'list')
        return { ok: true, result: { installed: true, rcFiles: [], loginCovered: true } };
      const path = r.op.path === '.' ? '/home/u' : r.op.path;
      const result = { ok: true, result: { path, entries: tree[path] ?? [] } };
      // 홈 목록은 늦게 도착한다
      return path === '/home/u'
        ? new Promise((resolve) => (releaseHome = () => resolve(result)))
        : result;
    });
    const panel = await connectAndOpenFiles(env);
    const path = within(panel).getByRole('textbox', { name: '원격 경로' });
    fireEvent.change(path, { target: { value: '/var/log' } });
    fireEvent.submit(path);
    await flush();
    releaseHome();
    await flush();
    expect(within(panel).getByText('syslog')).toBeTruthy();
    expect((path as HTMLInputElement).value).toBe('/var/log');
  });

  it('새 폴더를 이름 입력으로 만든다', async () => {
    const env = setup();
    const panel = await connectAndOpenFiles(env);
    fireEvent.click(within(panel).getByRole('button', { name: '새 폴더' }));
    const input = within(panel).getByRole('textbox', { name: '새 폴더 이름' });
    fireEvent.change(input, { target: { value: 'backup' } });
    fireEvent.submit(input);
    await flush();
    expect(env.ops).toContainEqual({ kind: 'mkdir', path: '/home/u/backup' });
  });

  it('F4.5 셸 통합은 동의를 받고 설치하며, 설치 후 터미널 폴더를 따라간다', async () => {
    const env = setup();
    const panel = await connectAndOpenFiles(env);
    fireEvent.click(within(panel).getByRole('button', { name: '셸 통합 설치' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('# >>> btterm >>>');
    fireEvent.click(within(dialog).getByRole('button', { name: '셸 통합 설치' }));
    await flush();
    expect(env.ops).toContainEqual({ kind: 'shellInstall' });
    expect(
      within(panel)
        .getByRole('button', { name: '터미널 폴더 따라가기' })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    act(() => env.engines[0]!.osc7('file://web/var/log'));
    await flush();
    expect(within(panel).getByText('syslog')).toBeTruthy();
  });

  it('F4.3 파일을 끌어 놓으면 현재 폴더로 업로드한다', async () => {
    const env = setup({ shellInstalled: true });
    const panel = await connectAndOpenFiles(env);
    const list = within(panel).getByRole('listbox');
    fireEvent.drop(list, {
      dataTransfer: { types: ['Files'], files: [{ testPath: 'C:/tmp/한글.txt' }] },
    });
    await flush();
    expect(env.api.requestsOf('files.upload')).toEqual([
      {
        type: 'files.upload',
        sessionId: 's1',
        remoteDir: '/home/u',
        localPaths: ['C:/tmp/한글.txt'],
      },
    ]);
  });

  it('F3.10a 탭을 끌어 지나가면 업로드 안내를 띄우지 않는다', async () => {
    const env = setup({ shellInstalled: true });
    const panel = await connectAndOpenFiles(env);
    const list = within(panel).getByRole('listbox');
    fireEvent.dragOver(list, { dataTransfer: { types: ['application/x-btterm-tab'], files: [] } });
    expect(list.getAttribute('data-drag')).toBe('false');
    fireEvent.drop(list, { dataTransfer: { types: ['application/x-btterm-tab'], files: [] } });
    await flush();
    expect(env.api.requestsOf('files.upload')).toEqual([]);
  });

  it('F4.7 폴더를 고르면 폴더째 내려받고, 폴더 올리기는 폴더 선택 창을 연다', async () => {
    const env = setup({ shellInstalled: true });
    const panel = await connectAndOpenFiles(env);
    fireEvent.click(within(panel).getByRole('option', { name: /logs/ }));
    fireEvent.click(within(panel).getByRole('button', { name: '다운로드' }));
    await flush();
    expect(env.api.requestsOf('files.download')).toEqual([
      { type: 'files.download', sessionId: 's1', remotePaths: ['/home/u/logs'] },
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: '폴더 올리기' }));
    await flush();
    expect(env.api.requestsOf('files.upload').at(-1)).toEqual({
      type: 'files.upload',
      sessionId: 's1',
      remoteDir: '/home/u',
      pick: 'folder',
    });
  });

  it('F4.7 폴더 전송은 한 줄에 끝난 파일 수/찾은 파일 수로 보이고, 하위 전송 줄은 보이지 않는다', async () => {
    const env = setup({ shellInstalled: true });
    const panel = await connectAndOpenFiles(env);
    const base = { sessionId: 's1', direction: 'download' as const, bytes: 0, total: 0 };
    act(() => {
      env.api.emit({
        type: 'transfer.status',
        status: {
          ...base,
          id: 'f1',
          name: 'logs',
          state: 'running',
          bytes: 3,
          total: 10,
          folder: true,
        },
      });
      env.api.emit({
        type: 'transfer.status',
        status: { ...base, id: 'c1', name: 'app.log', state: 'running', parentId: 'f1' },
      });
    });
    expect(within(panel).getByText(/3\/10/)).toBeTruthy();
    expect(within(panel).queryByText('app.log')).toBeNull();
  });

  it('TR3 파일을 로컬에서 편집하고, 저장되면 띠에서 업로드하거나 무시한다', async () => {
    const env = setup({ shellInstalled: true });
    env.api
      .on('files.editLocal', () => ({ ok: true, editId: 'e1' }))
      .on('files.editUpload', () => ({ ok: true }));
    const panel = await connectAndOpenFiles(env);
    fireEvent.click(within(panel).getByRole('option', { name: /notes\.txt/ }));
    fireEvent.click(within(panel).getByRole('button', { name: '로컬에서 편집' }));
    await flush();
    expect(env.api.requestsOf('files.editLocal')).toEqual([
      { type: 'files.editLocal', sessionId: 's1', remotePath: '/home/u/notes.txt' },
    ]);

    act(() =>
      env.api.emit({ type: 'files.editChanged', editId: 'e1', sessionId: 's1', name: 'notes.txt' }),
    );
    const bar = screen.getByRole('status', { name: '로컬 편집' });
    expect(bar.textContent).toContain('notes.txt');
    fireEvent.click(within(bar).getByRole('button', { name: '업로드' }));
    await flush();
    expect(env.api.requestsOf('files.editUpload')).toEqual([
      { type: 'files.editUpload', editId: 'e1' },
    ]);
    expect(screen.queryByRole('status', { name: '로컬 편집' })).toBeNull();

    act(() =>
      env.api.emit({ type: 'files.editChanged', editId: 'e1', sessionId: 's1', name: 'notes.txt' }),
    );
    fireEvent.click(
      within(screen.getByRole('status', { name: '로컬 편집' })).getByRole('button', {
        name: '무시',
      }),
    );
    expect(screen.queryByRole('status', { name: '로컬 편집' })).toBeNull();
    expect(env.api.requestsOf('files.editUpload')).toHaveLength(1);
  });

  it('TR3 실행 파일처럼 열 수 없는 파일은 이유를 알린다', async () => {
    const env = setup({ shellInstalled: true });
    env.api.on('files.editLocal', () => ({ ok: false, error: 'blocked-type' }));
    const panel = await connectAndOpenFiles(env);
    fireEvent.click(within(panel).getByRole('option', { name: /notes\.txt/ }));
    fireEvent.click(within(panel).getByRole('button', { name: '로컬에서 편집' }));
    await flush();
    expect(screen.getByRole('alert').textContent).toContain('실행되거나 서식 문서로 열리는 파일');
  });

  it('TR2 실패한 전송은 다시 시도하고, 끝난 목록을 정리하면 실패한 전송의 부분 파일도 지운다', async () => {
    const env = setup({ shellInstalled: true });
    const panel = await connectAndOpenFiles(env);
    act(() =>
      env.api.emit({
        type: 'transfer.status',
        status: {
          id: 't9',
          sessionId: 's1',
          direction: 'download',
          name: 'big.iso',
          state: 'failed',
          bytes: 5,
          total: 9,
          error: 'closed',
        },
      }),
    );
    fireEvent.click(within(panel).getByRole('button', { name: 'big.iso 다시 시도' }));
    expect(env.api.requestsOf('transfer.retry')).toEqual([
      { type: 'transfer.retry', transferId: 't9' },
    ]);
    fireEvent.click(within(panel).getByRole('button', { name: '완료 항목 지우기' }));
    expect(env.api.requestsOf('transfer.discard')).toEqual([
      { type: 'transfer.discard', transferId: 't9' },
    ]);
  });

  it('F4.4 전송 목록에서 진행 중인 전송을 취소한다', async () => {
    const env = setup({ shellInstalled: true });
    const panel = await connectAndOpenFiles(env);
    act(() =>
      env.api.emit({
        type: 'transfer.status',
        status: {
          id: 't1',
          sessionId: 's1',
          direction: 'upload',
          name: 'big.iso',
          state: 'running',
          bytes: 50,
          total: 100,
        },
      }),
    );
    expect(within(panel).getByText(/전송 중 50%/)).toBeTruthy();
    fireEvent.click(within(panel).getByRole('button', { name: 'big.iso 전송 취소' }));
    expect(env.api.requestsOf('transfer.cancel')).toEqual([
      { type: 'transfer.cancel', transferId: 't1' },
    ]);
  });
});
