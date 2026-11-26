import { z } from 'zod';

export const RectSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type Rect = z.infer<typeof RectSchema>;

/** 창 위치·크기(F6.7). bounds는 내용 영역(배율에서 바깥 크기는 반올림된다). main만 쓴다(결정 DF2) */
export const WindowStateSchema = z.object({
  bounds: RectSchema,
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof WindowStateSchema>;

/** DESIGN §4.1 최소 창 */
const MIN_WIDTH = 960;
const MIN_HEIGHT = 600;
/** 창을 잡아 옮길 수 있으려면 헤더(48) 띠가 화면과 이만큼은 겹쳐야 한다 */
const GRAB_WIDTH = 100;
const HEADER = 48;
/** 손상된 파일의 터무니없는 값은 버린다(OS 창 좌표 범위) */
const COORD_LIMIT = 32767;

/**
 * 저장된 창 위치를 지금 연결된 화면(작업 영역)에 맞춰 돌려준다.
 * 헤더를 잡을 수 없는 위치(모니터를 뗐거나 위로 벗어남)면 undefined = 기본 위치.
 */
export function restoreBounds(saved: Rect, workAreas: readonly Rect[]): Rect | undefined {
  const values = [saved.x, saved.y, saved.width, saved.height];
  if (values.some((v) => Math.abs(v) > COORD_LIMIT)) return undefined;
  const bounds = {
    ...saved,
    width: Math.max(saved.width, MIN_WIDTH),
    height: Math.max(saved.height, MIN_HEIGHT),
  };
  const grabbable = workAreas.some((area) => {
    const overlapX =
      Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
    const headerInside = bounds.y >= area.y && bounds.y + HEADER <= area.y + area.height;
    return overlapX >= GRAB_WIDTH && headerInside;
  });
  return grabbable ? bounds : undefined;
}
