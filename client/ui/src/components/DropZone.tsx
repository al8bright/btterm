import { useState, type DragEvent } from 'react';
import { useStore } from '../app/context';
import { allowedSpots, spotAt, spotsForSize, type DropSpot } from '../workspace/groupLayout';

/**
 * 탭을 끄는 동안 칸 터미널 위에 깔리는 놓기 영역(DESIGN §5.4b).
 * 가장자리 = 그 쪽에 새 칸(절반 미리보기), 가운데 = 그 칸으로 옮기기(칸 전체 미리보기).
 */
export function DropZone({ groupId }: { groupId: string }) {
  const store = useStore();
  const [spot, setSpot] = useState<DropSpot | null>(null);

  const pick = (event: DragEvent<HTMLDivElement>): DropSpot | null => {
    const { ui, layout } = store.getState();
    if (!ui.draggingTab) return null;
    const box = event.currentTarget.getBoundingClientRect();
    const spots = spotsForSize(allowedSpots(layout, groupId, ui.draggingTab), box);
    return spotAt(box, event.clientX, event.clientY, spots);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    const next = pick(event);
    if (next) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
    setSpot(next);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    const next = pick(event);
    setSpot(null);
    if (!next) return;
    event.preventDefault();
    store.dropTab(groupId, next);
  };

  return (
    <div
      className="drop-zone"
      aria-hidden="true"
      onDragOver={onDragOver}
      onDragLeave={() => setSpot(null)}
      onDrop={onDrop}
    >
      {spot && <div className="drop-preview" data-spot={spot} />}
    </div>
  );
}
