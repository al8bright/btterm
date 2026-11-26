import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface MenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  label: string;
  items: MenuItem[];
  onClose(): void;
}

/** 마지막으로 연 메뉴를 연 요소. 메뉴 항목이 연 대화상자가 닫힐 때 돌아갈 곳(리뷰 M2). */
let lastOpener: HTMLElement | null = null;

export function menuOpener(): HTMLElement | null {
  return lastOpener;
}

/**
 * 간단한 컨텍스트 메뉴(DESIGN §5.2): ↑↓·Home·End 이동, Enter 선택, Esc·Tab·바깥 클릭 닫기.
 * 닫히면 메뉴를 연 요소로 포커스를 돌려준다(결정 UX5). 화면 밖으로 넘치면 안쪽으로 당긴다.
 */
export function ContextMenu({ x, y, label, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [position, setPosition] = useState({ left: x, top: y });

  // 부모가 다시 그려져도 다시 돌지 않게 열릴 때 한 번만(리뷰 M3)
  useEffect(() => {
    const menu = ref.current;
    const opener = document.activeElement as HTMLElement | null;
    lastOpener = opener;
    menu?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const onPointer = (event: MouseEvent) => {
      if (!menu?.contains(event.target as Node)) close.current();
    };
    window.addEventListener('mousedown', onPointer);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      // 포커스가 메뉴에 남아 있었거나 갈 곳을 잃었을 때만 돌려준다(항목이 다른 곳으로 옮겼으면 그대로)
      const focus = document.activeElement;
      const lost = !focus || focus === document.body || menu?.contains(focus);
      if (lost && opener?.isConnected) opener.focus();
    };
  }, []);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const left = Math.max(0, Math.min(x, window.innerWidth - box.width));
    const top = Math.max(0, Math.min(y, window.innerHeight - box.height));
    if (left !== x || top !== y) setPosition({ left, top });
  }, [x, y]);

  const onKeyDown = (event: KeyboardEvent) => {
    const buttons = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    const go: Record<string, number> = {
      ArrowDown: (index + 1) % buttons.length,
      ArrowUp: (index - 1 + buttons.length) % buttons.length,
      Home: 0,
      End: buttons.length - 1,
    };
    if (event.key in go) buttons[go[event.key]!]?.focus();
    else if (event.key === 'Escape' || event.key === 'Tab') onClose();
    else return;
    event.preventDefault();
  };

  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      aria-label={label}
      style={position}
      onKeyDown={onKeyDown}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className={item.danger ? 'menuitem danger' : 'menuitem'}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
