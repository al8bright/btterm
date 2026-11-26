import { t, type MessageKey } from '../i18n';
import { ColorChoices, moveChoice } from './ColorChoices';
import { Icon } from './Icon';
import { SERVER_ICONS } from './ServerIcon';

interface Props {
  /** 아이콘 이름. 빈 값 = 그룹 값 사용 */
  icon: string;
  /** 팔레트 색 이름. 빈 값 = 기본 색 */
  color: string;
  onChange(next: { icon: string; color: string }): void;
}

/**
 * 아이콘·색 고르기(F1.11, DESIGN §5.8): 그림 타일과 색 원. 방향키로 옮겨 다니고 Space·클릭으로 고른다.
 * 그룹 값을 쓰는 동안에는 색도 그룹 값을 따르므로 색 원을 막는다.
 */
export function IconPicker({ icon, color, onChange }: Props) {
  const icons = ['', ...SERVER_ICONS];
  const inherit = icon === '';
  return (
    <div className="icon-picker">
      <span className="picker-label" id="icon-picker-label">
        {t('host.icon')}
      </span>
      <div
        className="icon-choices"
        role="radiogroup"
        aria-labelledby="icon-picker-label"
        onKeyDown={(e) =>
          moveChoice(e, icons, icon, (next) => onChange({ icon: next, color: next ? color : '' }))
        }
      >
        {icons.map((name) => (
          <button
            key={name || 'inherit'}
            type="button"
            role="radio"
            className="icon-choice"
            aria-checked={name === icon}
            aria-label={name ? t(`icon.${name}` as MessageKey) : t('host.icon.inherit')}
            title={name ? t(`icon.${name}` as MessageKey) : t('host.icon.inherit')}
            tabIndex={name === icon ? 0 : -1}
            data-icon={name || undefined}
            data-color={name && color ? color : undefined}
            onClick={() => onChange({ icon: name, color: name ? color : '' })}
          >
            {name ? (
              <Icon name={name as (typeof SERVER_ICONS)[number]} size={18} />
            ) : (
              t('icon.inheritShort')
            )}
          </button>
        ))}
      </div>
      <ColorChoices
        labelId="icon-color-label"
        label={t('host.iconColor')}
        value={color}
        emptyLabel={t('color.default')}
        disabled={inherit}
        onChange={(next) => onChange({ icon, color: next })}
      />
    </div>
  );
}
