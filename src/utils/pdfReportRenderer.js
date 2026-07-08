const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT_MARGIN = 40;
const TOP_MARGIN = 42;
const BOTTOM_MARGIN = 56;
const CONTENT_WIDTH = PAGE_WIDTH - LEFT_MARGIN * 2;
const LINE_HEIGHT = 15;
const MAX_LINE_CHARS = 92;

const COLORS = {
  purple: [0.541, 0.239, 1],
  purpleSoft: [0.965, 0.94, 1],
  yellow: [1, 0.804, 0.161],
  yellowSoft: [1, 0.976, 0.894],
  cyan: [0.22, 0.976, 0.961],
  cyanSoft: [0.9, 1, 0.996],
  red: [1, 0.42, 0.42],
  redSoft: [1, 0.93, 0.945],
  text: [0.184, 0.145, 0.188],
  muted: [0.42, 0.38, 0.46],
  line: [0.86, 0.83, 0.9],
  page: [0.985, 0.982, 0.99],
  white: [1, 1, 1]
};

const color = (rgb) => rgb.join(' ');

const escapePdfText = (value) => {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/[\r\n]+/g, ' ');
};

const normalizeText = (value) => String(value ?? '—').replace(/\s+/g, ' ').trim() || '—';

const wrapText = (value, maxChars = MAX_LINE_CHARS) => {
  const words = normalizeText(value).split(' ');
  const lines = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }

    if (`${current} ${word}`.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`;
    }
  }

  if (current) lines.push(current);
  return lines.length > 0 ? lines : ['—'];
};

const makeTextLine = (text, x, y, size = 10, rgb = COLORS.text) => {
  return `BT /F1 ${size} Tf ${color(rgb)} rg ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
};

const makeRect = (x, y, width, height, fill = COLORS.white, stroke = COLORS.line, strokeWidth = 0.6) => {
  return `q ${color(fill)} rg ${x} ${y} ${width} ${height} re f Q\nq ${strokeWidth} w ${color(stroke)} RG ${x} ${y} ${width} ${height} re S Q`;
};

const makeFillRect = (x, y, width, height, fill) => `q ${color(fill)} rg ${x} ${y} ${width} ${height} re f Q`;

const currentPage = (pages) => pages[pages.length - 1];

const createPage = () => ({
  lines: [makeFillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT, COLORS.page)],
  cursorY: PAGE_HEIGHT - TOP_MARGIN
});

const ensurePageSpace = (pages, requiredHeight = LINE_HEIGHT) => {
  if (currentPage(pages).cursorY - requiredHeight < BOTTOM_MARGIN) {
    pages.push(createPage());
  }
};

const addText = (pages, text, x, y, options = {}) => {
  currentPage(pages).lines.push(makeTextLine(text, x, y, options.size || 10, options.color || COLORS.text));
};

const addWrappedText = (pages, text, x, y, options = {}) => {
  const lineHeight = options.lineHeight || LINE_HEIGHT;
  const lines = wrapText(text, options.maxChars || MAX_LINE_CHARS);
  lines.forEach((line, index) => {
    addText(pages, line, x, y - index * lineHeight, options);
  });
  return y - lines.length * lineHeight;
};

const addCard = (pages, x, y, width, height, options = {}) => {
  currentPage(pages).lines.push(
    makeRect(x, y, width, height, options.fill || COLORS.white, options.stroke || COLORS.line, options.strokeWidth || 0.6)
  );
};

const addBadge = (pages, x, y, label, options = {}) => {
  const width = options.width || 86;
  const height = options.height || 22;
  addCard(pages, x, y, width, height, {
    fill: options.fill || COLORS.purpleSoft,
    stroke: options.stroke || COLORS.purple,
    strokeWidth: 0.7
  });
  addText(pages, label, x + 12, y + 7, { size: options.size || 9, color: options.color || COLORS.purple });
};

const addSectionTitle = (pages, title) => {
  ensurePageSpace(pages, 28);
  const page = currentPage(pages);
  addText(pages, title, LEFT_MARGIN, page.cursorY, { size: 13, color: COLORS.text });
  page.cursorY -= 24;
};

const formatDateLabel = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toISOString().slice(0, 10);
};

const formatDistributionRows = (distribution = {}) => {
  return Object.entries(distribution)
    .filter(([, item]) => item && (item.included !== false || item.count > 0))
    .map(([key, item]) => {
      const percentage = item.percentage == null ? 'N/A' : `${item.percentage}%`;
      const note = item.note ? ` — ${item.note}` : '';
      return {
        key,
        label: item.label || key,
        count: item.count ?? 0,
        percentage,
        note
      };
    });
};

const addHeader = (pages, payload) => {
  const page = currentPage(pages);
  const cardX = LEFT_MARGIN;
  const cardY = PAGE_HEIGHT - 248;
  const cardW = CONTENT_WIDTH;
  const cardH = 200;

  addCard(pages, cardX, cardY, cardW, cardH, { fill: COLORS.white, stroke: COLORS.line, strokeWidth: 0.8 });
  currentPage(pages).lines.push(makeFillRect(cardX, cardY + cardH - 48, cardW, 48, COLORS.purpleSoft));

  addText(pages, '⬢ INFINITE', cardX + 24, cardY + cardH - 31, { size: 15, color: COLORS.text });
  addText(pages, 'TRACK', cardX + 100, cardY + cardH - 31, { size: 15, color: COLORS.purple });
  addText(pages, 'Personal Attendance Report', cardX + 24, cardY + cardH - 72, { size: 16, color: COLORS.text });
  addBadge(pages, cardX + cardW - 116, cardY + cardH - 38, 'PDF Ready', { width: 88 });
  addText(pages, 'Personal report', cardX + cardW - 112, cardY + cardH - 65, { size: 9, color: COLORS.muted });

  addCard(pages, cardX + 24, cardY + 82, 56, 56, { fill: COLORS.purpleSoft, stroke: COLORS.purpleSoft, strokeWidth: 0.1 });
  addText(pages, '●', cardX + 44, cardY + 115, { size: 20, color: COLORS.purple });
  addText(pages, '●', cardX + 38, cardY + 94, { size: 28, color: COLORS.purple });

  addText(pages, payload.user.full_name || 'User name unavailable', cardX + 96, cardY + 122, { size: 13, color: COLORS.text });
  addText(
    pages,
    [payload.user.nip_nim, payload.user.role].filter(Boolean).join(' • ') || 'NIP/NIM or role unavailable',
    cardX + 96,
    cardY + 103,
    { size: 10, color: COLORS.muted }
  );
  addText(
    pages,
    [payload.user.position, payload.user.division].filter(Boolean).join(' • ') || 'Position or division unavailable',
    cardX + 96,
    cardY + 86,
    { size: 9, color: COLORS.muted }
  );

  const metaY = cardY + 38;
  addText(pages, 'Period', cardX + 28, metaY + 24, { size: 8, color: COLORS.muted });
  addText(pages, payload.period.display_label, cardX + 28, metaY + 10, { size: 10, color: COLORS.text });
  addText(pages, 'Generated on', cardX + 28, metaY - 12, { size: 8, color: COLORS.muted });
  addText(pages, formatDateLabel(payload.report_metadata.generated_at), cardX + 28, metaY - 26, { size: 10, color: COLORS.text });

  addText(pages, 'Generated by', cardX + 285, metaY + 24, { size: 8, color: COLORS.muted });
  addText(pages, payload.report_metadata.generated_by || 'Infinite Track Backend', cardX + 285, metaY + 10, {
    size: 10,
    color: COLORS.text
  });
  addText(pages, 'Data source', cardX + 285, metaY - 12, { size: 8, color: COLORS.muted });
  addText(pages, 'Backend attendance records', cardX + 285, metaY - 26, { size: 10, color: COLORS.text });

  page.cursorY = cardY - 28;
};

const addMetricCard = (pages, x, y, width, label, value, helper, palette) => {
  addCard(pages, x, y, width, 70, { fill: palette.fill, stroke: palette.stroke, strokeWidth: 0.8 });
  addText(pages, label, x + 16, y + 48, { size: 9, color: COLORS.text });
  addText(pages, value ?? '—', x + 16, y + 27, { size: 18, color: COLORS.text });
  if (helper) addWrappedText(pages, helper, x + 16, y + 13, { size: 8, color: COLORS.muted, lineHeight: 10, maxChars: 24 });
};

const addSummary = (pages, summary) => {
  addSectionTitle(pages, 'Report Summary');
  const page = currentPage(pages);
  const gap = 10;
  const cardW = (CONTENT_WIDTH - gap * 2) / 3;
  const y1 = page.cursorY - 70;
  const y2 = y1 - 82;
  const x1 = LEFT_MARGIN;
  const x2 = LEFT_MARGIN + cardW + gap;
  const x3 = LEFT_MARGIN + (cardW + gap) * 2;

  addMetricCard(pages, x1, y1, cardW, 'Attendance Rate', summary.attendance_rate_label, 'Overall attendance', {
    fill: COLORS.cyanSoft,
    stroke: COLORS.cyan
  });
  addMetricCard(pages, x2, y1, cardW, 'On Time Days', `${summary.on_time_days ?? 0} days`, 'On-time check-in', {
    fill: COLORS.cyanSoft,
    stroke: COLORS.cyan
  });
  addMetricCard(pages, x3, y1, cardW, 'Late Days', `${summary.late_days ?? summary.late ?? 0} days`, 'Late check-in', {
    fill: COLORS.yellowSoft,
    stroke: COLORS.yellow
  });
  addMetricCard(pages, x1, y2, cardW, 'Alpha Days', `${summary.alpha_days ?? summary.alpha ?? 0} days`, 'No valid attendance', {
    fill: COLORS.redSoft,
    stroke: COLORS.red
  });
  addMetricCard(pages, x2, y2, cardW, 'Counted Days', `${summary.total_counted_days ?? 0} days`, 'Present + alpha days', {
    fill: COLORS.purpleSoft,
    stroke: COLORS.purple
  });
  addMetricCard(pages, x3, y2, cardW, 'Total Work Hours', summary.total_work_hours_label || `${summary.total_work_hours ?? 0}h`, 'Productive work hours', {
    fill: COLORS.cyanSoft,
    stroke: COLORS.cyan
  });

  page.cursorY = y2 - 30;
};

const addDistributionCard = (pages, x, y, width, height, title, rows) => {
  addCard(pages, x, y, width, height, { fill: COLORS.white, stroke: COLORS.line, strokeWidth: 0.8 });
  addText(pages, title, x + 18, y + height - 24, { size: 11, color: COLORS.text });
  rows.slice(0, 5).forEach((row, index) => {
    const rowY = y + height - 48 - index * 18;
    addText(pages, '●', x + 18, rowY, { size: 10, color: index === 0 ? COLORS.cyan : index === 1 ? COLORS.yellow : COLORS.red });
    addText(pages, `${row.label}`, x + 34, rowY, { size: 9, color: COLORS.muted });
    addText(pages, `${row.count} (${row.percentage})`, x + width - 82, rowY, { size: 9, color: COLORS.text });
    if (row.note) addWrappedText(pages, row.note.replace(/^ — /, ''), x + 34, rowY - 11, { size: 7, color: COLORS.muted, maxChars: 34 });
  });
};

const addDistributions = (pages, payload) => {
  addSectionTitle(pages, 'Your Statistics');
  const page = currentPage(pages);
  const gap = 12;
  const cardW = (CONTENT_WIDTH - gap) / 2;
  const cardH = 112;
  const y = page.cursorY - cardH;

  addDistributionCard(pages, LEFT_MARGIN, y, cardW, cardH, 'Attendance Status Distribution', formatDistributionRows(payload.status_distribution));
  addDistributionCard(
    pages,
    LEFT_MARGIN + cardW + gap,
    y,
    cardW,
    cardH,
    'Work Mode Distribution',
    formatDistributionRows(payload.mode_distribution)
  );

  page.cursorY = y - 30;
};

const addTimeline = (pages, payload) => {
  addSectionTitle(pages, 'Monthly Attendance History');
  const page = currentPage(pages);
  addText(pages, 'Date | Check In | Check Out | Work Hours | Status | Mode | Location', LEFT_MARGIN + 12, page.cursorY, {
    size: 9,
    color: COLORS.muted
  });
  page.cursorY -= 12;

  if (payload.empty_state.is_empty) {
    addCard(pages, LEFT_MARGIN, page.cursorY - 34, CONTENT_WIDTH, 44, { fill: COLORS.white, stroke: COLORS.line });
    addText(pages, payload.empty_state.message, LEFT_MARGIN + 14, page.cursorY - 13, { size: 10, color: COLORS.muted });
    page.cursorY -= 56;
    return;
  }

  payload.timeline.forEach((row) => {
    ensurePageSpace(pages, 48);
    const rowPage = currentPage(pages);
    const y = rowPage.cursorY - 38;
    addCard(pages, LEFT_MARGIN, y, CONTENT_WIDTH, 42, { fill: COLORS.white, stroke: COLORS.line });
    addText(pages, row.attendance_date, LEFT_MARGIN + 12, y + 25, { size: 9, color: COLORS.text });
    addText(pages, row.time_in || '--:--', LEFT_MARGIN + 92, y + 25, { size: 10, color: COLORS.text });
    addText(pages, row.time_out || '--:--', LEFT_MARGIN + 160, y + 25, { size: 10, color: COLORS.text });
    addText(pages, row.work_hour || '—', LEFT_MARGIN + 230, y + 25, { size: 10, color: COLORS.text });
    addText(pages, row.status_label || '—', LEFT_MARGIN + 310, y + 25, {
      size: 9,
      color: row.status_key === 'late' ? COLORS.yellow : row.status_key === 'alpha' ? COLORS.red : COLORS.cyan
    });
    addText(pages, row.mode_label || '—', LEFT_MARGIN + 390, y + 25, { size: 9, color: COLORS.purple });
    addWrappedText(pages, row.location_label || 'Location unavailable', LEFT_MARGIN + 445, y + 25, {
      size: 8,
      color: COLORS.muted,
      maxChars: 18,
      lineHeight: 9
    });
    rowPage.cursorY = y - 8;
  });
};

const addFooters = (pages, payload) => {
  pages.forEach((page, index) => {
    page.lines.push(makeTextLine('Generated by Infinite Track', LEFT_MARGIN, 34, 8, COLORS.muted));
    page.lines.push(makeTextLine(`Generated timestamp: ${payload.report_metadata.generated_at}`, LEFT_MARGIN, 23, 8, COLORS.muted));
    page.lines.push(makeTextLine(`Page ${index + 1} of ${pages.length}`, PAGE_WIDTH - 105, 23, 8, COLORS.muted));
  });
};

const buildPdfObjects = (pages) => {
  const objects = [];
  const fontObjectId = 3 + pages.length * 2;
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');

  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);

  pages.forEach((page, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const stream = page.lines.join('\n');

    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
  });

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  return objects;
};

const serializePdf = (objects) => {
  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'utf8'));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'utf8');
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'utf8');
};

export const buildAttendanceReportFileName = (payload) => {
  const monthKey = String(payload.period.start_date || '').slice(0, 7) || 'custom-period';
  return `infinite-track-attendance-report-${monthKey}.pdf`;
};

export const renderMyAttendanceReportPdf = (payload) => {
  const pages = [createPage()];

  addHeader(pages, payload);
  addSummary(pages, payload.summary);
  addDistributions(pages, payload);
  addTimeline(pages, payload);
  addFooters(pages, payload);

  return serializePdf(buildPdfObjects(pages));
};
