import { useEffect, useRef } from 'react';
import { useRegistry, useStore } from '../app/context';

interface Props {
  sessionId: string;
  /** 키 입력 대상(활성 칸의 선택 탭) */
  active: boolean;
  /** 칸에서 보이는 탭인지 */
  visible: boolean;
  /** 칸이 여러 개인지(칸 테두리 표시) */
  split: boolean;
}

/**
 * 세션 터미널의 자리. xterm은 TerminalRegistry가 소유하고 여기서는 붙였다 뗀다(DESIGN §11).
 * 숨긴 탭도 mount를 유지해 버퍼를 지키고, 칸을 옮기면 요소만 새 자리로 옮겨 붙는다.
 */
export function TerminalView({ sessionId, active, visible, split }: Props) {
  const registry = useRegistry();
  const store = useStore();
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    registry.mount(sessionId, host);
    // 화면은 다음 프레임에 바로 맞춘다(100ms 지연은 분할·패널 열기 때 글자가 잘렸다 튀어 보였다, UX 검토 U1).
    // 원격 크기 알림은 registry가 리사이즈가 멈춘 뒤 한 번만 보낸다(리뷰 M4).
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => registry.fitDeferred(sessionId));
    });
    observer.observe(host);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      registry.unmount(sessionId, host);
    };
  }, [registry, sessionId]);

  useEffect(() => {
    registry.setVisible(sessionId, visible);
  }, [registry, sessionId, visible]);

  useEffect(() => {
    if (active) registry.focus(sessionId);
  }, [registry, sessionId, active]);

  const activate = () => {
    if (!active) store.activate(sessionId);
  };

  // FitAddon은 부모 크기로 열·행을 계산한다. 여백은 host에 두고 xterm은 여백 없는 surface에 붙는다.
  return (
    <div
      ref={hostRef}
      id={`panel-${sessionId}`}
      role="tabpanel"
      className="terminal-host"
      data-active={active}
      data-visible={visible}
      data-split={split}
      onFocus={activate}
      onMouseDown={activate}
    />
  );
}
