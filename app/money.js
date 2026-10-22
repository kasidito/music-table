// Amounts due and payment state for a booking. Mirrors public.booking_due() in the database.

export const tableIdsOf = (b) => [b.table_id, ...(b.extra_table_ids ?? [])];

export function dueOf(b, tableById, items = []) {
  const tables = tableIdsOf(b).reduce((n, id) => n + (tableById(id)?.price ?? 0), 0);
  const extras = items.reduce((n, i) => n + i.unit_price * i.qty, 0);
  return tables + extras;
}

export const paidOf = (payments = []) => payments.reduce((n, p) => n + p.amount, 0);

// none: nothing due and nothing paid · unpaid · partial (deposit) · paid
export function payState(due, paid) {
  if (paid > 0 && paid >= due) return 'paid';
  if (paid > 0) return 'partial';
  return due > 0 ? 'unpaid' : 'none';
}

export const baht = (n) => `${Number(n || 0).toLocaleString('en-US')}฿`;
