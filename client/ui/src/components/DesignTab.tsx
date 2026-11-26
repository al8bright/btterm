import { useState } from 'react';
import { TERMINAL_THEME_IDS, UI_THEMES, type TerminalSettings } from '@btterm/core';
import { useAppState, useRegistry, useStore } from '../app/context';
import { t, type MessageKey } from '../i18n';
import { TERMINAL_THEMES } from '../terminal/themes';

const FONTS = [
  { label: 'D2Coding', stack: '"D2Coding", Consolas, monospace' },
  { label: 'Cascadia Mono', stack: '"Cascadia Mono", Consolas, monospace' },
  { label: 'JetBrains Mono', stack: '"JetBrains Mono", "D2Coding", monospace' },
  { label: 'Consolas', stack: 'Consolas, "D2Coding", monospace' },
];
const CURSORS = ['block', 'underline', 'bar'] as const;
const MIN_SIZE = 10;
const MAX_SIZE = 20;

// 테마 미리보기용 터미널 샘플(번역 대상 아님)
const SAMPLE_PROMPT = '$ ';
const SAMPLE_COMMAND = 'ls ';
const SAMPLE_PATH = '~/projects';

type Scope = 'tab' | 'all';

/**
 * 디자인 탭(F3.16): 앱 화면 모드(F5.3) + 터미널 테마·글꼴·크기·커서.
 * 터미널 설정의 적용 범위는 이 탭만 / 전체 기본값, 화면 모드는 앱 전체라 "터미널" 묶음 밖에 둔다.
 */
export function DesignTab() {
  const store = useStore();
  const registry = useRegistry();
  const activeId = useAppState((s) => s.activeId);
  const defaults = useAppState((s) => s.settings?.terminal);
  const uiTheme = useAppState((s) => s.settings?.ui.theme ?? 'system');
  const [scope, setScope] = useState<Scope>('all');
  const [, rerender] = useState(0);

  if (!defaults) return null;
  const tabScope = scope === 'tab' && activeId !== null;
  const current: TerminalSettings =
    (tabScope ? registry.effectiveSettings(activeId) : null) ?? defaults;

  const apply = (patch: Partial<TerminalSettings>) => {
    if (tabScope) {
      registry.overrideTab(activeId, patch);
      rerender((n) => n + 1);
    } else {
      void store.updateTerminalDefaults(patch);
    }
  };

  return (
    <div className="design">
      <div className="frow">
        <span>{t('design.uiTheme')}</span>
        <div className="seg" role="radiogroup" aria-label={t('design.uiTheme')}>
          {UI_THEMES.map((theme) => (
            <button
              key={theme}
              type="button"
              role="radio"
              aria-checked={uiTheme === theme}
              onClick={() => void store.setUiTheme(theme)}
            >
              {t(`design.uiTheme.${theme}`)}
            </button>
          ))}
        </div>
      </div>

      <section className="design-terminal" aria-labelledby="design-terminal-head">
        <h3 id="design-terminal-head" className="group-head">
          {t('design.terminal')}
        </h3>
        <fieldset className="scope">
          <legend>{t('design.scope')}</legend>
          {(['tab', 'all'] as const).map((value) => (
            <label key={value}>
              <input
                type="radio"
                name="design-scope"
                value={value}
                checked={scope === value}
                disabled={value === 'tab' && activeId === null}
                onChange={() => setScope(value)}
              />
              {t(value === 'tab' ? 'design.scope.tab' : 'design.scope.all')}
            </label>
          ))}
        </fieldset>
        {activeId === null && <p className="note">{t('design.noSession')}</p>}

        <h3 className="sechead">{t('design.theme')}</h3>
        <div className="themes" role="radiogroup" aria-label={t('design.theme')}>
          {TERMINAL_THEME_IDS.map((id) => {
            const theme = TERMINAL_THEMES[id];
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={current.themeId === id}
                className="theme"
                onClick={() => apply({ themeId: id })}
              >
                <span
                  className="swatch"
                  style={{ background: theme.background, color: theme.foreground }}
                  aria-hidden="true"
                >
                  <span style={{ color: theme.green }}>{SAMPLE_PROMPT}</span>
                  {SAMPLE_COMMAND}
                  <span style={{ color: theme.blue }}>{SAMPLE_PATH}</span>
                </span>
                {t(`theme.${id}` as MessageKey)}
              </button>
            );
          })}
        </div>

        <h3 className="sechead">{t('design.font')}</h3>
        <div className="fonts" role="radiogroup" aria-label={t('design.font')}>
          {FONTS.map((font) => (
            <button
              key={font.label}
              type="button"
              role="radio"
              aria-checked={current.fontFamily === font.stack}
              className="font"
              style={{ fontFamily: font.stack }}
              onClick={() => apply({ fontFamily: font.stack })}
            >
              <span>{font.label}</span>
              <span className="font-sample">{t('design.sample')}</span>
            </button>
          ))}
        </div>

        <div className="frow">
          <span>{t('design.size')}</span>
          <div className="stepper">
            <button
              type="button"
              aria-label={t('design.decrease')}
              disabled={current.fontSize <= MIN_SIZE}
              onClick={() => apply({ fontSize: current.fontSize - 1 })}
            >
              −
            </button>
            <output aria-live="polite">{current.fontSize}</output>
            <button
              type="button"
              aria-label={t('design.increase')}
              disabled={current.fontSize >= MAX_SIZE}
              onClick={() => apply({ fontSize: current.fontSize + 1 })}
            >
              +
            </button>
          </div>
        </div>

        <div className="frow">
          <span>{t('design.cursor')}</span>
          <div className="seg" role="radiogroup" aria-label={t('design.cursor')}>
            {CURSORS.map((cursor) => (
              <button
                key={cursor}
                type="button"
                role="radio"
                aria-checked={current.cursor === cursor}
                onClick={() => apply({ cursor })}
              >
                {t(`design.cursor.${cursor}`)}
              </button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
