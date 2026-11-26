import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useRegistry, useStore } from '../app/context';
import { menuOpener } from './ContextMenu';

const FOCUSABLE =
  'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';

/** 열린 모달(위가 마지막). Esc·Tab은 맨 위 모달만 처리한다. */
const stack: HTMLElement[] = [];
/** 모달 때문에 inert로 만든 요소(원래 inert였던 요소는 건드리지 않는다) */
const inerted = new Set<HTMLElement>();

/** 모달이 하나라도 열려 있는가(앱 단축키를 막는 데 쓴다, 결정 UX5) */
export function isModalOpen(): boolean {
  return stack.length > 0;
}

interface Props {
  /** Esc로 닫을 때(취소·연결 취소 등 안전한 쪽) */
  onCancel(): void;
  children: ReactNode;
}

/**
 * 대화상자 공통 동작(결정 UX5): 열 때 포커스를 기억하고 닫으면 돌려준다(사라졌으면 활성 터미널).
 * Tab은 안에서만 돌고, 문서 어디서든 Esc = onCancel, 맨 위 모달 밖의 화면은 inert.
 */
export function Modal({ onCancel, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const store = useStore();
  const registry = useRegistry();
  const cancel = useRef(onCancel);
  cancel.current = onCancel;
  // 자식의 autoFocus가 먼저 포커스를 가져가므로 열기 전 포커스는 첫 렌더에서 기억한다.
  // 메뉴 항목에서 열었으면 곧 사라질 항목 대신 메뉴를 연 요소로 돌아간다.
  const [previous] = useState(() => {
    const active = document.activeElement as HTMLElement | null;
    return active?.closest('[role=menu]') ? menuOpener() : active;
  });

  useEffect(() => {
    const overlay = ref.current;
    if (!overlay) return;
    stack.push(overlay);
    applyInert();
    overlay.querySelector('[role=dialog], [role=alertdialog]')?.setAttribute('aria-modal', 'true');
    if (!overlay.contains(document.activeElement)) {
      overlay.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== overlay) return;
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        cancel.current();
      } else if (event.key === 'Tab') {
        trapTab(overlay, event);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    const stopDrag = makeDraggable(overlay);

    return () => {
      stopDrag();
      document.removeEventListener('keydown', onKeyDown, true);
      const wasTop = stack.at(-1) === overlay;
      stack.splice(stack.indexOf(overlay), 1);
      applyInert();
      // 아래 모달이 먼저 닫힌 경우 위 모달의 포커스를 빼앗지 않는다(리뷰 M1)
      if (!wasTop) return;
      if (previous?.isConnected && previous !== document.body) {
        previous.focus();
      } else if (stack.length === 0) {
        const active = store.getState().activeId;
        if (active) registry.focus(active);
      }
    };
  }, [store, registry, previous]);

  return (
    <div ref={ref} className="overlay">
      {children}
    </div>
  );
}

/**
 * 제목줄(h2)을 끌어 대화상자를 옮긴다. 창 전체가 화면 안에 남게 막고, 위치는 기억하지 않는다
 * (다시 열면 가운데). 등장 애니메이션의 transform과 겹치지 않게 translate 속성을 쓴다.
 */
function makeDraggable(overlay: HTMLElement): () => void {
  const dialog = overlay.querySelector<HTMLElement>('[role=dialog], [role=alertdialog]');
  const title = dialog?.querySelector<HTMLElement>('h2');
  if (!dialog || !title) return () => undefined;
  title.classList.add('drag-handle');
  let offset = { x: 0, y: 0 };
  let stopMove = () => undefined as void;

  const onMouseDown = (down: MouseEvent) => {
    if (down.button !== 0) return;
    down.preventDefault(); // 끄는 동안 글자 선택 막기
    const box = dialog.getBoundingClientRect();
    const start = { ...offset };
    // 지금 자리에서 화면 가장자리까지 갈 수 있는 거리
    const range = {
      minX: start.x - box.left,
      maxX: start.x + window.innerWidth - box.right,
      minY: start.y - box.top,
      maxY: start.y + window.innerHeight - box.bottom,
    };
    const clamp = (v: number, min: number, max: number) =>
      Math.min(Math.max(v, min), Math.max(min, max));
    const onMove = (move: MouseEvent) => {
      offset = {
        x: clamp(start.x + move.clientX - down.clientX, range.minX, range.maxX),
        y: clamp(start.y + move.clientY - down.clientY, range.minY, range.maxY),
      };
      dialog.style.translate = `${offset.x}px ${offset.y}px`;
    };
    stopMove = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', stopMove);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', stopMove);
  };

  title.addEventListener('mousedown', onMouseDown);
  return () => {
    stopMove();
    title.removeEventListener('mousedown', onMouseDown);
  };
}

function trapTab(overlay: HTMLElement, event: KeyboardEvent): void {
  const items = [...overlay.querySelectorAll<HTMLElement>(FOCUSABLE)];
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) return;
  const current = document.activeElement;
  if (event.shiftKey && (current === first || !overlay.contains(current))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (current === last || !overlay.contains(current))) {
    event.preventDefault();
    first.focus();
  }
}

/** 맨 위 모달을 담은 갈래를 뺀 앱의 나머지를 inert로. 스택이 바뀔 때마다 다시 계산한다(리뷰 M1). */
function applyInert(): void {
  const top = stack.at(-1);
  for (const element of inerted) element.inert = false;
  inerted.clear();
  const app = top?.closest('.app');
  if (!top || !app) return;
  for (const child of app.children) {
    if (!(child instanceof HTMLElement) || child.contains(top) || child.inert) continue;
    child.inert = true;
    inerted.add(child);
  }
}
