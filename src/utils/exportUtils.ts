import { toCanvas } from 'html-to-image';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import type { DocumentTemplateArtifact, PrintTemplateStyle, TemplateColumnConfig } from '../shared/types';

export interface XlsxSheetInput {
  name: string;
  title?: string;
  subtitle?: string;
  headers: string[];
  rows: Array<Array<string | number | boolean | null | undefined>>;
  totalsRow?: Array<string | number | boolean | null | undefined>;
}

function measureArabicAwareWidth(val: string): number {
  let len = 0;
  for (let i = 0; i < val.length; i += 1) {
    const code = val.charCodeAt(i);
    len += code >= 0x0600 && code <= 0x06ff ? 1.25 : 1;
  }
  return Math.ceil(len);
}

export function exportWorkbookXlsx(filename: string, sheets: XlsxSheetInput[]): void {
  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const generatedLabel = new Date().toLocaleString('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  for (const sheet of sheets) {
    const safeName = sheet.name.replace(/[\\/?*[\]:]/g, '').slice(0, 31) || 'Sheet';
    const aoa: Array<Array<string | number | boolean>> = [];
    const merges: XLSX.Range[] = [];
    const colCount = Math.max(1, sheet.headers.length);

    if (sheet.title) {
      const row = new Array<string>(colCount).fill('');
      row[0] = sheet.title;
      aoa.push(row);
      if (colCount > 1) {
        merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: colCount - 1 } });
      }
    }

    const effectiveSubtitle = sheet.subtitle
      ? `${sheet.subtitle} · تاريخ التصدير: ${generatedLabel}`
      : sheet.title
        ? `تاريخ التصدير: ${generatedLabel} · العملة: ج.م`
        : '';

    if (effectiveSubtitle) {
      const subRowIdx = aoa.length;
      const row = new Array<string>(colCount).fill('');
      row[0] = effectiveSubtitle;
      aoa.push(row);
      if (colCount > 1) {
        merges.push({ s: { r: subRowIdx, c: 0 }, e: { r: subRowIdx, c: colCount - 1 } });
      }
    }

    if (sheet.title || effectiveSubtitle) {
      aoa.push([]);
    }

    const headerRowIndex = aoa.length;
    aoa.push(sheet.headers);

    const sanitizedRows = sheet.rows.map((r) =>
      r.map((v) => (v === null || v === undefined ? '' : v))
    );
    for (const r of sanitizedRows) {
      aoa.push(r);
    }

    if (sheet.totalsRow && sheet.totalsRow.length > 0) {
      aoa.push(sheet.totalsRow.map((v) => (v === null || v === undefined ? '' : v)));
    }

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!views'] = [
      {
        rightToLeft: true,
        state: 'frozen',
        ySplit: headerRowIndex + 1,
      },
    ];
    if (merges.length > 0) {
      ws['!merges'] = merges;
    }

    // Apply crisp Excel number formatting to numeric cells in data and totals rows
    const firstDataRow = headerRowIndex + 1;
    const totalDataAndTotalsEnd = aoa.length - 1;
    for (let r = firstDataRow; r <= totalDataAndTotalsEnd; r += 1) {
      for (let c = 0; c < colCount; c += 1) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.t === 'n' && typeof cell.v === 'number') {
          const isInteger = Number.isInteger(cell.v);
          const headerText = String(sheet.headers[c] || '');
          const isCountOrPercent =
            headerText.includes('عدد') ||
            headerText.includes('الترتيب') ||
            headerText.includes('#');
          cell.z = isInteger && isCountOrPercent ? '#,##0' : '#,##0.00';
        }
      }
    }

    const lastDataRowIndex = headerRowIndex + sanitizedRows.length;
    if (colCount > 0 && sanitizedRows.length > 0) {
      ws['!autofilter'] = {
        ref: XLSX.utils.encode_range({
          s: { r: headerRowIndex, c: 0 },
          e: { r: lastDataRowIndex, c: colCount - 1 },
        }),
      };
    }

    const allDataRows = sheet.totalsRow ? [...sanitizedRows, sheet.totalsRow] : sanitizedRows;
    const colWidths = sheet.headers.map((h, idx) => {
      let maxLen = measureArabicAwareWidth(String(h)) + 5;
      for (const r of allDataRows) {
        const rawVal = r[idx];
        const cellStr =
          typeof rawVal === 'number'
            ? rawVal.toLocaleString('en-US', { maximumFractionDigits: 2 })
            : String(rawVal ?? '');
        const w = measureArabicAwareWidth(cellStr) + 4;
        if (w > maxLen) maxLen = w;
      }
      return { wch: Math.min(54, Math.max(13, maxLen)) };
    });
    ws['!cols'] = colWidths;
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }

  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`);
}

export async function parseXlsxFile(
  file: File
): Promise<{ sheets: Record<string, Array<Record<string, unknown>>>; sheetNames: string[] }> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheets: Record<string, Array<Record<string, unknown>>> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    sheets[name] = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  }
  return { sheets, sheetNames: wb.SheetNames };
}

export function exportTemplateAsXlsx(template: DocumentTemplateArtifact): void {
  const yesNo = (b: boolean) => (b ? 'نعم' : 'لا');
  exportWorkbookXlsx(template.xlsxFileName, [
    {
      name: 'إعدادات_النموذج',
      title: `إعدادات قالب الطباعة — ${template.nameAr}`,
      headers: ['المفتاح', 'الوصف', 'القيمة'],
      rows: [
        ['nameAr', 'اسم النموذج', template.nameAr],
        ['paperSize', 'مقاس الورق (a4 / thermal_80mm)', template.paperSize],
        ['style', 'نمط التصميم (modern_emerald / classic_bordered / executive_slate / compact_thermal)', template.style],
        ['accentColor', 'اللون الرئيسي (Hex)', template.accentColor],
        ['headerTitle', 'عنوان المستند الرئيسي', template.headerTitle],
        ['headerSubtitle', 'العنوان الفرعي / الملاحظة العلوية', template.headerSubtitle],
        ['footerNote', 'تذييل المستند', template.footerNote],
        ['showLogo', 'إظهار شعار المحل (نعم/لا)', yesNo(template.showLogo)],
        ['showTaxNumber', 'إظهار الرقم الضريبي (نعم/لا)', yesNo(template.showTaxNumber)],
        ['showBarcode', 'إظهار كود/باركود الفاتورة (نعم/لا)', yesNo(template.showBarcode)],
        ['showSplitPayments', 'إظهار تفصيل سداد الخزائن المتعددة (نعم/لا)', yesNo(template.showSplitPayments)],
        ['showSignatureLine', 'إظهار سطر التوقيع والختم (نعم/لا)', yesNo(template.showSignatureLine)],
      ],
    },
    {
      name: 'الأعمدة_والحقول',
      headers: ['key', 'عنوان العمود', 'ظاهر (نعم/لا)', 'الترتيب', 'العرض %'],
      rows: [...template.columns]
        .sort((a, b) => a.order - b.order)
        .map((c) => [c.key, c.label, yesNo(c.visible), c.order, c.widthPercent]),
    },
    {
      name: 'بيانات_المعاينة',
      headers: template.columns.map((c) => c.key),
      rows: template.sampleRows.map((row) => template.columns.map((c) => row[c.key] ?? '')),
    },
  ]);
}

export async function parseTemplateFromXlsxFile(
  file: File,
  base: DocumentTemplateArtifact
): Promise<DocumentTemplateArtifact> {
  const parsed = await parseXlsxFile(file);
  const parseBool = (val: unknown, fallback: boolean) => {
    const s = String(val ?? '').trim().toLowerCase();
    if (!s) return fallback;
    if (['نعم', 'yes', 'true', '1'].includes(s)) return true;
    if (['لا', 'no', 'false', '0'].includes(s)) return false;
    return fallback;
  };

  const settingsSheet = parsed.sheets['إعدادات_النموذج'] || parsed.sheets[parsed.sheetNames[0]] || [];
  const kv = new Map<string, string>();
  for (const r of settingsSheet) {
    const k = String(r['المفتاح'] ?? r['key'] ?? '').trim();
    const v = String(r['القيمة'] ?? r['value'] ?? '').trim();
    if (k) kv.set(k, v);
  }

  const columnsSheet = parsed.sheets['الأعمدة_والحقول'] || parsed.sheets[parsed.sheetNames[1]] || [];
  const nextColumns: TemplateColumnConfig[] =
    columnsSheet.length > 0
      ? columnsSheet
          .map((r, idx) => ({
            key: String(r['key'] ?? r['المفتاح'] ?? `col_${idx}`).trim(),
            label: String(r['عنوان العمود'] ?? r['label'] ?? `عمود ${idx + 1}`).trim(),
            visible: parseBool(r['ظاهر (نعم/لا)'] ?? r['visible'], true),
            order: Number(r['الترتيب'] ?? r['order'] ?? idx + 1) || idx + 1,
            widthPercent: Number(r['العرض %'] ?? r['widthPercent'] ?? 20) || 20,
          }))
          .filter((c) => c.key)
      : base.columns;

  const sampleSheet = parsed.sheets['بيانات_المعاينة'] || parsed.sheets[parsed.sheetNames[2]] || [];
  const nextSampleRows: Array<Record<string, string | number>> =
    sampleSheet.length > 0
      ? sampleSheet.map((r) => {
          const obj: Record<string, string | number> = {};
          for (const col of nextColumns) {
            const raw = r[col.key] ?? r[col.label] ?? '';
            obj[col.key] = typeof raw === 'number' ? raw : String(raw);
          }
          return obj;
        })
      : base.sampleRows;

  const validStyles: PrintTemplateStyle[] = [
    'classic_bordered',
    'modern_emerald',
    'executive_slate',
    'compact_thermal',
  ];
  const rawStyle = kv.get('style') as PrintTemplateStyle | undefined;
  const rawPaper = kv.get('paperSize');

  return {
    ...base,
    nameAr: kv.get('nameAr') || base.nameAr,
    paperSize: rawPaper === 'thermal_80mm' ? 'thermal_80mm' : rawPaper === 'a4' ? 'a4' : base.paperSize,
    style: rawStyle && validStyles.includes(rawStyle) ? rawStyle : base.style,
    accentColor: kv.get('accentColor') || base.accentColor,
    headerTitle: kv.get('headerTitle') ?? base.headerTitle,
    headerSubtitle: kv.get('headerSubtitle') ?? base.headerSubtitle,
    footerNote: kv.get('footerNote') ?? base.footerNote,
    showLogo: parseBool(kv.get('showLogo'), base.showLogo),
    showTaxNumber: parseBool(kv.get('showTaxNumber'), base.showTaxNumber),
    showBarcode: parseBool(kv.get('showBarcode'), base.showBarcode),
    showSplitPayments: parseBool(kv.get('showSplitPayments'), base.showSplitPayments),
    showSignatureLine: parseBool(kv.get('showSignatureLine'), base.showSignatureLine),
    columns: nextColumns,
    sampleRows: nextSampleRows,
  };
}

async function waitForLayoutAndFonts(): Promise<void> {
  try {
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
  } catch {
    // ignore font readiness fallback
  }
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

export async function renderElementToPngCanvas(el: HTMLElement): Promise<HTMLCanvasElement> {
  await waitForLayoutAndFonts();
  return toCanvas(el, {
    backgroundColor: '#ffffff',
    pixelRatio: 2.5,
    cacheBust: true,
    width: Math.max(el.scrollWidth, el.offsetWidth),
    height: Math.max(el.scrollHeight, el.offsetHeight),
  });
}

export async function renderElementToPngDataUrl(el: HTMLElement): Promise<string> {
  const canvas = await renderElementToPngCanvas(el);
  return canvas.toDataURL('image/png', 1.0);
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function exportElementToPng(el: HTMLElement, filename: string): Promise<string> {
  const dataUrl = await renderElementToPngDataUrl(el);
  downloadDataUrl(dataUrl, filename.endsWith('.png') ? filename : `${filename}.png`);
  return dataUrl;
}

/**
 * Finds the best completely white horizontal scanline just above targetBottomPx
 * so multi-page PDF exports never cut across Arabic characters or table rows.
 */
function findSmartPageBreakY(
  ctx: CanvasRenderingContext2D,
  width: number,
  startY: number,
  targetBottomY: number,
  maxHeight: number
): number {
  if (targetBottomY >= maxHeight) return maxHeight;
  const searchWindow = Math.min(260, Math.floor((targetBottomY - startY) * 0.28));
  const minCandidate = Math.max(startY + 40, targetBottomY - searchWindow);
  const sampleStep = Math.max(1, Math.floor(width / 160));

  for (let y = targetBottomY; y >= minCandidate; y -= 1) {
    const rowData = ctx.getImageData(0, y, width, 1).data;
    let isCleanBand = true;
    for (let x = 0; x < width; x += sampleStep) {
      const idx = x * 4;
      const r = rowData[idx];
      const g = rowData[idx + 1];
      const b = rowData[idx + 2];
      // Treat near-white pixels (#f8fafc or brighter) as safe row boundary
      if (r < 245 || g < 245 || b < 245) {
        isCleanBand = false;
        break;
      }
    }
    if (isCleanBand) {
      return y;
    }
  }

  return targetBottomY;
}

export async function exportElementToPdf(
  el: HTMLElement,
  filename: string,
  orientation: 'portrait' | 'landscape' = 'portrait',
  footerTitle?: string
): Promise<void> {
  const sourceCanvas = await renderElementToPngCanvas(el);
  const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });

  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: 'a4',
  });
  const pageWidthMm = pdf.internal.pageSize.getWidth();
  const pageHeightMm = pdf.internal.pageSize.getHeight();
  const marginMm = 8;
  const footerReserveMm = 8;
  const contentWidthMm = pageWidthMm - marginMm * 2;
  const contentHeightMm = pageHeightMm - marginMm * 2 - footerReserveMm;

  const pxPerMm = sourceCanvas.width / contentWidthMm;
  const maxSliceHeightPx = Math.max(100, Math.floor(contentHeightMm * pxPerMm));

  const slices: Array<{ startY: number; heightPx: number }> = [];
  let cursorY = 0;
  while (cursorY < sourceCanvas.height) {
    const naiveEnd = Math.min(sourceCanvas.height, cursorY + maxSliceHeightPx);
    const smartEnd =
      srcCtx && naiveEnd < sourceCanvas.height
        ? findSmartPageBreakY(srcCtx, sourceCanvas.width, cursorY, naiveEnd, sourceCanvas.height)
        : naiveEnd;
    const sliceH = Math.max(20, smartEnd - cursorY);
    slices.push({ startY: cursorY, heightPx: sliceH });
    cursorY += sliceH;
  }

  const totalPages = Math.max(1, slices.length);
  const footerHeightPx = Math.round(footerReserveMm * pxPerMm);
  const exportStamp = new Date().toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  for (let i = 0; i < slices.length; i += 1) {
    if (i > 0) pdf.addPage();
    const { startY, heightPx } = slices[i];

    const pageCanvas = document.createElement('canvas');
    pageCanvas.width = sourceCanvas.width;
    pageCanvas.height = heightPx + footerHeightPx;
    const pCtx = pageCanvas.getContext('2d');
    if (pCtx) {
      pCtx.fillStyle = '#ffffff';
      pCtx.fillRect(0, 0, pageCanvas.width, pageCanvas.height);
      pCtx.drawImage(
        sourceCanvas,
        0,
        startY,
        sourceCanvas.width,
        heightPx,
        0,
        0,
        sourceCanvas.width,
        heightPx
      );

      // Draw crisp Arabic RTL pagination footer directly onto canvas so fonts never garble
      pCtx.strokeStyle = '#cbd5e1';
      pCtx.lineWidth = Math.max(1, Math.round(pxPerMm * 0.2));
      pCtx.beginPath();
      pCtx.moveTo(0, heightPx + Math.round(footerHeightPx * 0.18));
      pCtx.lineTo(pageCanvas.width, heightPx + Math.round(footerHeightPx * 0.18));
      pCtx.stroke();

      const fontSizePx = Math.max(18, Math.round(footerHeightPx * 0.38));
      pCtx.font = `600 ${fontSizePx}px "IBM Plex Sans Arabic", "Cairo", sans-serif`;
      pCtx.fillStyle = '#475569';
      pCtx.textAlign = 'center';
      pCtx.textBaseline = 'middle';
      pCtx.direction = 'rtl';
      const footerLabel = footerTitle
        ? `${footerTitle} · ${exportStamp} · صفحة ${i + 1} من ${totalPages}`
        : `صفحة ${i + 1} من ${totalPages} · ${exportStamp}`;
      pCtx.fillText(
        footerLabel,
        pageCanvas.width / 2,
        heightPx + Math.round(footerHeightPx * 0.65)
      );
    }

    const pageDataUrl = pageCanvas.toDataURL('image/png', 1.0);
    const renderedHeightMm = pageCanvas.height / pxPerMm;
    pdf.addImage(pageDataUrl, 'PNG', marginMm, marginMm, contentWidthMm, renderedHeightMm);
  }

  pdf.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
