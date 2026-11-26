// 선 아이콘(DESIGN §6). 장식용이므로 aria-hidden, 이름은 버튼의 aria-label이 맡는다.
const PATHS = {
  servers: 'M4 5h16v5H4zM4 14h16v5H4zM7 7.5h.01M7 16.5h.01',
  tools: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  close: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14zM20 20l-4-4',
  up: 'M6 15l6-6 6 6',
  down: 'M6 9l6 6 6-6',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  chevron: 'M9 6l6 6-6 6',
  panel: 'M4 5h16v14H4zM14 5v14',
  left: 'M15 6l-6 6 6 6',
  server: 'M4 4h16v6H4zM4 14h16v6H4zM8 7h.01M8 17h.01',
  web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18',
  database:
    'M5 6c0-1.7 3.1-3 7-3s7 1.3 7 3-3.1 3-7 3-7-1.3-7-3zM5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3',
  container: 'M3 7l9-4 9 4-9 4-9-4zM3 7v10l9 4 9-4V7M12 11v10',
  router: 'M3 14h18v6H3zM7 17h.01M11 17h.01M8 10a6 6 0 0 1 8 0M5 7a10 10 0 0 1 14 0',
  cloud: 'M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z',
  terminal: 'M4 4h16v16H4zM8 9l3 3-3 3M13 15h3',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  laptop: 'M5 5h14v10H5zM3 19h18',
  cpu: 'M7 7h10v10H7zM10 10h4v4h-4zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4',
  storage: 'M4 5h16v4H4zM4 10h16v4H4zM4 15h16v4H4zM16 7h.01M16 12h.01M16 17h.01',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3M12 15v2',
  mail: 'M3 6h18v12H3zM3 7l9 6 9-6',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  branch:
    'M6 4v12M6 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 8c0 5-6 4-12 8',
  network: 'M10 3h4v4h-4zM3 17h4v4H3zM17 17h4v4h-4zM10 17h4v4h-4zM12 7v10M5 17v-4h14v4',
  chart: 'M4 4v16h16M8 16v-5M12 16V8M16 16v-3',
  flask: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 14h9',
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  key: 'M15 7a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM12.5 11.5L4 20M7 17l2 2M9 15l2 2',
  pin: 'M9 4h6l-1 6 3 3H7l3-3-1-6zM12 16v4',
  folder: 'M3 6h6l2 2h10v11H3z',
  folderOpen: 'M3 19V6h6l2 2h8v3M3 19l3-8h16l-3 8z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
