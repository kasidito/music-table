// Amounts due and payment status for a booking. Mirrors public.booking_due() in the database.

export const tableIdsOf = (b) => [b.table_id, ...(b.extra_table_ids ?? [])].filter(Boolean);

// List price of every table on the booking.
export const listPriceOf = (b, tableById) => tableIdsOf(b).reduce((n, id) => n + (tableById(id)?.price ?? 0), 0);

// Table price after the agreed price (sold_price) or the category discount.
export function netPriceOf(b, tableById, category) {
  if (b.sold_price != null) return b.sold_price;
  return Math.trunc((listPriceOf(b, tableById) * (100 - (category?.discount_pct ?? 0))) / 100);
}

export function dueOf(b, tableById, items = [], category = null) {
  const extras = items.reduce((n, i) => n + i.unit_price * i.qty, 0);
  return netPriceOf(b, tableById, category) + extras;
}

export const paidOf = (payments = []) => payments.reduce((n, p) => n + p.amount, 0);

// Payment status chosen by staff (bookings.pay_status). Order = how a booking usually moves.
export const PAY_STATUSES = ['unpaid', 'waiting', 'deposit', 'paid', 'at_venue'];
export const isSettled = (st) => st === 'paid';
// Still to collect: anything but "paid" (pay-at-venue still owes money until it is marked paid).
export const stillOwes = (st) => st !== 'paid';

// Money actually received: a booking marked paid counts as its full amount even without payment rows.
export const receivedOf = (status, due, paidRecorded) => (status === 'paid' ? Math.max(due, paidRecorded) : paidRecorded);

export const baht = (n) => `${Number(n || 0).toLocaleString('en-US')}฿`;
