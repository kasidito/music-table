// Concert sheet as an .xlsx file, laid out like the bar's own Excel sheet.
// ExcelJS is passed in (browser: vendor/exceljs.min.js loaded on demand; tests: the npm package).

const BLACK = 'FF000000', WHITE = 'FFFFFFFF', YELLOW = 'FFFFFF00', GREY = 'FFD9D9D9';
const thin = { style: 'thin', color: { argb: 'FF7F7F7F' } };
const border = { top: thin, left: thin, bottom: thin, right: thin };

// labels: { headers: [12 strings], floor: {1:'ล่าง',2:'บน'}, pay: {status: text}, none: 'N/A', yes: '✓', total: 'รวม' }
export async function concertWorkbook(ExcelJS, { title, rows, totals, labels, sheetName = 'Concert' }) {
  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName.slice(0, 31), { views: [{ state: 'frozen', ySplit: 2 }] });
  ws.columns = [6, 30, 10, 7, 11, 12, 15, 18, 22, 26, 16, 18].map((width) => ({ width }));

  ws.mergeCells(1, 1, 1, 12);
  const t = ws.getCell(1, 1);
  t.value = title;
  t.font = { bold: true, size: 14 };
  ws.getRow(1).height = 24;

  const head = ws.getRow(2);
  labels.headers.forEach((h, i) => {
    const c = head.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: WHITE } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLACK } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    c.border = border;
  });
  head.height = 22;

  rows.forEach((r, i) => {
    const row = ws.getRow(i + 3);
    const promo = r.category ? (r.discount ? `${r.category} ${r.discount}%` : r.category) : labels.none;
    const values = [
      r.no, [r.name, r.phone].filter(Boolean).join(' '), r.tables, labels.floor[r.floor] ?? r.floor, r.party,
      r.listPrice, r.netPrice, r.setDrinks, r.note, promo, labels.pay[r.payStatus] ?? r.payStatus, r.wristband ? labels.yes : '',
    ];
    values.forEach((v, k) => {
      const c = row.getCell(k + 1);
      c.value = v;
      c.border = border;
      c.alignment = { vertical: 'middle', horizontal: [0, 2, 3, 4, 11].includes(k) ? 'center' : k === 5 || k === 6 ? 'right' : 'left' };
      if (k === 5 || k === 6) c.numFmt = '#,##0.00';
    });
    if (r.payStatus !== 'paid') row.getCell(11).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: YELLOW } };
  });

  const sum = ws.getRow(rows.length + 3);
  sum.getCell(2).value = labels.total;
  sum.getCell(5).value = totals.people;
  sum.getCell(6).value = totals.listPrice;
  sum.getCell(7).value = totals.netPrice;
  sum.getCell(12).value = `${totals.wristbands}/${totals.bookings}`;
  for (let k = 1; k <= 12; k++) {
    const c = sum.getCell(k);
    c.font = { bold: true };
    c.border = border;
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } };
    if (k === 6 || k === 7) c.numFmt = '#,##0.00';
  }
  return wb.xlsx.writeBuffer();
}

// Load the ExcelJS browser build once, only when someone downloads a sheet.
let loading = null;
export function loadExcelJS(src = 'vendor/exceljs.min.js') {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  loading ??= new Promise((resolve, reject) => {
    const s = Object.assign(document.createElement('script'), { src, async: true });
    s.onload = () => resolve(window.ExcelJS);
    s.onerror = () => { loading = null; reject(new Error('excel_load_failed')); };
    document.head.append(s);
  });
  return loading;
}
