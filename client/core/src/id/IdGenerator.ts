/** ID 생성 포트. 도메인 코드는 randomUUID 대신 이것만 쓴다(AGENTS.md §3). */
export interface IdGenerator {
  next(): string;
}
