import { forwardRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { parseQuickTarget, type Profile } from '@btterm/core';
import { useAppState, useShortcut, useStore } from '../app/context';
import { t } from '../i18n';
import { quickMatches } from '../servers/serverTree';

const LIST_ID = 'quick-list';

/**
 * 빠른 연결(F1.3) 겸 서버 검색(F5.1, 결정 UX3). Ctrl+Shift+K·새 탭으로 포커스하면 저장된 서버 목록이 열린다.
 * 글자를 치면 퍼지 검색, ↑↓로 고르고 Enter로 접속. 맞는 서버가 없으면 user@host[:port]로 접속한다.
 */
/**
 * 고르지 않고 Enter를 눌렀을 때 접속할 서버(리뷰 1). 주소 일부·사용자명을 치다 누른 Enter가
 * 비슷한 다른 서버(예: 10.0.0.1 → 10.0.0.10)로 가지 않게, 이름·주소가 정확히 같거나
 * 이름에 그 글자가 들어간 서버가 하나뿐일 때만 고른다.
 */
function autoPick(matches: Profile[], value: string): number | null {
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const exact = matches.findIndex(
    (p) => p.name.toLowerCase() === text || p.host.toLowerCase() === text,
  );
  if (exact >= 0) return exact;
  const byName = matches.flatMap((p, i) => (p.name.toLowerCase().includes(text) ? [i] : []));
  return byName.length === 1 ? (byName[0] ?? null) : null;
}

export const QuickConnect = forwardRef<HTMLInputElement>(function QuickConnect(_props, ref) {
  const store = useStore();
  const view = useAppState((s) => s.profiles);
  const [value, setValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [open, setOpen] = useState(false);
  /** ↑↓·마우스로 고른 서버(id로 기억해 목록이 바뀌어도 엉뚱한 서버를 가리키지 않게) */
  const [pickedId, setPickedId] = useState<string | null>(null);

  const matches = open && view ? quickMatches(view, value) : [];
  const picked = matches.findIndex((p) => p.id === pickedId);
  const active = picked >= 0 ? picked : autoPick(matches, value);
  const chosen = active !== null ? matches[active] : undefined;
  const setPicked = (index: number | null) =>
    setPickedId(index === null ? null : (matches[index]?.id ?? null));

  const reset = () => {
    setValue('');
    setOpen(false);
    setPicked(null);
    setInvalid(false);
  };

  const connectProfile = (profile: Profile) => {
    reset();
    void store.openProfile(profile.id);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (chosen) {
      connectProfile(chosen);
      return;
    }
    const target = parseQuickTarget(value);
    if (!target) {
      // 오류 문구가 목록에 가리지 않게 닫는다
      setInvalid(true);
      setOpen(false);
      return;
    }
    reset();
    void store.openQuick(target.host, target.port, target.username);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' && open) {
      setOpen(false);
      setPicked(null);
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && matches.length > 0) {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const from = active ?? (step === 1 ? -1 : matches.length);
      setPicked((from + step + matches.length) % matches.length);
    } else if (event.key === 'ArrowDown' && !open) {
      setOpen(true);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  const expanded = matches.length > 0;
  return (
    <form className="quick" onSubmit={submit} role="search" aria-label={t('quick.label')}>
      <input
        ref={ref}
        name="target"
        role="combobox"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setInvalid(false);
          setOpen(true);
          setPicked(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setOpen(false);
          setPicked(null);
        }}
        onKeyDown={onKeyDown}
        placeholder={t('quick.placeholder')}
        aria-label={t('quick.label')}
        aria-expanded={expanded}
        aria-controls={expanded ? LIST_ID : undefined}
        aria-autocomplete="list"
        aria-activedescendant={chosen ? `quick-option-${chosen.id}` : undefined}
        aria-invalid={invalid}
        aria-describedby={invalid ? 'quick-error' : undefined}
        spellCheck={false}
        autoComplete="off"
      />
      <kbd className="kbd">{t('quick.hint', { key: useShortcut('quickConnect') })}</kbd>
      {expanded && (
        <ul
          id={LIST_ID}
          className="quick-list"
          role="listbox"
          aria-label={t('quick.list')}
          onMouseLeave={() => setPicked(null)}
        >
          {matches.map((profile, index) => (
            <li
              key={profile.id}
              id={`quick-option-${profile.id}`}
              role="option"
              aria-selected={index === active}
              className="quick-option"
              // 입력 칸의 blur보다 먼저 처리해 목록이 닫히기 전에 고른다
              onMouseDown={(e) => {
                e.preventDefault();
                connectProfile(profile);
              }}
              onMouseEnter={() => setPicked(index)}
            >
              <span className="quick-name">{profile.name}</span>
              <span className="quick-host">{profile.host}</span>
            </li>
          ))}
        </ul>
      )}
      {invalid && (
        <span id="quick-error" className="quick-error" role="alert">
          {t('quick.invalid')}
        </span>
      )}
    </form>
  );
});
