import { useState, type FormEvent } from 'react';
import type { Group, HostDefaults } from '@btterm/core';
import { useAppState, useStore } from '../app/context';
import { messageFor, t } from '../i18n';
import { ColorChoices } from './ColorChoices';
import { IconPicker } from './IconPicker';
import { Modal } from './Modal';

/** 그룹 편집: 이름·상위 그룹·하위 서버 기본값(D13 상속, F1.11 아이콘). */
export function GroupEditDialog({
  groupId,
  parentId: initialParent,
}: {
  groupId: string | null;
  parentId?: string | null | undefined;
}) {
  const store = useStore();
  const view = useAppState((s) => s.profiles);
  const existing = view?.groups.find((g) => g.id === groupId);
  const [name, setName] = useState(existing?.name ?? '');
  const [parentId, setParentId] = useState<string | null>(
    existing?.parentId ?? initialParent ?? null,
  );
  const [port, setPort] = useState(existing?.defaults.port?.toString() ?? '');
  const [username, setUsername] = useState(existing?.defaults.username ?? '');
  const [identityId, setIdentityId] = useState(existing?.defaults.identityId ?? '');
  const [icon, setIcon] = useState(
    existing?.defaults.icon?.kind === 'builtin' ? existing.defaults.icon.name : '',
  );
  const [iconColor, setIconColor] = useState(
    existing?.defaults.icon?.kind === 'builtin' ? (existing.defaults.icon.color ?? '') : '',
  );
  const [tabColor, setTabColor] = useState(existing?.defaults.tabColor ?? '');
  const [startupCommand, setStartupCommand] = useState(existing?.defaults.startupCommand ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!view) return null;
  const close = () => store.closeDialog();
  // 자기 자신과 하위 그룹은 상위로 고를 수 없다(순환 방지)
  const blocked = descendants(view.groups, groupId);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(t('host.required'));
      return;
    }
    const defaults: HostDefaults = {
      ...existing?.defaults,
      ...(port ? { port: Number(port) } : { port: undefined }),
      ...(username ? { username } : { username: undefined }),
      ...(identityId ? { identityId } : { identityId: undefined }),
      ...(icon
        ? { icon: { kind: 'builtin', name: icon, ...(iconColor ? { color: iconColor } : {}) } }
        : { icon: undefined }),
      tabColor: tabColor || undefined,
      startupCommand: startupCommand.trim() || undefined,
    };
    const clean = Object.fromEntries(
      Object.entries(defaults).filter(([, v]) => v !== undefined),
    ) as HostDefaults;
    const result = await store.saveGroup({
      id: groupId,
      name: name.trim(),
      parentId,
      defaults: clean,
    });
    if (!result.ok) setError(t(messageFor('error', result.error, 'error.save-failed')));
    else close();
  };

  return (
    <Modal onCancel={close}>
      <form
        className="dialog"
        role="dialog"
        aria-labelledby="group-title"
        onSubmit={(e) => void submit(e)}
      >
        <h2 id="group-title">{t(groupId ? 'group.titleEdit' : 'group.titleNew')}</h2>
        <div className="form-grid">
          <label>
            {t('group.name')}
            <input
              name="group-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {t('group.parent')}
            <select
              name="parent"
              value={parentId ?? ''}
              onChange={(e) => setParentId(e.target.value || null)}
            >
              <option value="">{t('host.noGroup')}</option>
              {view.groups
                .filter((g) => !blocked.has(g.id))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <fieldset className="identity">
          <legend>{t('group.defaults')}</legend>
          <div className="form-grid">
            <label>
              {t('host.port')}
              <input
                name="group-port"
                inputMode="numeric"
                value={port}
                placeholder="22"
                onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label>
              {t('host.username')}
              <input
                name="group-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              {t('host.identity')}
              <select
                name="group-identity"
                value={identityId}
                onChange={(e) => setIdentityId(e.target.value)}
              >
                <option value="">{t('host.identity.none')}</option>
                {view.identities.map((identity) => (
                  <option key={identity.id} value={identity.id}>
                    {identity.label} · {identity.username}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('host.startupCommand')}
              <input
                name="group-startupCommand"
                className="mono"
                spellCheck={false}
                value={startupCommand}
                onChange={(e) =>
                  setStartupCommand(
                    [...e.target.value]
                      .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f)
                      .join(''),
                  )
                }
              />
            </label>
            <IconPicker
              icon={icon}
              color={iconColor}
              onChange={(next) => {
                setIcon(next.icon);
                setIconColor(next.color);
              }}
            />
            <div className="icon-picker">
              <ColorChoices
                labelId="group-tab-color"
                label={t('tab.color')}
                value={tabColor}
                emptyLabel={t('tab.color.none')}
                onChange={setTabColor}
              />
            </div>
          </div>
        </fieldset>
        {groupId && <p className="note">{t('group.deleteHint')}</p>}
        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={close}>
            {t('prompt.cancel')}
          </button>
          <button type="submit" className="btn primary">
            {t('host.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function descendants(groups: readonly Group[], groupId: string | null): Set<string> {
  const out = new Set<string>();
  if (!groupId) return out;
  out.add(groupId);
  let added = true;
  while (added) {
    added = false;
    for (const g of groups) {
      if (g.parentId !== null && out.has(g.parentId) && !out.has(g.id)) {
        out.add(g.id);
        added = true;
      }
    }
  }
  return out;
}
