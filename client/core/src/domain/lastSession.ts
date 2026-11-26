import { z } from 'zod';

/** 복원할 탭(F6.9). 저장된 서버는 프로필 id, 빠른 연결은 주소만(비밀은 남기지 않는다, SEC-1) */
export const SavedTabSchema = z.union([
  z.object({ profileId: z.string().min(1).max(64) }),
  z.object({
    quick: z.object({
      host: z.string().min(1).max(255),
      port: z.number().int().min(1).max(65535),
      username: z.string().min(1).max(64),
    }),
  }),
]);
export type SavedTab = z.infer<typeof SavedTabSchema>;

export type SavedNode =
  | { kind: 'group'; tabs: SavedTab[] }
  | { kind: 'split'; axis: 'row' | 'column'; sizes?: number[] | undefined; children: SavedNode[] };

const MAX_GROUPS = 8;

const NodeSchema: z.ZodType<SavedNode> = z.lazy(() =>
  z.union([
    z.object({ kind: z.literal('group'), tabs: z.array(SavedTabSchema).min(1).max(50) }),
    z.object({
      kind: z.literal('split'),
      axis: z.enum(['row', 'column']),
      sizes: z.array(z.number().positive()).max(MAX_GROUPS).optional(),
      children: z.array(NodeSchema).min(2).max(MAX_GROUPS),
    }),
  ]),
);

/** 지난번 칸 배치와 탭(F6.9, 결정 DF8). 칸은 최대 8개 */
export const SavedNodeSchema = NodeSchema.refine((node) => countGroups(node) <= MAX_GROUPS, {
  message: 'too-many-groups',
});

function countGroups(node: SavedNode): number {
  return node.kind === 'group' ? 1 : node.children.reduce((n, c) => n + countGroups(c), 0);
}

export function countSavedTabs(node: SavedNode): number {
  return node.kind === 'group'
    ? node.tabs.length
    : node.children.reduce((n, c) => n + countSavedTabs(c), 0);
}
