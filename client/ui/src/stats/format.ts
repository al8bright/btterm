import { t } from '../i18n';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

/** 1024 단위. 10 미만은 소수 한 자리, 이상은 정수(DESIGN §5.4c). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? Math.round(value).toString() : value.toFixed(1);
  return `${text} ${UNITS[unit]}`;
}

export function formatRate(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return t('stats.days', { d: days, h: hours });
  if (hours > 0) return t('stats.hours', { h: hours, m: minutes });
  return t('stats.minutes', { m: minutes });
}
