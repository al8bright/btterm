import { useId } from 'react';

/** btterm 로고(DESIGN §2.8, 작은 크기용 icon-small.svg와 같은 모양). 장식이라 읽지 않는다 */
export function AppLogo({ size }: { size: number }) {
  const gradient = `brand-${useId().replace(/:/g, '')}`;
  return (
    <svg
      className="brand-logo"
      width={size}
      height={size}
      viewBox="0 0 256 256"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" className="brand-tile-start" />
          <stop offset="1" className="brand-tile-end" />
        </linearGradient>
      </defs>
      <rect x="8" y="8" width="240" height="240" rx="56" fill={`url(#${gradient})`} />
      <g className="brand-glyph" strokeWidth="32" strokeLinecap="round" transform="translate(-4 4)">
        <path d="M60 54 V186" />
        <circle cx="88" cy="154" r="28" />
        <path d="M186 62 V192" />
        <path d="M162 104 H210" />
      </g>
    </svg>
  );
}
