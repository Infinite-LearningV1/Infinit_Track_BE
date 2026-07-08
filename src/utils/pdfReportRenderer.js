const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const LEFT_MARGIN = 48;
const TOP_MARGIN = 56;
const BOTTOM_MARGIN = 56;
const LINE_HEIGHT = 16;
const MAX_LINE_CHARS = 92;

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

const makeTextLine = (text, x, y, size = 10) => {
  return `BT /F1 ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
};

const addWrappedLine = (pages, text, options = {}) => {
  const size = options.size || 10;
  const lineHeight = options.lineHeight || LINE_HEIGHT;
  const indent = options.indent || 0;
  const maxChars = options.maxChars || MAX_LINE_CHARS;

  for (const line of wrapText(text, maxChars)) {
    let page = pages[pages.length - 1];
    if (page.cursorY < BOTTOM_MARGIN) {
      page = { lines: [], cursorY: PAGE_HEIGHT - TOP_MARGIN };
      pages.push(page);
    }

    page.lines.push(makeTextLine(line, LEFT_MARGIN + indent, page.cursorY, size));
    page.cursorY -= lineHeight;
  }
};

const addSectionGap = (pages, gap = 8) => {
  pages[pages.length - 1].cursorY -= gap;
};

const formatModeDistribution = (distribution) => {
  return Object.entries(distribution)
    .filter(([, item]) => item.included || item.count > 0)
    .map(([key, item]) => {
      const percentage = item.percentage == null ? 'N/A' : `${item.percentage}%`;
      const note = item.note ? ` (${item.note})` : '';
      return `${item.label || key.toUpperCase()}: ${item.count} (${percentage})${note}`;
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
  const pages = [{ lines: [], cursorY: PAGE_HEIGHT - TOP_MARGIN }];
  const rolePosition = [payload.user.role, payload.user.position].filter(Boolean).join(' / ') || 'Role / position unavailable';

  addWrappedLine(pages, payload.report_metadata.brand || 'Infinite Track', { size: 18, lineHeight: 22 });
  addWrappedLine(pages, payload.report_metadata.title || 'My Attendance Report', { size: 15, lineHeight: 20 });
  addWrappedLine(pages, `User: ${payload.user.full_name}`, { size: 11 });
  addWrappedLine(pages, `Role / Position: ${rolePosition}`, { size: 11 });
  addWrappedLine(pages, `Period: ${payload.period.display_label}`, { size: 11 });
  addWrappedLine(pages, `Generated at: ${payload.report_metadata.generated_at}`, { size: 11 });
  addSectionGap(pages, 10);

  addWrappedLine(pages, 'Report Summary', { size: 13, lineHeight: 18 });
  addWrappedLine(pages, `Attendance Rate: ${payload.summary.attendance_rate_percent ?? 'Unavailable'}`);
  addWrappedLine(pages, `Attendance Rate Note: ${payload.summary.attendance_rate_note}`);
  addWrappedLine(pages, `Total Work Hours: ${payload.summary.total_work_hours}`);
  addWrappedLine(pages, `Late: ${payload.summary.late}`);
  addWrappedLine(pages, `Alpha: ${payload.summary.alpha}`);
  addWrappedLine(pages, `Attended Days: ${payload.summary.attended_days}`);
  addWrappedLine(pages, `Expected Working Days: ${payload.summary.expected_working_days ?? 'Unavailable'}`);
  addSectionGap(pages, 10);

  addWrappedLine(pages, 'Attendance Mode Distribution', { size: 13, lineHeight: 18 });
  formatModeDistribution(payload.mode_distribution).forEach((line) => addWrappedLine(pages, line));
  addSectionGap(pages, 10);

  addWrappedLine(pages, 'Attendance Timeline', { size: 13, lineHeight: 18 });
  if (payload.empty_state.is_empty) {
    addWrappedLine(pages, payload.empty_state.message);
  } else {
    payload.timeline.forEach((row) => {
      addWrappedLine(
        pages,
        `${row.attendance_date} | ${row.mode_label || '—'} | ${row.time_range} | ${row.work_hour || '—'} | ${
          row.status_label || '—'
        } | ${row.location_label || 'Location unavailable'}`,
        { maxChars: 100 }
      );
    });
  }
  addSectionGap(pages, 10);

  addWrappedLine(pages, 'Generated by Infinite Track', { size: 10 });
  addWrappedLine(pages, payload.report_metadata.source_of_truth_notice, { size: 10 });
  addWrappedLine(pages, `Generated timestamp: ${payload.report_metadata.generated_at}`, { size: 10 });

  return serializePdf(buildPdfObjects(pages));
};
