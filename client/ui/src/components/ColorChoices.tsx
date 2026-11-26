import type { KeyboardEvent } from 'react';
import { t, type MessageKey } from '../i18n';
import { ICON_COLORS } from './ServerIcon';

interface Props {
  /** 라벨 요소 id(radiogroup의 aria-labelledby) */
  labelId: string;
  label: string;
  /** 팔레트 색 이름. 빈 값 = 기본(또는 그룹 값) */
  value: string;
  /** 빈 값 원의 이름 */
  emptyLabel: string;
  disabled?: boolean;
  onChange(color: string): void;
}

/** 팔레트 색 원 고르기(DESIGN §2.6). 방향키로 옮겨 다니고 Space·클릭으로 고른다. */
export function ColorChoices({ labelId, label, value, emptyLabel, disabled, onChange }: Props) {
  const colors = ['', ...ICON_COLORS];
  return (
    <>
      <span className="picker-label" id={labelId}>
        {label}
      </span>
      <div
        className="color-choices"
        role="radiogroup"
        aria-labelledby={labelId}
        onKeyDown={(e) => !disabled && moveChoice(e, colors, value, onChange)}
      >
        {colors.map((name) => (
          <button
            key={name || 'default'}
            type="button"
            role="radio"
            className="color-choice"
            aria-checked={name === value}
            aria-label={name ? t(`color.${name}` as MessageKey) : emptyLabel}
            title={name ? t(`color.${name}` as MessageKey) : emptyLabel}
            tabIndex={name === value ? 0 : -1}
            disabled={disabled}
            data-color={name || undefined}
            onClick={() => onChange(name)}
          />
        ))}
      </div>
    </>
  );
}

/** 방향키로 이전·다음 항목을 고르고 그 버튼으로 포커스를 옮긴다(라디오 그룹 관례) */
export function moveChoice(
  event: KeyboardEvent<HTMLElement>,
  values: string[],
  current: string,
  choose: (value: string) => void,
): void {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
  if (step === undefined) return;
  event.preventDefault();
  const index = (values.indexOf(current) + step + values.length) % values.length;
  const next = values[index] ?? '';
  choose(next);
  const buttons = event.currentTarget.querySelectorAll<HTMLElement>('[role=radio]');
  buttons[index]?.focus();
}
