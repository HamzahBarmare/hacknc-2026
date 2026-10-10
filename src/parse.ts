export const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

const TRIGGER = /^\s*summari[sz]e\b/i;
const DURATION = /(\d+)\s*(min(?:ute)?s?|h(?:ou)?rs?|d(?:ay)?s?)\b/i;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function isSummarizeCommand(text: string): boolean {
  return TRIGGER.test(text);
}

export function parseWindowMs(text: string): number | null {
  const match = DURATION.exec(text);
  if (!match) {
    return DEFAULT_WINDOW_MS;
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }

  const unit = match[2]!.toLowerCase();
  if (unit.startsWith("min")) {
    return amount * MINUTE;
  }
  if (unit.startsWith("h")) {
    return amount * HOUR;
  }
  return amount * DAY;
}

export function describeWindow(windowMs: number): string {
  if (windowMs % DAY === 0) {
    return `${windowMs / DAY} day${windowMs / DAY === 1 ? "" : "s"}`;
  }
  if (windowMs % HOUR === 0) {
    return `${windowMs / HOUR} hour${windowMs / HOUR === 1 ? "" : "s"}`;
  }
  return `${Math.round(windowMs / MINUTE)} minutes`;
}
