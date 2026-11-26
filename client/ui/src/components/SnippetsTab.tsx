import { useState, type FormEvent } from 'react';
import { needsSudoConfirm, snippetVars, fillSnippet, type Snippet } from '@btterm/core';
import { useAppState, useRegistry, useStore } from '../app/context';
import { t } from '../i18n';

type Mode = 'insert' | 'run';
const NONE: readonly Snippet[] = [];

/**
 * 스니펫 탭(F3.14 1단계, DESIGN §5.6): 자주 치는 명령을 저장해 두고 활성 탭에
 * 입력만(붙여넣기, 제어 문자 제거) 하거나 실행(입력 뒤 Enter)한다. {{변수}}는 먼저 값을 묻는다.
 */
export function SnippetsTab() {
  const store = useStore();
  const registry = useRegistry();
  const activeId = useAppState((s) => s.activeId);
  const snippets = useAppState((s) => s.settings?.snippets ?? NONE);
  const tags = useAppState((s) => {
    const tab = s.tabs.find((x) => x.sessionId === s.activeId);
    return s.profiles?.profiles.find((p) => p.id === tab?.profileId)?.tags ?? NONE_TAGS;
  });
  const tabName = useAppState((s) => {
    const tab = s.tabs.find((x) => x.sessionId === s.activeId);
    return tab?.customTitle ?? tab?.title ?? '';
  });
  const [editing, setEditing] = useState<Snippet | 'new' | null>(null);
  const [pending, setPending] = useState<{ snippet: Snippet; mode: Mode } | null>(null);
  const [blocked, setBlocked] = useState(false);

  const send = async (command: string, mode: Mode) => {
    if (!activeId) return;
    if (mode === 'insert') {
      setBlocked(!registry.insertText(activeId, command));
      return;
    }
    // production 서버에서 sudo가 들어간 명령은 확인한다(F3.14)
    if (needsSudoConfirm(command, tags)) {
      const ok = await store.requestConfirm({ kind: 'sudo', name: tabName });
      if (!ok) return;
    }
    setBlocked(!registry.runCommand(activeId, command));
  };

  const start = (snippet: Snippet, mode: Mode) => {
    if (snippetVars(snippet.command).length > 0) setPending({ snippet, mode });
    else void send(snippet.command, mode);
  };

  const save = (snippet: Snippet) => {
    const exists = snippets.some((s) => s.id === snippet.id);
    void store.saveSnippets(
      exists ? snippets.map((s) => (s.id === snippet.id ? snippet : s)) : [...snippets, snippet],
    );
    setEditing(null);
  };

  return (
    <div className="snippets">
      <button type="button" className="btn small" onClick={() => setEditing('new')}>
        {t('snippet.new')}
      </button>
      {!activeId && <p className="note">{t('snippet.noSession')}</p>}
      {blocked && (
        <p className="warn" role="status">
          {t('history.altBuffer')}
        </p>
      )}
      {editing && (
        <SnippetForm
          snippet={editing === 'new' ? null : editing}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}
      {pending && (
        <VariableForm
          snippet={pending.snippet}
          mode={pending.mode}
          onDone={(command) => {
            setPending(null);
            if (command !== null) void send(command, pending.mode);
          }}
        />
      )}
      {snippets.length === 0 && !editing && <p className="note">{t('snippet.empty')}</p>}
      <ul className="snippet-list">
        {snippets.map((snippet) => (
          <li key={snippet.id} className="snippet">
            <div className="snippet-head">
              <strong>{snippet.name}</strong>
              <code>{snippet.command}</code>
            </div>
            <div className="snippet-actions">
              <button
                type="button"
                className="btn small"
                disabled={!activeId}
                aria-label={t('snippet.insertNamed', { name: snippet.name })}
                onClick={() => start(snippet, 'insert')}
              >
                {t('snippet.insert')}
              </button>
              <button
                type="button"
                className="btn small primary"
                disabled={!activeId}
                aria-label={t('snippet.runNamed', { name: snippet.name })}
                onClick={() => start(snippet, 'run')}
              >
                {t('snippet.run')}
              </button>
              <button
                type="button"
                className="btn small"
                aria-label={t('snippet.editNamed', { name: snippet.name })}
                onClick={() => setEditing(snippet)}
              >
                {t('snippet.edit')}
              </button>
              <button
                type="button"
                className="btn small"
                aria-label={t('snippet.deleteNamed', { name: snippet.name })}
                onClick={() => void store.saveSnippets(snippets.filter((s) => s.id !== snippet.id))}
              >
                {t('menu.delete')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const NONE_TAGS: readonly string[] = [];

function SnippetForm({
  snippet,
  onSave,
  onCancel,
}: {
  snippet: Snippet | null;
  onSave(snippet: Snippet): void;
  onCancel(): void;
}) {
  const [name, setName] = useState(snippet?.name ?? '');
  const [command, setCommand] = useState(snippet?.command ?? '');
  const valid = name.trim().length > 0 && command.trim().length > 0;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!valid) return;
    onSave({
      id: snippet?.id ?? crypto.randomUUID(),
      name: name.trim().slice(0, 80),
      command: command.trim().slice(0, 4000),
    });
  };
  return (
    <form className="snippet-form" onSubmit={submit}>
      <input
        aria-label={t('snippet.name')}
        placeholder={t('snippet.name')}
        autoFocus
        maxLength={80}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <input
        className="mono"
        aria-label={t('snippet.command')}
        placeholder={t('snippet.commandHint')}
        spellCheck={false}
        maxLength={4000}
        value={command}
        onChange={(e) => setCommand(e.target.value)}
      />
      <div className="snippet-actions">
        <button
          type="submit"
          className="btn small primary"
          disabled={!valid}
          aria-label={t('snippet.save')}
        >
          {t('host.save')}
        </button>
        <button type="button" className="btn small" onClick={onCancel}>
          {t('prompt.cancel')}
        </button>
      </div>
    </form>
  );
}

function VariableForm({
  snippet,
  mode,
  onDone,
}: {
  snippet: Snippet;
  mode: Mode;
  onDone(command: string | null): void;
}) {
  const names = snippetVars(snippet.command);
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <form
      className="snippet-form"
      onSubmit={(e) => {
        e.preventDefault();
        onDone(fillSnippet(snippet.command, values));
      }}
    >
      {names.map((name, index) => (
        <label key={name}>
          {name}
          <input
            className="mono"
            autoFocus={index === 0}
            spellCheck={false}
            value={values[name] ?? ''}
            onChange={(e) => setValues({ ...values, [name]: e.target.value })}
          />
        </label>
      ))}
      <div className="snippet-actions">
        <button type="submit" className="btn small primary" aria-label={t('snippet.fill')}>
          {t(mode === 'run' ? 'snippet.run' : 'snippet.insert')}
        </button>
        <button type="button" className="btn small" onClick={() => onDone(null)}>
          {t('prompt.cancel')}
        </button>
      </div>
    </form>
  );
}
