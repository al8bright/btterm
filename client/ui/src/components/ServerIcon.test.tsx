import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ServerIcon } from './ServerIcon';

const tile = (icon: Parameters<typeof ServerIcon>[0]['icon']) =>
  render(<ServerIcon icon={icon} />).container.querySelector('.icon-tile')!;

describe('ServerIcon (F1.11)', () => {
  it('AC29 고른 아이콘과 팔레트 색을 토큰 이름으로 보여 준다', () => {
    const el = tile({ kind: 'builtin', name: 'cpu', color: 'red' });
    expect(el.getAttribute('data-icon')).toBe('cpu');
    expect(el.getAttribute('data-color')).toBe('red');
    expect(el.getAttribute('style')).toBeNull();
  });

  it('모르는 아이콘·색은 기본 모양으로 보이고, 색 값을 스타일에 넣지 않는다', () => {
    const el = tile({ kind: 'builtin', name: 'nope', color: 'url(javascript:alert(1))' });
    expect(el.getAttribute('data-icon')).toBe('server');
    expect(el.getAttribute('data-color')).toBeNull();
    expect(el.getAttribute('style')).toBeNull();
  });
});
