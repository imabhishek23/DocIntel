import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';
import {
  ZoomIn,
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  AlertCircle,
  Sparkles,
  MessageSquare,
  CheckCircle2,
  FileText,
  Copy,
  Check,
  Palette,
  RefreshCw,
} from 'lucide-react';

// Initialize PDF.js worker with reliable CDN fallback
if (typeof window !== 'undefined') {
  if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
    try {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        pdfjsWorker ||
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version || '3.11.174'}/pdf.worker.min.js`;
    } catch (_) {
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js`;
    }
  }
}

/**
 * Converts a base64 string or data URL to a Uint8Array for PDF.js
 */
function toUint8Array(dataUrlOrBase64) {
  try {
    const raw = dataUrlOrBase64.includes(',')
      ? dataUrlOrBase64.split(',')[1]
      : dataUrlOrBase64;
    const cleanBase64 = raw.replace(/\s/g, '');
    const binaryString = window.atob(cleanBase64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
  } catch (err) {
    console.error('[toUint8Array] Base64 decoding failed:', err);
    throw err;
  }
}

/**
 * Maps proofreading discrepancies to exact CSS bounding boxes on the PDF canvas page
 */
function computePageHighlights(
  items,
  viewport,
  discrepancies = [],
  matchingTokens = [],
  dpr = 1,
  isWordToPdf = false,
  isIsiComparison = false,
  isiLineResults = []
) {
  if (!items || items.length === 0) {
    return [];
  }

  // Filter only text items that have valid transform arrays (PDF.js can include TextMarkedContent without transform)
  const validItems = items.filter(
    (it) => it && Array.isArray(it.transform) && it.transform.length >= 6
  );

  if (validItems.length === 0) return [];

  // Pre-calculate CSS boxes for each text item
  const itemBoxes = validItems.map((item, idx) => {
    const tx = item.transform[4];
    const ty = item.transform[5];
    const rect = viewport.convertToViewportRectangle([
      tx,
      ty,
      tx + (item.width || 1),
      ty + (item.height || 10),
    ]);
    return {
      idx,
      str: item.str,
      cleanStr: (item.str || '').replace(/\s+/g, ' ').trim(),
      rawY: ty,
      x: Math.min(rect[0], rect[2]) / dpr,
      y: Math.min(rect[1], rect[3]) / dpr,
      w: Math.abs(rect[2] - rect[0]) / dpr,
      h: Math.abs(rect[3] - rect[1]) / dpr,
    };
  });

  // ── STRICT ISI LINE-BY-LINE VISUAL HIGHLIGHTING (Requirements 1-11) ──
  if (isIsiComparison && Array.isArray(isiLineResults) && isiLineResults.length > 0) {
    // 1. Group rendered PDF text items into distinct visual lines by baseline rawY
    const lineMap = new Map();
    for (const it of itemBoxes) {
      if (!it.cleanStr) continue;
      let matchedY = null;
      for (const y of lineMap.keys()) {
        if (Math.abs(y - it.rawY) < 4) {
          matchedY = y;
          break;
        }
      }
      if (matchedY !== null) {
        lineMap.get(matchedY).push(it);
      } else {
        lineMap.set(it.rawY, [it]);
      }
    }

    // Sort lines descending by rawY (top of page first in PDF coordinates)
    const sortedEntries = [...lineMap.entries()].sort((a, b) => b[0] - a[0]);

    const pageLines = sortedEntries.map(([rawY, lineItems]) => {
      const sorted = [...lineItems].sort((a, b) => a.x - b.x);
      const text = sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const minX = Math.min(...sorted.map((m) => m.x));
      const minY = Math.min(...sorted.map((m) => m.y));
      const maxX = Math.max(...sorted.map((m) => m.x + m.w));
      const maxY = Math.max(...sorted.map((m) => m.y + m.h));
      return {
        rawY,
        text,
        clean: text.toLowerCase().replace(/[^a-z0-9]/g, ''),
        box: {
          x: Math.round(minX - 1),
          y: Math.round(minY),
          w: Math.round(maxX - minX + 2),
          h: Math.round(maxY - minY),
        },
      };
    });

    const highlights = [];
    const usedIndices = new Set();

    for (const lr of isiLineResults) {
      const lrClean = (lr.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!lrClean && lr.text !== '•' && lr.text !== '-' && lr.text !== '*') continue;

      let bestIdx = -1;
      let bestScore = 0;
      let matchedLine = null;
      let matchedIdx = -1;

      for (let pIdx = 0; pIdx < pageLines.length; pIdx++) {
        if (usedIndices.has(pIdx)) continue;
        const pl = pageLines[pIdx];

        if (pl.clean === lrClean) {
          bestIdx = pIdx;
          bestScore = 1;
          break;
        }

        const minLen = Math.min(pl.clean.length, lrClean.length);
        const maxLen = Math.max(pl.clean.length, lrClean.length);
        const lenRatio = maxLen > 0 ? minLen / maxLen : 0;

        if (
          ((pl.clean.includes(lrClean) || lrClean.includes(pl.clean)) && lenRatio >= 0.55) ||
          (lrClean.length < 4 && (pl.text === lr.text || pl.clean === lrClean))
        ) {
          if (lenRatio > bestScore) {
            bestScore = lenRatio;
            bestIdx = pIdx;
          }
        }
      }

      if (bestIdx >= 0) {
        matchedLine = pageLines[bestIdx];
        matchedIdx = bestIdx;
      }

      if (matchedLine) {
        usedIndices.add(matchedIdx);
        const isMatch = lr.color === 'green';

        highlights.push({
          id: `isi_line_${lr.lineNum || lr.lineIndex}`,
          index: lr.lineNum || lr.lineIndex,
          target: lr.text,
          box: matchedLine.box,
          boxes: [matchedLine.box],
          isMatch,
          isError: !isMatch,
          color: lr.color,
          category: isMatch
            ? 'Approved ISI Match'
            : lr.status === 'extra_line'
            ? 'Extra Line'
            : (lr.comment || '').includes('Missing')
            ? 'Missing Word'
            : 'Line Discrepancy',
          details: lr.comment || (isMatch ? 'Complete line match' : 'Line discrepancy detected'),
          comment: lr.comment,
          expected: lr.expected || lr.text,
          found: lr.found || lr.text,
          isLineDiscrepancy: !isMatch,
        });
      }
    }

    return highlights;
  }

  if (
    (!discrepancies || discrepancies.length === 0) &&
    (!matchingTokens || matchingTokens.length === 0)
  ) {
    return [];
  }

  const highlights = [];

  discrepancies.forEach((err, errIdx) => {
    // Clean search candidate string
    const rawFound = (err.found || '')
      .replace(/^(Bold\s*\+\s*Italic|Bold|Italic|Regular):\s*["']?|["']?$/gi, '')
      .trim();
    const rawExpected = (err.expected || '')
      .replace(/^(Bold\s*\+\s*Italic|Bold|Italic|Regular):\s*["']?|["']?$/gi, '')
      .trim();

    let target = rawFound;
    if (!target || target === '(deleted)' || target === '(none)' || target === '(missing in PDF)') {
      target = rawExpected;
    }
    if (!target) return;

    // ── STRATEGY 0: MISSING WORD INSERTION MARKER (Requirement 7) ──
    if (err.isMissingWord || err.found === '(missing in PDF)' || err.found === '(deleted)' || err.category === 'Missing Word') {
      const beforeWordClean = (err.beforeWord || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const afterWordClean = (err.afterWord || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      let targetItem = null;
      let isAfter = true;
      if (beforeWordClean) {
        targetItem = itemBoxes.find((it) => it.cleanStr.toLowerCase().includes(beforeWordClean));
        isAfter = true;
      }
      if (!targetItem && afterWordClean) {
        targetItem = itemBoxes.find((it) => it.cleanStr.toLowerCase().includes(afterWordClean));
        isAfter = false;
      }

      if (targetItem) {
        const x = isAfter ? targetItem.x + targetItem.w + 2 : Math.max(0, targetItem.x - 20);
        const box = {
          x: Math.round(x),
          y: Math.round(targetItem.y - 2),
          w: 24,
          h: Math.round(Math.max(16, targetItem.h + 4)),
        };
        highlights.push({
          id: err.id || `hl_${errIdx}`,
          index: errIdx + 1,
          target: err.expected || target,
          box,
          boxes: [box],
          discrepancy: err,
          category: 'Missing Word',
          expected: err.expected,
          found: '(missing in PDF)',
          details: err.details || `Missing expected word: "${err.expected}"`,
          isMissingWord: true,
        });
        return;
      }
    }

    // Remove surrounding quotes
    const cleanTarget = target.replace(/^["']|["']$/g, '').trim();
    if (!cleanTarget) return;

    const normTarget = cleanTarget.replace(/\s+/g, ' ').toLowerCase();

    // ── STRATEGY 1: SINGLE WORD / TOKEN / PUNCTUATION / SYMBOL / SPACE ──
    // For single words (e.g. gastrointestinal, SPONSORED, health, recipients, from), mark ONLY that exact word box!
    let candidates = [];
    for (const it of itemBoxes) {
      const itText = it.cleanStr.toLowerCase();
      if (itText.includes(normTarget)) {
        let isExactWord = false;
        if (!normTarget.includes(' ')) {
          const re = new RegExp(`\\b${normTarget.replace(/[-[\]{}()*+?.,\\^$|#\\s]/g, '\\$&')}\\b`, 'i');
          isExactWord = re.test(itText);
        }
        candidates.push({ it, isExactWord, matchIdx: itText.indexOf(normTarget) });
      }
    }

    let bestSingle = null;
    if (candidates.length === 1) {
      bestSingle = candidates[0];
    } else if (candidates.length > 1) {
      if (err.context) {
        const normContext = err.context.toLowerCase();
        let bestScore = -1;
        for (const cand of candidates) {
          const nearby = itemBoxes
            .slice(Math.max(0, cand.it.idx - 3), Math.min(itemBoxes.length, cand.it.idx + 4))
            .map((it) => it.cleanStr.toLowerCase())
            .join(' ');
          let score = 0;
          if (cand.isExactWord) score += 2;
          for (const word of normContext.split(/\s+/)) {
            if (word.length > 2 && nearby.includes(word)) score += 1;
          }
          if (score > bestScore) {
            bestScore = score;
            bestSingle = cand;
          }
        }
      }
      if (!bestSingle) {
        bestSingle = candidates.find((c) => c.isExactWord) || candidates[0];
      }
    }

    if (bestSingle) {
      const { it, matchIdx } = bestSingle;
      const charRatio = it.cleanStr.length > 0 ? Math.max(0, matchIdx) / it.cleanStr.length : 0;
      const widthRatio =
        it.cleanStr.length > 0
          ? Math.min(1, cleanTarget.length / it.cleanStr.length)
          : 1;

      const x = it.x + charRatio * it.w;
      const w = Math.max(14, widthRatio * it.w);
      const y = it.y;
      const h = Math.max(14, it.h);

      const box = {
        x: Math.round(x - 2),
        y: Math.round(y - 2),
        w: Math.round(w + 4),
        h: Math.round(h + 4),
      };

      highlights.push({
        id: err.id || `hl_${errIdx}`,
        index: errIdx + 1,
        target: cleanTarget,
        box,
        boxes: [box],
        discrepancy: err,
        category: err.category,
        expected: err.expected,
        found: err.found,
        details: err.details,
      });
      return;
    }

    // ── STRATEGY 2: TIGHT MULTI-WORD PHRASE MATCH (Never highlight whole paragraph!) ──
    const targetWords = cleanTarget.split(/\s+/).filter(Boolean);
    if (targetWords.length >= 2) {
      const firstWord = targetWords[0]?.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      const maxSpanLength = Math.min(targetWords.length + 2, 6);

      let bestSpan = null;
      for (let i = 0; i < itemBoxes.length; i++) {
        const startItem = itemBoxes[i];
        const startClean = startItem.cleanStr.toLowerCase();

        if (firstWord && !startClean.includes(firstWord)) {
          continue;
        }

        let combined = '';
        const span = [];
        for (let j = i; j < Math.min(itemBoxes.length, i + maxSpanLength); j++) {
          const it = itemBoxes[j];
          span.push(it);
          combined += (combined ? ' ' : '') + it.cleanStr.toLowerCase();

          const normClean = normTarget.replace(/[^a-z0-9]/g, '');
          const combinedClean = combined.replace(/[^a-z0-9]/g, '');

          if (combined.includes(normTarget) || (normClean.length > 5 && combinedClean.includes(normClean))) {
            bestSpan = span.slice();
            break;
          }
        }
        if (bestSpan) break;
      }

    if (bestSpan && bestSpan.length > 0) {
      // Group matched items into distinct lines by raw baseline Y
      const lineMap = new Map();
      for (const it of bestSpan) {
        if (!it.cleanStr) continue;

        let foundLineY = null;
        for (const lineY of lineMap.keys()) {
          if (Math.abs(lineY - it.rawY) < 4) {
            foundLineY = lineY;
            break;
          }
        }

        if (foundLineY !== null) {
          lineMap.get(foundLineY).push(it);
        } else {
          lineMap.set(it.rawY, [it]);
        }
      }

      // Compute tight box for each line
      const lineBoxes = [];
      for (const [, lineItems] of lineMap) {
        const minX = Math.min(...lineItems.map((m) => m.x));
        const minY = Math.min(...lineItems.map((m) => m.y));
        const maxX = Math.max(...lineItems.map((m) => m.x + m.w));
        const maxY = Math.max(...lineItems.map((m) => m.y + m.h));

        lineBoxes.push({
          x: Math.round(minX - 2),
          y: Math.round(minY - 2),
          w: Math.round(maxX - minX + 4),
          h: Math.round(maxY - minY + 4),
        });
      }

      if (lineBoxes.length > 0) {
        highlights.push({
          id: err.id || `hl_${errIdx}`,
          index: errIdx + 1,
          target: cleanTarget,
          box: lineBoxes[0],
          boxes: lineBoxes,
          discrepancy: err,
          category: err.category,
          expected: err.expected,
          found: err.found,
          details: err.details,
        });
        return;
      }
    }
  }
  });

  // ── GREEN HIGHLIGHTS: APPROVED MASTER WORD MATCHES ──
  const NON_ISI_TEXT_REGEX =
    /^(?:Arthur|Diabetes|Patient\s+(?:Profile|Snapshot|History)|living\s+with\s+diabetes|\d+\s+years\s+old|Clinical\s+Efficacy|Study\s+Design|See\s+Examples|Practice|Sign\s+Up|Visit|Click\s+Here|Observational\s+studies|Inform\s+your\s+patients)/i;

  if (matchingTokens && matchingTokens.length > 0) {
    matchingTokens.forEach((token, tIdx) => {
      const targetStr = (token.text || '').trim();
      if (!targetStr || targetStr.length < 3) return;

      const normTarget = targetStr.replace(/\s+/g, ' ').toLowerCase();

      for (let i = 0; i < itemBoxes.length; i++) {
        // Skip non-ISI promotional elements in all ISI comparison modes
        const shouldSkipNonIsi = isWordToPdf || isIsiComparison;
        if (shouldSkipNonIsi && NON_ISI_TEXT_REGEX.test(itemBoxes[i].cleanStr)) continue;

        let combined = '';
        const span = [];
        for (let j = i; j < Math.min(itemBoxes.length, i + 6); j++) {
          const it = itemBoxes[j];
          if (shouldSkipNonIsi && NON_ISI_TEXT_REGEX.test(it.cleanStr)) break;
          span.push(it);
          combined += (combined ? ' ' : '') + it.cleanStr.toLowerCase();

          if (combined.includes(normTarget)) {
            const minX = Math.min(...span.map((m) => m.x));
            const minY = Math.min(...span.map((m) => m.y));
            const maxX = Math.max(...span.map((m) => m.x + m.w));
            const maxY = Math.max(...span.map((m) => m.y + m.h));

            const box = {
              x: Math.round(minX - 1),
              y: Math.round(minY - 1),
              w: Math.round(maxX - minX + 2),
              h: Math.round(maxY - minY + 2),
            };

            // Avoid colliding with an existing red error box
            const collidesWithRed = highlights.some((h) => {
              if (h.isMatch) return false;
              const hx = h.box?.x || 0;
              const hy = h.box?.y || 0;
              return Math.abs(hx - box.x) < 8 && Math.abs(hy - box.y) < 8;
            });

            if (!collidesWithRed) {
              highlights.push({
                id: `approved_match_${tIdx}_${i}`,
                index: tIdx + 1,
                target: targetStr,
                box,
                boxes: [box],
                isMatch: true,
                isError: false,
                category: 'Approved Word Match',
                details: `Approved ISI Match: "${targetStr}" matches approved Word master`,
                expected: targetStr,
                found: targetStr,
              });
            }
            break;
          }
        }
      }
    });
  }

  return highlights;
}

/**
 * Detects visual pixel/color differences between Canvas A (Staging) and Canvas B (Composite)
 */
function detectColorDifferences(canvasA, canvasB, existingHighlights, dpr) {
  if (!canvasA || !canvasB) return [];
  if (canvasA.width === 0 || canvasB.width === 0) return [];

  try {
    const width = Math.min(canvasA.width, canvasB.width);
    const height = Math.min(canvasA.height, canvasB.height);
    if (width <= 0 || height <= 0) return [];

    const ctxA = canvasA.getContext('2d');
    const ctxB = canvasB.getContext('2d');
    if (!ctxA || !ctxB) return [];

    const imgA = ctxA.getImageData(0, 0, width, height);
    const imgB = ctxB.getImageData(0, 0, width, height);
    const dataA = imgA.data;
    const dataB = imgB.data;

    const blockSize = Math.max(16, Math.round(20 * dpr));
    const diffBlocks = [];

    for (let y = 0; y < height - blockSize; y += blockSize) {
      for (let x = 0; x < width - blockSize; x += blockSize) {
        const cx = x + Math.floor(blockSize / 2);
        const cy = y + Math.floor(blockSize / 2);
        const idx = (cy * width + cx) * 4;

        const rDiff = Math.abs(dataA[idx] - dataB[idx]);
        const gDiff = Math.abs(dataA[idx + 1] - dataB[idx + 1]);
        const bDiff = Math.abs(dataA[idx + 2] - dataB[idx + 2]);
        const totalDiff = rDiff + gDiff + bDiff;

        // Distinct color shift
        if (totalDiff > 85) {
          const cssX = x / dpr;
          const cssY = y / dpr;
          const cssW = blockSize / dpr;
          const cssH = blockSize / dpr;

          // Check if already covered by an existing text discrepancy
          const overlaps = existingHighlights.some((hl) => {
            const boxes = hl.boxes && hl.boxes.length > 0 ? hl.boxes : (hl.box ? [hl.box] : []);
            return boxes.some(
              (bx) =>
                cssX < bx.x + bx.w + 8 &&
                cssX + cssW > bx.x - 8 &&
                cssY < bx.y + bx.h + 8 &&
                cssY + cssH > bx.y - 8
            );
          });

          if (!overlaps) {
            diffBlocks.push({ x: cssX, y: cssY, w: cssW, h: cssH });
          }
        }
      }
    }

    if (diffBlocks.length === 0) return [];

    // Cluster neighboring blocks
    const clusters = [];
    diffBlocks.forEach((block) => {
      let merged = false;
      for (const cl of clusters) {
        if (
          block.x < cl.x + cl.w + 24 &&
          block.x + block.w > cl.x - 24 &&
          block.y < cl.y + cl.h + 24 &&
          block.y + block.h > cl.y - 24
        ) {
          const minX = Math.min(cl.x, block.x);
          const minY = Math.min(cl.y, block.y);
          const maxX = Math.max(cl.x + cl.w, block.x + block.w);
          const maxY = Math.max(cl.y + cl.h, block.y + block.h);
          cl.x = minX;
          cl.y = minY;
          cl.w = maxX - minX;
          cl.h = maxY - minY;
          cl.count++;
          merged = true;
          break;
        }
      }
      if (!merged) {
        clusters.push({ ...block, count: 1 });
      }
    });

    return clusters
      .filter((cl) => cl.count >= 2)
      .map((cl, i) => {
        const box = {
          x: Math.round(cl.x - 2),
          y: Math.round(cl.y - 2),
          w: Math.round(cl.w + 4),
          h: Math.round(cl.h + 4),
        };
        return {
          id: `col_diff_${i + 1}`,
          index: existingHighlights.length + i + 1,
          box,
          boxes: [box],
          category: 'Color Mismatch',
          isColorDiff: true,
          discrepancy: {
            id: `col_diff_${i + 1}`,
            category: 'Color Mismatch',
            type: 'color_shift',
            severity: 'high',
            expected: 'Original Staging Color',
            found: 'Altered Color / Visual Tint',
            details: 'Visual Color Discrepancy: Visual element or color tint differs from Staging baseline standard.',
          },
          expected: 'Original Staging Color',
          found: 'Altered Color / Visual Tint',
          details: 'Visual Color Discrepancy: Visual element or color tint differs from Staging baseline standard.',
        };
      });
  } catch (err) {
    console.warn('[PdfVisualViewer] Color diff check failed:', err);
    return [];
  }
}

export default function PdfVisualViewer({
  file,
  pdfUrl,
  imageSrc,
  title = 'Document',
  subtitle,
  badge = 'Reference',
  badgeColor = 'emerald', // 'emerald' | 'rose' | 'indigo'
  isAuditTarget = false,
  isWordToPdf = false,
  isIsiComparison = false,
  isiLineResults = [],
  scale = 1.0,
  pageNumber = 1,
  onPageChange,
  onTotalPagesChange,
  scrollRef,
  onScroll,
  discrepancies = [],
  matchingTokens = [],
  selectedDiscrepancyId = null,
  onOpenComment,
  onRenderSuccess,
  canvasRefCallback,
  baselineCanvasRef,
}) {
  const canvasRef = useRef(null);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pageHighlights, setPageHighlights] = useState([]);
  const [selectedError, setSelectedError] = useState(null);
  const [highlightFilter, setHighlightFilter] = useState('all'); // 'all' | 'errors' | 'matches'
  const [copiedText, setCopiedText] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });

  // STRICT PDF CHECK: If pdfUrl or a PDF file exists, ALWAYS treat as PDF!
  const hasPdfSource = !!(
    pdfUrl ||
    (file && (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf')))
  );
  const isImageMode = !hasPdfSource && (!!imageSrc || (file && file.type?.startsWith('image/')));

  // Sync selected discrepancy from parent if provided
  useEffect(() => {
    if (selectedDiscrepancyId && discrepancies && discrepancies.length > 0) {
      const match = discrepancies.find((d) => d.id === selectedDiscrepancyId);
      if (match) {
        setSelectedError(match);
      }
    }
  }, [selectedDiscrepancyId, discrepancies]);

  // Master safety watchdog: ensure loading spinner is ALWAYS dismissed within 3s
  useEffect(() => {
    const masterTimer = setTimeout(() => {
      setLoading(false);
    }, 3000);
    return () => clearTimeout(masterTimer);
  }, [file, pdfUrl, imageSrc]);

  // Load PDF Document
  useEffect(() => {
    let isCancelled = false;
    if (isImageMode) {
      setLoading(false);
      return;
    }

    // Prioritize direct File/Blob object (avoids expired blob URLs and cross-origin issues)
    const primarySource = (file instanceof Blob || file instanceof File) ? file : (pdfUrl || file);
    const fallbackSource = (primarySource === file) ? pdfUrl : file;

    if (!primarySource && !fallbackSource) {
      setLoading(false);
      return;
    }

    async function loadPdf() {
      try {
        setLoading(true);
        setError(null);

        async function extractUint8(src) {
          if (!src) return null;
          if (src instanceof Blob || src instanceof File) {
            const ab = await src.arrayBuffer();
            return new Uint8Array(ab);
          }
          if (src instanceof Uint8Array) return src;
          if (src instanceof ArrayBuffer) return new Uint8Array(src);
          if (typeof src === 'string') {
            if (src.startsWith('data:') || src.includes(';base64,')) {
              return toUint8Array(src);
            }
            if (src.startsWith('blob:') || src.startsWith('http://') || src.startsWith('https://')) {
              try {
                const resp = await fetch(src);
                if (resp.ok) {
                  const ab = await resp.arrayBuffer();
                  return new Uint8Array(ab);
                }
              } catch (e) {
                console.warn('[PdfVisualViewer] blob URL fetch failed, trying next source:', e);
              }
            }
          }
          return null;
        }

        let doc = null;
        let lastError = null;

        // Collect all potential PDF sources: primarySource, fallbackSource, file, pdfUrl
        const candidates = [primarySource, fallbackSource, file, pdfUrl].filter(Boolean);
        const uniqueCandidates = [...new Set(candidates)];

        for (const src of uniqueCandidates) {
          try {
            let loadingTask = null;
            const uint8 = await extractUint8(src);
            if (uint8 && uint8.length > 0) {
              loadingTask = pdfjsLib.getDocument({ data: uint8.slice() });
            } else if (typeof src === 'string' && src.trim()) {
              loadingTask = pdfjsLib.getDocument({ url: src });
            }

            if (loadingTask) {
              doc = await loadingTask.promise;
              if (doc) break;
            }
          } catch (loadErr) {
            console.warn('[PdfVisualViewer] Source candidate load failed, trying next candidate:', loadErr);
            lastError = loadErr;
          }
        }

        if (!doc) {
          if (imageSrc) {
            setPdfDoc(null);
            setLoading(false);
            return;
          }
          throw lastError || new Error('No readable document source available.');
        }

        if (isCancelled) return;

        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        if (onTotalPagesChange) {
          onTotalPagesChange(doc.numPages);
        }
      } catch (err) {
        if (!isCancelled) {
          console.warn('[PdfVisualViewer] PDF Load error or timeout:', err);
          if (imageSrc) {
            setPdfDoc(null);
          } else {
            setError(err.message || 'Failed to load document preview.');
          }
          setLoading(false);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    loadPdf();

    return () => {
      isCancelled = true;
    };
  }, [file, pdfUrl, isImageMode]);

  // Render Page to Canvas and Compute In-Place Discrepancy Highlights
  const renderTaskRef = useRef(null);

  useEffect(() => {
    let isCancelled = false;

    if (isImageMode || !pdfDoc || !canvasRef.current) {
      setLoading(false);
      return;
    }

    // Safety watchdog: ensure loading overlay clears after 2.5s maximum to prevent stuck spinner
    const watchdogTimer = setTimeout(() => {
      if (!isCancelled) {
        setLoading(false);
      }
    }, 2500);

    async function render() {
      try {
        setLoading(true);

        // Cancel previous render task if still active
        if (renderTaskRef.current) {
          try {
            renderTaskRef.current.cancel();
          } catch (_) {}
          renderTaskRef.current = null;
        }

        const safePageNum = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
        const page = await pdfDoc.getPage(safePageNum);
        if (isCancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Use high-DPI scaling for sharp typography & graphics
        const dpr = Math.max(window.devicePixelRatio || 1, 1.5);
        const viewport = page.getViewport({ scale: scale * dpr });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const cssW = viewport.width / dpr;
        const cssH = viewport.height / dpr;
        canvas.style.width = `${cssW}px`;
        canvas.style.height = `${cssH}px`;
        setCanvasDimensions({ width: cssW, height: cssH });

        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const currentRenderTask = page.render({
          canvasContext: ctx,
          viewport,
        });
        renderTaskRef.current = currentRenderTask;

        await currentRenderTask.promise;
        renderTaskRef.current = null;
        clearTimeout(watchdogTimer);

        if (isCancelled) return;

        setLoading(false);

        // Notify parent of canvas reference for color diffing
        if (canvasRefCallback) {
          canvasRefCallback(canvas);
        }

        if (onRenderSuccess) {
          try {
            const dataUrl = canvas.toDataURL('image/png');
            onRenderSuccess({
              dataUrl,
              pageNumber: safePageNum,
              width: cssW,
              height: cssH,
            });
          } catch (e) {
            console.warn('[PdfVisualViewer] toDataURL error:', e);
          }
        }

        // HIGHLIGHT CALCULATION: Only on Slide B (Audit Target)
        // Slide A (Staging) remains 100% clean and pristine!
        if (isAuditTarget) {
          try {
            const textContent = await page.getTextContent();
            if (isCancelled) return;

            // 1. Text & Formatting discrepancy bounding boxes
            const textHighlights = computePageHighlights(
              textContent.items,
              viewport,
              discrepancies,
              matchingTokens,
              dpr,
              isWordToPdf,
              isIsiComparison,
              isiLineResults
            );

            // 2. Color difference detection between Baseline (Staging) & Revision (Composite)
            // (Skipped in ISI mode to prevent false color shifts on promotional graphics)
            let colorHighlights = [];
            if (!isIsiComparison && baselineCanvasRef?.current) {
              colorHighlights = detectColorDifferences(
                baselineCanvasRef.current,
                canvas,
                textHighlights,
                dpr
              );
            }

            const combinedHighlights = [...textHighlights, ...colorHighlights];
            setPageHighlights(combinedHighlights);
          } catch (err) {
            console.warn('[PdfVisualViewer] Highlight calculation error:', err);
          }
        } else {
          // Slide A master standard: clean slate
          setPageHighlights([]);
        }
      } catch (err) {
        clearTimeout(watchdogTimer);
        if (err?.name === 'RenderingCancelledException') {
          return;
        }
        if (!isCancelled) {
          console.error('[PdfVisualViewer] Render error:', err);
          setError(err.message || 'Failed to render PDF page.');
          setLoading(false);
        }
      } finally {
        if (!isCancelled) {
          setLoading(false);
        }
      }
    }

    render();

    return () => {
      isCancelled = true;
      clearTimeout(watchdogTimer);
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch (_) {}
        renderTaskRef.current = null;
      }
    };
  }, [pdfDoc, pageNumber, scale, isImageMode, isAuditTarget, discrepancies, matchingTokens, isIsiComparison, isiLineResults]);

  const handleCopySnippet = (snippet) => {
    navigator.clipboard.writeText(snippet);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1800);
  };

  return (
    <div className="flex flex-col h-full rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden">
      {/* Slide Header */}
      <div
        className={`px-4 py-3 text-white flex items-center justify-between border-b ${
          isAuditTarget
            ? 'bg-gradient-to-r from-indigo-900 via-purple-950 to-indigo-900 border-indigo-700'
            : 'bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-slate-700'
        }`}
      >
        <div className="flex items-center gap-2.5 overflow-hidden">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-bold uppercase tracking-wide border ${
              isAuditTarget
                ? 'bg-purple-500/30 text-purple-200 border-purple-400/40'
                : 'bg-indigo-500/30 text-indigo-200 border-indigo-400/40'
            }`}
          >
            {badge}
          </span>
          <span className="font-semibold text-sm truncate" title={title}>
            {title}
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={`text-[11px] font-mono px-2.5 py-0.5 rounded border font-bold ${
              isAuditTarget
                ? 'text-rose-200 bg-rose-950/70 border-rose-500/40'
                : 'text-emerald-300 bg-emerald-950/70 border-emerald-500/40'
            }`}
          >
            {subtitle || (isAuditTarget ? '⚠ Composite Audit Target' : '✓ Staging Master')}
          </span>
        </div>
      </div>

      {/* Sub-toolbar: Informative Context */}
      <div
        className={`px-4 py-2 border-b flex flex-wrap items-center justify-between text-xs gap-2 ${
          isAuditTarget
            ? 'bg-rose-50/70 border-rose-100 text-rose-900 font-medium'
            : 'bg-emerald-50/80 border-emerald-100 text-emerald-900 font-medium'
        }`}
      >
        <div className="flex items-center gap-2">
          {isAuditTarget ? (
            <>
              <span className="flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping"></span>
              <span>
                <strong>Composite Revision View:</strong> Original colors, banners & layout. Discrepancies in red, approved master matches in green.
              </span>
            </>
          ) : (
            <>
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span>
                <strong>Staging Master View:</strong> Authentic original layout, banners & photos. Clean reference standard.
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {isAuditTarget && (
            <div className="flex items-center gap-1 bg-white/90 border border-slate-200 rounded-lg p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setHighlightFilter('all')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  highlightFilter === 'all'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Overlays
              </button>
              <button
                type="button"
                onClick={() => setHighlightFilter('errors')}
                className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
                  highlightFilter === 'errors'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-rose-700 hover:bg-rose-100'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                Red Errors ({discrepancies.length})
              </button>
              <button
                type="button"
                onClick={() => setHighlightFilter('matches')}
                className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
                  highlightFilter === 'matches'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Green Matches ({pageHighlights.filter((h) => h.isMatch).length || matchingTokens.length})
              </button>
            </div>
          )}

          {totalPages > 1 && (
            <div className="flex items-center gap-1.5 bg-white/80 border border-slate-200 rounded-lg px-2 py-0.5 text-[11px] font-bold text-slate-700">
              <button
                onClick={() => onPageChange && onPageChange(Math.max(1, pageNumber - 1))}
                disabled={pageNumber <= 1}
                className="hover:text-indigo-600 disabled:opacity-40 cursor-pointer"
                title="Previous Page"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span>
                Page {pageNumber} of {totalPages}
              </span>
              <button
                onClick={() => onPageChange && onPageChange(Math.min(totalPages, pageNumber + 1))}
                disabled={pageNumber >= totalPages}
                className="hover:text-indigo-600 disabled:opacity-40 cursor-pointer"
                title="Next Page"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Viewport with Synchronized Scrolling */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 h-[620px] overflow-auto bg-slate-100/80 p-4 select-text"
      >
        {loading && !pdfDoc && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/85 backdrop-blur-xs z-20">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 mb-2">
              <FileText className="h-6 w-6" />
            </div>
            <p className="text-xs font-bold text-indigo-900">Rendering visual document layout...</p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Preserving original photos, banners, and typography
            </p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center p-8 text-center text-rose-700 bg-rose-50 rounded-xl border border-rose-200 m-4">
            <AlertCircle className="h-8 w-8 mb-2 text-rose-500" />
            <h4 className="text-sm font-bold">Document Preview Notice</h4>
            <p className="text-xs text-rose-600 mt-1 max-w-sm">{error}</p>
          </div>
        )}

        {/* Content Container: Canvas with In-Place Bounding Box Overlay */}
        <div className="flex justify-center items-start min-h-full py-2">
          {isImageMode ? (
            <img
              src={imageSrc || (file ? URL.createObjectURL(file) : '')}
              alt={title}
              className="max-w-full h-auto rounded-lg shadow-md border border-slate-300 bg-white"
              style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}
              onLoad={() => setLoading(false)}
              onError={() => setLoading(false)}
            />
          ) : (
            <div className="relative inline-block mx-auto">
              <canvas
                ref={canvasRef}
                className="rounded-lg shadow-md border border-slate-300 bg-white block"
              />

              {/* IN-PLACE VISUAL BOUNDING BOX OVERLAY (Slide B Only) */}
              {isAuditTarget && pageHighlights.length > 0 && (
                <div
                  className="absolute inset-0 pointer-events-none"
                  style={{
                    width: `${canvasDimensions.width}px`,
                    height: `${canvasDimensions.height}px`,
                  }}
                >
                  {pageHighlights
                    .filter((hl) => {
                      if (highlightFilter === 'errors') return !hl.isMatch;
                      if (highlightFilter === 'matches') return !!hl.isMatch;
                      return true;
                    })
                    .map((hl) => {
                      const isMatch = !!hl.isMatch;
                      const isSelected = !!(
                        (selectedError?.id && hl.discrepancy?.id && selectedError.id === hl.discrepancy.id) ||
                        (selectedError?.id && hl.id && selectedError.id === hl.id)
                      );

                      const boxes =
                        hl.boxes && hl.boxes.length > 0
                          ? hl.boxes
                          : hl.box
                          ? [hl.box]
                          : [];

                      return (
                        <React.Fragment key={hl.id}>
                          {boxes.map((box, bIdx) => (
                            <div
                              key={`${hl.id}_b${bIdx}`}
                              style={{
                                left: `${box.x}px`,
                                top: `${box.y}px`,
                                width: `${Math.max(box.w, 14)}px`,
                                height: `${Math.max(box.h, 12)}px`,
                                mixBlendMode: 'multiply',
                              }}
                              className={`absolute pointer-events-auto cursor-pointer rounded-xs transition-colors duration-150 group ${
                                isMatch
                                  ? isSelected
                                    ? 'border-b-2 border-emerald-600 bg-emerald-300/50 ring-1 ring-emerald-500 z-20'
                                    : 'border-b border-emerald-500/70 bg-emerald-200/35 hover:bg-emerald-300/45 z-10'
                                  : isSelected
                                  ? 'border-b-2 border-rose-600 bg-rose-300/55 ring-1 ring-rose-500 z-20'
                                  : hl.isMissingWord
                                  ? 'border-b-2 border-dashed border-rose-600 bg-rose-200/40 z-15'
                                  : hl.isColorDiff
                                  ? 'border-b border-amber-500 bg-amber-200/35 hover:bg-amber-300/45 z-10'
                                  : 'border-b-2 border-rose-500 bg-rose-200/35 hover:bg-rose-300/45 z-10'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedError(isSelected ? null : (hl.discrepancy || hl));
                              }}
                              title={
                                hl.isMissingWord
                                  ? `⚠ Missing in PDF: "${hl.target}"`
                                  : isMatch
                                  ? `✓ Approved ISI Match: "${hl.target}"`
                                  : `#${hl.index} ${hl.category}: ${hl.details}`
                              }
                            >
                              {/* Error / Discrepancy indicator badge:
                                  - For matches: NEVER show badge over text so words and lines remain 100% visible!
                                  - For errors: show subtle index tag in top-right corner on hover or selection!
                              */}
                              {!isMatch && (
                                <span
                                  className={`absolute -top-3 right-0 flex items-center justify-center h-4 px-1.5 rounded-full text-white text-[9px] font-bold shadow-xs whitespace-nowrap pointer-events-none transition-opacity ${
                                    isSelected
                                      ? 'opacity-100 bg-rose-600 ring-1 ring-white'
                                      : hl.isMissingWord
                                      ? 'opacity-100 bg-rose-700 ring-1 ring-white'
                                      : hl.isColorDiff
                                      ? 'opacity-90 bg-amber-600'
                                      : 'opacity-0 group-hover:opacity-100 bg-rose-600'
                                  }`}
                                >
                                  {hl.isMissingWord ? `^ Missing` : `#${hl.index}`}
                                </span>
                              )}

                              {/* Hover Tooltip Card */}
                              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs p-2.5 rounded-xl bg-slate-900/95 text-white text-[11px] shadow-2xl z-50 pointer-events-none backdrop-blur-xs border border-slate-700 animate-fadeIn">
                                <div className="flex items-center gap-1.5 font-bold text-rose-300">
                                  <span
                                    className={`rounded px-1.5 py-0.5 text-[9px] uppercase border font-extrabold ${
                                      isMatch
                                        ? 'bg-emerald-500/30 text-emerald-200 border-emerald-400/30'
                                        : 'bg-rose-500/30 text-rose-300 border-rose-400/30'
                                    }`}
                                  >
                                    {isMatch ? '✓ Approved ISI Match' : `#${hl.index} ${hl.category}`}
                                  </span>
                                  {hl.isColorDiff && (
                                    <span className="rounded bg-amber-500/30 text-amber-200 px-1 py-0.5 text-[8px] uppercase border border-amber-400/30">
                                      Visual Color
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-200 mt-1 leading-snug line-clamp-2">
                                  {isMatch
                                    ? `Approved text matches Word master: "${hl.target}"`
                                    : hl.details}
                                </div>
                                <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1.5 pt-1 border-t border-slate-800">
                                  <span>
                                    {isMatch ? (
                                      <>Status: <strong className="text-emerald-300">Verified Master</strong></>
                                    ) : (
                                      <>Expected: <strong className="text-emerald-300">{hl.expected}</strong></>
                                    )}
                                  </span>
                                  <span className="ml-2 font-bold text-indigo-300">Click to inspect</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </React.Fragment>
                      );
                    })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* COMPOSITE AUDIT FOOTER: Interactive Discrepancy Spotlight Bar */}
      {isAuditTarget && (
        <div className="border-t border-slate-200 bg-slate-50 p-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 flex-wrap">
              <Sparkles className="h-3.5 w-3.5 text-rose-600" />
              <span>Composite Discrepancy Inspector</span>
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 text-rose-900 border border-rose-300 px-1.5 py-0.5 text-[10px] font-bold">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-600" />
                {discrepancies.length} Red Errors
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 text-emerald-900 border border-emerald-300 px-1.5 py-0.5 text-[10px] font-bold">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                {pageHighlights.filter((h) => h.isMatch).length || matchingTokens.length} Green Matches
              </span>
              {pageHighlights.filter((h) => h.isColorDiff).length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold">
                  {pageHighlights.filter((h) => h.isColorDiff).length} Color Shifts
                </span>
              )}
            </div>
            {discrepancies.length === 0 && pageHighlights.filter((h) => !h.isMatch).length === 0 ? (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                ✓ 100% Match with Staging
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                Click red marker on page or pill below to inspect & comment
              </span>
            )}
          </div>


          {/* Quick Discrepancy Pills */}
          {(discrepancies.length > 0 || pageHighlights.length > 0) && (
            <div className="flex gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
              {discrepancies.slice(0, 10).map((err, idx) => {
                const isSelected = selectedError?.id === err.id;
                const catColor =
                  err.category === 'Spacing'
                    ? 'bg-sky-50 border-sky-300 text-sky-900'
                    : err.category === 'Punctuation'
                    ? 'bg-pink-50 border-pink-300 text-pink-900'
                    : err.category === 'Numbers & Units'
                    ? 'bg-rose-50 border-rose-300 text-rose-900'
                    : err.category === 'Formatting (Bold / Italic)'
                    ? 'bg-purple-50 border-purple-300 text-purple-900'
                    : 'bg-amber-50 border-amber-300 text-amber-900';

                return (
                  <button
                    key={err.id || idx}
                    onClick={() => setSelectedError(isSelected ? null : err)}
                    className={`shrink-0 flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs transition shadow-xs cursor-pointer ${catColor} ${
                      isSelected ? 'ring-2 ring-indigo-500 font-bold' : 'hover:opacity-90'
                    }`}
                  >
                    <span className="font-mono text-[10px] font-bold opacity-70">#{idx + 1}</span>
                    <span className="font-semibold truncate max-w-[150px]">
                      {err.category}: {err.found || err.details}
                    </span>
                  </button>
                );
              })}
              {discrepancies.length > 10 && (
                <span className="shrink-0 flex items-center text-[11px] text-slate-400 font-medium px-2">
                  +{discrepancies.length - 10} more in table
                </span>
              )}
            </div>
          )}

          {/* Active Discrepancy Spotlight Card */}
          {selectedError && (
            <div className="mt-2 rounded-xl border-2 border-rose-200 bg-white p-3.5 shadow-md text-xs space-y-2.5 animate-fadeIn">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-rose-100 text-rose-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider">
                      {selectedError.category}
                    </span>
                    <span className="font-bold text-slate-900 text-sm">
                      {selectedError.type?.replace(/_/g, ' ') || 'Discrepancy Details'}
                    </span>
                  </div>
                  <p className="mt-1 text-slate-600 leading-relaxed font-medium">
                    {selectedError.details}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedError(null)}
                  className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1 cursor-pointer"
                  title="Close Inspector Card"
                >
                  ✕
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3 text-[11px] bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                <div className="space-y-0.5">
                  <span className="text-emerald-700 block font-bold uppercase text-[9px] tracking-wider">
                    Expected (Staging Master):
                  </span>
                  <span className="font-semibold text-emerald-900 break-words">
                    {selectedError.expected}
                  </span>
                </div>
                <div className="space-y-0.5">
                  <span className="text-rose-700 block font-bold uppercase text-[9px] tracking-wider">
                    Found in Composite Target:
                  </span>
                  <span className="font-bold text-rose-900 break-words">
                    {selectedError.found}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  onClick={() => handleCopySnippet(selectedError.found || selectedError.details)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition cursor-pointer"
                >
                  {copiedText ? (
                    <Check className="h-3.5 w-3.5 text-emerald-600" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedText ? 'Copied' : 'Copy Text'}
                </button>

                {onOpenComment && (
                  <button
                    onClick={() => onOpenComment(selectedError)}
                    className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition shadow-xs cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5" />
                    Add Note on this Error
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
