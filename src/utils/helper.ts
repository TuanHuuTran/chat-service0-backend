import { toZonedTime, format } from 'date-fns-tz';

export function toVietnamTime(date: Date | string): string {
  const timezone = 'Asia/Ho_Chi_Minh';
  const zonedDate = toZonedTime(date, timezone);
  return format(zonedDate, 'HH:mm', { timeZone: timezone });
}
