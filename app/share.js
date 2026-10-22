// Confirmation / reminder messages that staff forward to guests in LINE themselves.
import { baht } from './money.js';

export function fill(template, vars) {
  return String(template ?? '')
    .replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k] ?? '') : m))
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// due/paid in baht; lang only affects the payment line.
export function paymentLine(due, paid, lang = 'th') {
  if (!due) return '';
  const left = Math.max(0, due - paid);
  if (lang === 'en') return left === 0 ? `Paid in full ${baht(paid)}` : `Total ${baht(due)} · paid ${baht(paid)} · remaining ${baht(left)}`;
  return left === 0 ? `ชำระครบแล้ว ${baht(paid)}` : `ยอดรวม ${baht(due)} · ชำระแล้ว ${baht(paid)} · คงเหลือ ${baht(left)}`;
}

export const lineShareUrl = (text) => `https://line.me/R/share?text=${encodeURIComponent(text)}`;
