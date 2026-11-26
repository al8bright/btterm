import { useState, type FormEvent } from 'react';
import {
  groupChain,
  resolveEffectiveSettings,
  type HostDefaults,
  type IconRef,
  type Profile,
  type ProfilesView,
} from '@btterm/core';
import { useAppState, useStore } from '../app/context';
import { messageFor, t } from '../i18n';
import type { IdentityInput } from '../store/AppStore';
import { ColorChoices } from './ColorChoices';
import { IconPicker } from './IconPicker';
import { Modal } from './Modal';

const APP_DEFAULTS = { port: 22, keepaliveSec: 30 };
const NEW_IDENTITY = '__new__';
const EDITED = new Set([
  'port',
  'keepaliveSec',
  'username',
  'icon',
  'identityId',
  'serverStats',
  'tabColor',
  'startupCommand',
]);

type AuthChoice = 'password' | 'ask' | 'key' | 'agent';

/**
 * 서버 편집(F1.1, F1.1b, F1.11). 그룹에서 물려받는 값은 흐리게 보여 주고 입력하면 재정의한다.
 * 자주 쓰는 호스트·사용자명·인증을 먼저 묻고, 나머지는 "고급 설정"에 접어 둔다(UX 검토 U3).
 */
export function HostEditDialog({
  profileId,
  groupId: initialGroupId,
}: {
  profileId: string | null;
  groupId?: string | null | undefined;
}) {
  const store = useStore();
  const view = useAppState((s) => s.profiles);
  const existing = view?.profiles.find((p) => p.id === profileId);
  const [name, setName] = useState(existing?.name ?? '');
  const [host, setHost] = useState(existing?.host ?? '');
  const [groupId, setGroupId] = useState<string | null>(
    existing?.groupId ?? initialGroupId ?? null,
  );
  const [port, setPort] = useState(numberText(existing?.overrides.port));
  const [keepalive, setKeepalive] = useState(numberText(existing?.overrides.keepaliveSec));
  const [username, setUsername] = useState(existing?.overrides.username ?? '');
  const [icon, setIcon] = useState(iconName(existing?.overrides.icon));
  const [iconColor, setIconColor] = useState(iconColorOf(existing?.overrides.icon));
  const [tabColor, setTabColor] = useState(existing?.overrides.tabColor ?? '');
  const [startupCommand, setStartupCommand] = useState(existing?.overrides.startupCommand ?? '');
  const [tags, setTags] = useState(existing?.tags.join(', ') ?? '');
  const [serverStats, setServerStats] = useState(statsChoice(existing?.overrides.serverStats));
  // 새 서버이고 그룹에서 받을 접속 계정이 없으면 비밀번호 칸을 바로 보여 준다.
  // 사용자가 직접 고르기 전까지는 그룹을 바꿀 때마다 다시 정한다(리뷰 2).
  const defaultIdentity = (group: string | null) =>
    existing?.overrides.identityId ??
    (existing || !view || inheritedValues(view, group).identity ? '' : NEW_IDENTITY);
  const [identityChoice, setIdentityChoice] = useState(() => defaultIdentity(groupId));
  const [identityTouched, setIdentityTouched] = useState(false);
  const [auth, setAuth] = useState<AuthChoice>('password');
  const [password, setPassword] = useState('');
  const [keyId, setKeyId] = useState(view?.keys[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!view) return null;
  const close = () => store.closeDialog();

  // 이 화면에서 다루지 않는 재정의(탭 색·글꼴 등)는 그대로 둔다.
  const kept = Object.fromEntries(
    Object.entries(existing?.overrides ?? {}).filter(([key]) => !EDITED.has(key)),
  );
  const overrides: HostDefaults = {
    ...kept,
    ...(port ? { port: Number(port) } : {}),
    ...(keepalive ? { keepaliveSec: Number(keepalive) } : {}),
    ...(username ? { username } : {}),
    ...(icon
      ? { icon: { kind: 'builtin', name: icon, ...(iconColor ? { color: iconColor } : {}) } }
      : {}),
    ...(serverStats ? { serverStats: serverStats === 'on' } : {}),
    ...(tabColor ? { tabColor } : {}),
    ...(startupCommand.trim() ? { startupCommand: startupCommand.trim() } : {}),
  };
  const inherited = inheritedValues(view, groupId);

  const submit = async (event: FormEvent, connect: boolean) => {
    event.preventDefault();
    if (!host.trim()) {
      setError(t('host.required'));
      return;
    }
    if (identityChoice === NEW_IDENTITY && !identityUser()) {
      setError(t('host.userRequired'));
      return;
    }
    const result = await store.saveHost({
      profileId,
      name: name.trim() || host.trim(),
      host: host.trim(),
      groupId,
      overrides,
      tags: tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      identity: identityInput(),
    });
    if (!result.ok) {
      setError(t(messageFor('error', result.error, 'error.save-failed')));
      return;
    }
    close();
    if (connect && result.id) void store.openProfile(result.id);
  };

  const identityUser = () => username.trim() || inherited.username?.value || '';

  const identityInput = (): IdentityInput => {
    if (identityChoice === '') return { mode: 'none' };
    if (identityChoice !== NEW_IDENTITY) return { mode: 'existing', identityId: identityChoice };
    const user = identityUser();
    const label = `${user}@${host.trim()}`;
    if (auth === 'password') {
      return { mode: 'new', label, username: user, auth: { kind: 'password', password } };
    }
    if (auth === 'key') return { mode: 'new', label, username: user, auth: { kind: 'key', keyId } };
    if (auth === 'agent') return { mode: 'new', label, username: user, auth: { kind: 'agent' } };
    return { mode: 'new', label, username: user, auth: { kind: 'none' } };
  };

  return (
    <Modal onCancel={close}>
      <form
        className="dialog wide"
        role="dialog"
        aria-labelledby="host-title"
        onSubmit={(e) => void submit(e, false)}
      >
        <h2 id="host-title">{t(profileId ? 'host.titleEdit' : 'host.titleNew')}</h2>
        <div className="form-grid">
          <label>
            {t('host.host')}
            <input
              name="host"
              autoFocus
              value={host}
              onChange={(e) => setHost(e.target.value)}
              spellCheck={false}
            />
          </label>
          <InheritedField
            label={t('host.username')}
            name="username"
            value={username}
            onChange={setUsername}
            inherited={inherited.username}
          />
        </div>

        <fieldset className="identity">
          <legend>{t('host.identity')}</legend>
          <select
            name="identity"
            aria-label={t('host.identity')}
            value={identityChoice}
            onChange={(e) => {
              setIdentityChoice(e.target.value);
              setIdentityTouched(true);
            }}
          >
            <option value="">
              {inherited.identity ? t('host.identity.inherit') : t('host.identity.none')}
            </option>
            {view.identities.map((identity) => (
              <option key={identity.id} value={identity.id}>
                {identity.label} · {identity.username}
              </option>
            ))}
            <option value={NEW_IDENTITY}>{t('host.identity.new')}</option>
          </select>
          {identityChoice === '' && inherited.identity && (
            <p className="note">{t('host.inherited', inherited.identity)}</p>
          )}
          {identityChoice === NEW_IDENTITY && (
            <div className="form-grid">
              <label>
                {t('host.auth')}
                <select
                  name="auth"
                  value={auth}
                  onChange={(e) => setAuth(e.target.value as AuthChoice)}
                >
                  <option value="password">{t('host.auth.password')}</option>
                  <option value="ask">{t('host.auth.ask')}</option>
                  <option value="key">{t('host.auth.key')}</option>
                  <option value="agent">{t('host.auth.agent')}</option>
                </select>
              </label>
              {auth === 'password' && (
                <label>
                  {t('host.password')}
                  <input
                    name="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              )}
              {auth === 'key' &&
                (view.keys.length === 0 ? (
                  <p className="note">{t('host.auth.noKeys')}</p>
                ) : (
                  <label>
                    {t('host.auth.key')}
                    <select name="key" value={keyId} onChange={(e) => setKeyId(e.target.value)}>
                      {view.keys.map((key) => (
                        <option key={key.id} value={key.id}>
                          {key.label} · {key.keyType}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
            </div>
          )}
        </fieldset>

        <div className="form-grid">
          <label>
            {t('host.name')}
            <input
              name="name"
              value={name}
              placeholder={t('host.namePlaceholder')}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            {t('host.group')}
            <select
              name="group"
              value={groupId ?? ''}
              onChange={(e) => {
                const next = e.target.value || null;
                setGroupId(next);
                if (!identityTouched) setIdentityChoice(defaultIdentity(next));
              }}
            >
              <option value="">{t('host.noGroup')}</option>
              {view.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>

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
            labelId="host-tab-color"
            label={t('tab.color')}
            value={tabColor}
            emptyLabel={t('tab.color.inherit')}
            onChange={setTabColor}
          />
        </div>

        <details className="advanced" open={hasAdvanced(existing)}>
          <summary>{t('host.advanced')}</summary>
          <div className="form-grid">
            <InheritedField
              label={t('host.port')}
              name="port"
              value={port}
              onChange={setPort}
              inherited={inherited.port}
              numeric
            />
            <InheritedField
              label={t('host.keepalive')}
              name="keepalive"
              value={keepalive}
              onChange={setKeepalive}
              inherited={inherited.keepaliveSec}
              numeric
            />
            <InheritedField
              label={t('host.startupCommand')}
              name="startupCommand"
              value={startupCommand}
              onChange={(value) => setStartupCommand(singleLine(value))}
              inherited={inherited.startupCommand}
              mono
              hint={t('host.startupCommand.hint')}
            />
            <label>
              {t('host.tags')}
              <input name="tags" value={tags} onChange={(e) => setTags(e.target.value)} />
            </label>
            <label>
              {t('host.serverStats')}
              <select
                name="serverStats"
                value={serverStats}
                onChange={(e) => setServerStats(e.target.value as StatsChoice)}
              >
                <option value="">{t('host.serverStats.auto')}</option>
                <option value="on">{t('host.serverStats.on')}</option>
                <option value="off">{t('host.serverStats.off')}</option>
              </select>
            </label>
          </div>
        </details>

        {error && (
          <p className="warn" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button type="button" className="btn" onClick={close}>
            {t('prompt.cancel')}
          </button>
          <button type="submit" className="btn">
            {t('host.save')}
          </button>
          <button type="button" className="btn primary" onClick={(e) => void submit(e, true)}>
            {t('host.saveConnect')}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function InheritedField({
  label,
  name,
  value,
  onChange,
  inherited,
  numeric = false,
  mono = false,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange(value: string): void;
  inherited: { source: string; value: string } | undefined;
  numeric?: boolean;
  mono?: boolean;
  hint?: string;
}) {
  return (
    <label>
      {label}
      <input
        name={name}
        value={value}
        inputMode={numeric ? 'numeric' : undefined}
        className={mono ? 'mono' : undefined}
        spellCheck={mono ? false : undefined}
        placeholder={inherited?.value ?? ''}
        onChange={(e) => onChange(numeric ? e.target.value.replace(/\D/g, '') : e.target.value)}
      />
      {!value && inherited && <span className="inherited">{t('host.inherited', inherited)}</span>}
      {hint && <span className="inherited">{hint}</span>}
    </label>
  );
}

type InheritedKey = 'port' | 'username' | 'keepaliveSec' | 'identity' | 'startupCommand';

/** 연결 직후 명령은 한 줄: 붙여넣은 줄바꿈·제어 문자를 지운다(F6.11) */
function singleLine(text: string): string {
  return [...text].filter((ch) => ch.charCodeAt(0) >= 0x20 && ch.charCodeAt(0) !== 0x7f).join('');
}

// 타입 별칭이어야 t()의 변수 레코드로 넘길 수 있다.
type InheritedValue = {
  source: string;
  value: string;
};

/** 그룹·앱 기본값에서 물려받는 값과 출처(DESIGN §5.8 "상속됨: Prod") */
function inheritedValues(
  view: ProfilesView,
  groupId: string | null,
): Partial<Record<InheritedKey, InheritedValue>> {
  const probe = {
    id: '',
    groupId,
    name: '',
    host: '',
    overrides: {},
    tags: [],
    updatedAt: 0,
  };
  const { values, sources } = resolveEffectiveSettings(
    probe,
    groupChain(groupId, view.groups),
    APP_DEFAULTS,
  );
  const sourceName = (source: string | undefined) =>
    source === 'app' || source === undefined
      ? t('host.source.app')
      : (view.groups.find((g) => g.id === source)?.name ?? source);
  const out: Partial<Record<InheritedKey, InheritedValue>> = {
    port: { source: sourceName(sources.port), value: String(values.port) },
    keepaliveSec: { source: sourceName(sources.keepaliveSec), value: String(values.keepaliveSec) },
  };
  if (values.username) {
    out.username = { source: sourceName(sources.username), value: values.username };
  }
  if (values.startupCommand) {
    out.startupCommand = {
      source: sourceName(sources.startupCommand),
      value: values.startupCommand,
    };
  }
  const identity = view.identities.find((i) => i.id === values.identityId);
  if (identity) out.identity = { source: sourceName(sources.identityId), value: identity.label };
  return out;
}

/** 고급 칸에 값이 있으면 펼쳐서 연다 */
function hasAdvanced(profile: Profile | undefined): boolean {
  if (!profile) return false;
  const o = profile.overrides;
  return (
    o.port !== undefined ||
    o.keepaliveSec !== undefined ||
    o.startupCommand !== undefined ||
    o.serverStats !== undefined ||
    profile.tags.length > 0
  );
}

type StatsChoice = '' | 'on' | 'off';

/** 서버 상태 줄 선택(F3.18, ST10). 빈 값 = 자동(그룹 값, 없으면 production 태그면 끔) */
function statsChoice(value: boolean | undefined): StatsChoice {
  return value === undefined ? '' : value ? 'on' : 'off';
}

function numberText(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

function iconName(icon: IconRef | undefined): string {
  return icon?.kind === 'builtin' ? icon.name : '';
}

function iconColorOf(icon: IconRef | undefined): string {
  return icon?.kind === 'builtin' ? (icon.color ?? '') : '';
}
