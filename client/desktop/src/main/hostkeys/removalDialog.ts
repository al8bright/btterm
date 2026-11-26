import type { MessageBoxOptions } from 'electron';

/**
 * 알려진 호스트 삭제 확인(TR6 보안 리뷰 M-1). main이 띄우는 시스템 확인창이라 renderer가 건너뛸 수 없다.
 * 기본 버튼과 Esc는 "취소"(AGENTS §8 위험한 동작의 기본값).
 */
export function removalDialogOptions(entry: {
  hosts: string | null;
  keyType: string;
  fingerprint: string;
}): MessageBoxOptions {
  return {
    type: 'warning',
    title: '알려진 호스트',
    message: '이 호스트 키를 지울까요?',
    detail: [
      entry.hosts ?? '(해시된 이름)',
      `${entry.keyType} ${entry.fingerprint}`,
      '',
      '지우면 다음 연결 때 처음 보는 서버처럼 지문을 다시 확인합니다. 서버 관리자에게 새 지문을 확인한 뒤 연결하세요.',
    ].join('\n'),
    buttons: ['취소', '지우기'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
}
