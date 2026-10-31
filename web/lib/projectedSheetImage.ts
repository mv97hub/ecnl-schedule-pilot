import type { PredictedStandings } from "./types";

import { SHEET_COLUMNS, SHEET_GROUPS, type ProjectedSheet, type SheetLine, buildProjectedSheet } from "./projectedSheet";

const SCALE = 2;
const FONT = '"Liberation Sans", "Noto Sans", sans-serif';
const INK = "#1c1917";
const MUTED = "#44403c";
const GRID = "#d6d3d1";
const HEADER = "#f5f5f4";
const PAGE = "#ffffff";

const TONE = {
  W: { bg: "#d1fae5", fg: "#065f46" },
  L: { bg: "#fee2e2", fg: "#991b1b" },
  D: { bg: "#e7e5e4", fg: "#57534e" },
  date: { bg: "", fg: "#1d4ed8" },
} as const;

const LEFT_WIDTHS = [78, 0, 40, 36, 36, 36, 44, 42, 42, 46, 70, 74, 66, 58, 80, 52, 52, 64];

function font(size: number, weight = 400): string {
  return `${weight} ${size}px ${FONT}`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

type Layout = {
  width: number;
  height: number;
  colX: number[];
  colW: number[];
  headerTop: number;
  groupHeight: number;
  labelBand: number;
  headerHeight: number;
  rowTop: number[];
  rowH: number[];
  legendTop: number;
  legendLines: string[];
};

function measure(ctx: CanvasRenderingContext2D, sheet: ProjectedSheet): Layout {
  const margin = 28;
  ctx.font = font(14, 600);
  const teamWidth = Math.max(180, ...sheet.rows.map((row) => ctx.measureText(row.values[1] || "").width + 20), 180);
  ctx.font = font(13, 600);
  let opponentWidth = 56;
  for (const row of sheet.rows) {
    for (const lines of row.matchups) {
      for (const line of lines) opponentWidth = Math.max(opponentWidth, ctx.measureText(line.text).width + 14);
    }
  }
  const colW = LEFT_WIDTHS.map((width, index) => (index === 1 ? teamWidth : width));
  for (let index = 0; index < sheet.opponentNames.length; index += 1) colW.push(opponentWidth);

  ctx.font = font(12, 600);
  const nameHeight = Math.max(96, ...sheet.opponentNames.map((name) => ctx.measureText(name).width + 16));
  const groupHeight = 22;
  const labelBand = 26;
  const headerHeight = nameHeight + labelBand;

  const rowH = sheet.rows.map((row) => {
    const lines = Math.max(1, ...row.matchups.map((matchup) => matchup.length));
    return 14 + lines * 18;
  });

  const tableWidth = colW.reduce((sum, width) => sum + width, 0);
  const width = margin * 2 + tableWidth;
  ctx.font = font(13);
  const legendLines = wrapText(ctx, `${sheet.conference}. ${sheet.legend}`, tableWidth);
  const titleBlock = 36 + 22 + 14;
  const tableHeight = headerHeight + rowH.reduce((sum, height) => sum + height, 0);
  const height = margin + titleBlock + tableHeight + 16 + legendLines.length * 18 + margin;

  const colX: number[] = [];
  let cursor = margin;
  for (const widthOfColumn of colW) {
    colX.push(cursor);
    cursor += widthOfColumn;
  }

  const headerTop = margin + titleBlock;
  const rowTop: number[] = [];
  let rowCursor = headerTop + headerHeight;
  for (const heightOfRow of rowH) {
    rowTop.push(rowCursor);
    rowCursor += heightOfRow;
  }

  return {
    width,
    height,
    colX,
    colW,
    headerTop,
    groupHeight,
    labelBand,
    headerHeight,
    rowTop,
    rowH,
    legendTop: rowCursor + 16,
    legendLines,
  };
}

function strokeCell(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = GRID;
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function drawLines(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, lines: SheetLine[]) {
  if (lines.length === 0) return;
  const lineH = 18;
  let top = y + (h - lines.length * lineH) / 2;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = font(13, 600);
  for (const line of lines) {
    const tone = TONE[line.tone];
    if (tone.bg) {
      const textW = ctx.measureText(line.text).width;
      const pillW = Math.min(w - 6, textW + 10);
      const pillH = 16;
      ctx.fillStyle = tone.bg;
      ctx.beginPath();
      ctx.roundRect(x + (w - pillW) / 2, top + (lineH - pillH) / 2, pillW, pillH, 3);
      ctx.fill();
    }
    ctx.fillStyle = tone.fg;
    ctx.fillText(line.text, x + w / 2, top + lineH / 2);
    top += lineH;
  }
}

function paint(ctx: CanvasRenderingContext2D, sheet: ProjectedSheet, layout: Layout) {
  ctx.fillStyle = PAGE;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = font(26, 700);
  ctx.fillText(sheet.title, 28, 28);
  ctx.fillStyle = MUTED;
  ctx.font = font(14);
  ctx.fillText(sheet.conference, 28, 60);

  const leftCount = SHEET_COLUMNS.length;
  for (let index = 0; index < layout.colW.length; index += 1) {
    strokeCell(ctx, layout.colX[index], layout.headerTop, layout.colW[index], layout.headerHeight, HEADER);
  }

  const leafTop = layout.headerTop + layout.headerHeight - layout.labelBand;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = MUTED;
  ctx.font = font(12, 700);
  let groupIndex = 0;
  for (const group of SHEET_GROUPS) {
    if (group.label) {
      const start = layout.colX[groupIndex];
      const spanWidth = layout.colW.slice(groupIndex, groupIndex + group.span).reduce((sum, width) => sum + width, 0);
      ctx.fillText(group.label, start + spanWidth / 2, leafTop - layout.groupHeight / 2);
      ctx.beginPath();
      ctx.strokeStyle = GRID;
      ctx.moveTo(start, leafTop);
      ctx.lineTo(start + spanWidth, leafTop);
      ctx.stroke();
    }
    groupIndex += group.span;
  }

  ctx.font = font(11, 600);
  SHEET_COLUMNS.forEach((label, index) => {
    ctx.fillStyle = MUTED;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, layout.colX[index] + layout.colW[index] / 2, leafTop + layout.labelBand / 2);
  });

  ctx.font = font(12, 600);
  ctx.fillStyle = INK;
  sheet.opponentNames.forEach((name, index) => {
    const column = leftCount + index;
    const x = layout.colX[column] + layout.colW[column] / 2;
    const y = leafTop - 6;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 0, 0);
    ctx.restore();
  });

  sheet.rows.forEach((row, rowIndex) => {
    const y = layout.rowTop[rowIndex];
    const h = layout.rowH[rowIndex];
    row.values.forEach((value, index) => {
      strokeCell(ctx, layout.colX[index], y, layout.colW[index], h, PAGE);
      if (!value) return;
      ctx.fillStyle = INK;
      ctx.font = font(index === 1 ? 14 : 13, index === 1 ? 600 : 400);
      ctx.textBaseline = "middle";
      if (index === 1) {
        ctx.textAlign = "left";
        ctx.fillText(value, layout.colX[index] + 8, y + h / 2);
      } else {
        ctx.textAlign = "center";
        ctx.fillText(value, layout.colX[index] + layout.colW[index] / 2, y + h / 2);
      }
    });
    row.matchups.forEach((lines, index) => {
      const column = leftCount + index;
      strokeCell(ctx, layout.colX[column], y, layout.colW[column], h, PAGE);
      drawLines(ctx, layout.colX[column], y, layout.colW[column], h, lines);
    });
  });

  ctx.fillStyle = MUTED;
  ctx.font = font(13);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  layout.legendLines.forEach((line, index) => {
    ctx.fillText(line, 28, layout.legendTop + index * 18);
  });
}

export function renderProjectedSheet(report: PredictedStandings): HTMLCanvasElement {
  const sheet = buildProjectedSheet(report);
  const canvas = document.createElement("canvas");
  const probe = canvas.getContext("2d");
  if (!probe) throw new Error("Could not build the image");
  const layout = measure(probe, sheet);
  canvas.width = Math.ceil(layout.width * SCALE);
  canvas.height = Math.ceil(layout.height * SCALE);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not build the image");
  ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
  paint(ctx, sheet, layout);
  return canvas;
}

export type ProjectedSheetPreview = {
  url: string;
  filename: string;
  blob: Blob;
  width: number;
  height: number;
};

export function previewProjectedSheet(report: PredictedStandings): Promise<ProjectedSheetPreview> {
  const sheet = buildProjectedSheet(report);
  const canvas = renderProjectedSheet(report);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not build the image"));
        return;
      }
      resolve({
        url: URL.createObjectURL(blob),
        filename: sheet.filename,
        blob,
        width: Math.round(canvas.width / SCALE),
        height: Math.round(canvas.height / SCALE),
      });
    }, "image/png");
  });
}
