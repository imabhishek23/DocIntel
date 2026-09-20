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

function levenshteinDist(a, b) {
  const m = a.length, n = b.length;
  const d = [];
  for (let i = 0; i <= m; i++) d[i] = [i];
  for (let j = 0; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] : Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + 1);
    }
  }
  return d[m][n];
}

const STOP_WORDS_SET = new Set(['to', 'if', 'is', 'the', 'at', 'or', 'of', 'in', 'it', 'on', 'as', 'by', 'an', 'be', 'for', 'up', 'due', 'and', 'all', 'use', 'we', 'he', 'so', 'do']);

function isOcrWordMatch(normA, normB) {
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const negationWords = new Set(['no', 'not', 'none', 'never', 'without']);
  if (negationWords.has(normA) !== negationWords.has(normB)) return false;

  const negationPrefixes = ['contra', 'non', 'anti', 'dis', 'un'];
  for (const p of negationPrefixes) {
    if ((normA.startsWith(p) && !normB.startsWith(p)) || (normB.startsWith(p) && !normA.startsWith(p))) {
      return false;
    }
  }

  if (/^\d+$/.test(normA) || /^\d+$/.test(normB)) {
    if (normA === 'to' && /^(?:10|0|o|lo|te)$/i.test(normB)) return true;
    return false;
  }

  if (STOP_WORDS_SET.has(normA)) {
    if (normA === 'to' && /^(?:10|0|o|lo|te)$/i.test(normB)) return true;
    if (normA === 'if' && /^(?:ff|f|ti)$/i.test(normB)) return true;
    if (normA === 'is' && /^(?:i|ts|s|ia)$/i.test(normB)) return true;
    if (normA === 'the' && /^(?:th|ha|te|tho)$/i.test(normB)) return true;
    if (normA === 'at' && /^(?:a|et)$/i.test(normB)) return true;
    if (normA === 'up' && /^(?:p|u|ub)$/i.test(normB)) return true;
    if (normA === 'due' && /^(?:de|du|ue|dve)$/i.test(normB)) return true;
    if (normA === 'and' && /^(?:nd|amd|ane|an)$/i.test(normB)) return true;
    if ((normA === 'or' && normB === 'of') || (normA === 'of' && normB === 'or')) return true;
    if (levenshteinDist(normA, normB) <= 1) return true;
  }

  if (normA.length === 2 && normB.length === 1 && normA.includes(normB)) return true;
  if (normA.length === 1 && normB.length === 2 && normB.includes(normA)) return true;

  if (normA.length <= 2 && normB.length <= 2) return normA === normB;

  if (normA.length === 3 || normB.length === 3) {
    if (Math.abs(normA.length - normB.length) <= 1 && levenshteinDist(normA, normB) <= 1) return true;
  }

  // HIV and HIV-1 equivalence (medical acronyms)
  if ((normA === 'hiv1' && normB === 'hiv') || (normA === 'hiv' && normB === 'hiv1')) return true;

  // Negation words
  if ((normA === 'no' || normB === 'no') && normA !== normB) return false;
  if (normA === 'not') {
    if (/^(?:nol|ot|nt|no)$/i.test(normB)) return true;
  }

  // Length 4-5 words (e.g. 'with' vs 'wih', 'from' vs 'fom', 'sleep' vs 'sloop', 'safer' vs 'sar', 'while' vs 'whi')
  if (normA.length <= 5 && normB.length <= 5) {
    if (levenshteinDist(normA, normB) <= 2) return true;
  }

  // Medical abbreviations & Latin phrases (e.g. 'e.g.' -> 'eg', OCR noise: '¢9', 'e9', 'c9', '9', 'cg')
  if (normA === 'eg' && /^(?:eg|¢g|cg|e9|9|c9|¢9)$/i.test(normB)) return true;
  if (normB === 'eg' && /^(?:eg|¢g|cg|e9|9|c9|¢9)$/i.test(normA)) return true;

  // Length >= 6 words (e.g. 'adverse' vs 'acvarso', 'adherence' vs 'acharanca', 'limited' vs 'imited', 'appetite' vs 'petite')
  if (normA.length >= 6 && normB.length >= 3) {
    if (normA.startsWith(normB) && normB.length >= 4) return true;
    if (normB.startsWith(normA) && normA.length >= 4) return true;
    if (normA.endsWith(normB) && normB.length >= 4) return true;
    if (normB.endsWith(normA) && normA.length >= 4) return true;
    const maxLen = Math.max(normA.length, normB.length);
    const dist = levenshteinDist(normA, normB);
    if (maxLen >= 10 && dist <= 4) return true;
    if (maxLen >= 7 && dist <= 3) return true;
    if (maxLen >= 6 && dist <= 2) return true;
    const similarity = (maxLen - dist) / maxLen;
    if (similarity >= 0.50) return true;
  }

  return false;
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
  isiLineResults = [],
  safePageNum = 1
) {
  const hasItems = items && Array.isArray(items) && items.length > 0;
  const hasIsiLines = isIsiComparison && Array.isArray(isiLineResults) && isiLineResults.length > 0;

  if (!hasItems && !hasIsiLines) {
    return [];
  }

  // Filter only text items that have valid transform arrays (PDF.js can include TextMarkedContent without transform)
  const validItems = hasItems
    ? items.filter((it) => it && Array.isArray(it.transform) && it.transform.length >= 6)
    : [];

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

  // ── STRICT ISI LINE-BY-LINE VISUAL HIGHLIGHTING (Slide B Target Document) ──
  const isIsiTarget = isIsiComparison || (Array.isArray(isiLineResults) && isiLineResults.length > 0);
  const pageBoxesFromIsi = isIsiTarget
    ? (isiLineResults || []).filter(
        (l) => (l.page || l.box?.page || 1) === (safePageNum || 1) && l.box
      )
    : [];

  const computeDirectIsiHighlights = () => {
    const directHighlights = [];
    for (let idx = 0; idx < pageBoxesFromIsi.length; idx++) {
      const lr = pageBoxesFromIsi[idx];
      const rect = viewport.convertToViewportRectangle([
        lr.box.x,
        lr.box.y,
        lr.box.x + lr.box.w,
        lr.box.y + lr.box.h,
      ]);
      const cssBox = {
        x: Math.round(Math.min(rect[0], rect[2]) / dpr),
        y: Math.round(Math.min(rect[1], rect[3]) / dpr),
        w: Math.max(10, Math.round(Math.abs(rect[2] - rect[0]) / dpr)),
        h: Math.max(12, Math.round(Math.abs(rect[3] - rect[1]) / dpr)),
      };

      // User Requirement: Check words/sentences only, plus color mismatches if colors differ
      const realWordErrors = (lr.wordErrors || []).filter(
        (we) =>
          we.type === 'number' ||
          we.type === 'word_changed' ||
          we.type === 'extra_word' ||
          we.type === 'missing_word' ||
          we.type === 'color' ||
          we.type === 'color_mismatch'
      );
      const isMatch = lr.color === 'green' && realWordErrors.length === 0;
      const hasWordErrors = realWordErrors.length > 0;

      if (isMatch) {
        // User Requirement: "if line is complte match thenno need to mark anything... dont hight if everthuing is oky"
        // Complete matching line: leave completely clean and unmarked!
        continue;
      } else if (hasWordErrors) {
        // User Requirement: Do NOT mark the whole line! ONLY mark the specific word discrepancies / color mismatches!
        realWordErrors.forEach((we, wIdx) => {
          const weWord = we.word || we.clean;
          if (!weWord) return;
          const isColorType = we.type === 'color' || we.type === 'color_mismatch';
          const cleanWe = weWord.toLowerCase().replace(/[^a-z0-9]/g, '');
          const cleanExp = (we.expected || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!isColorType && cleanWe && cleanExp) {
            if (cleanWe === cleanExp || isOcrWordMatch(cleanExp, cleanWe)) return;
            const digitsA = (we.expected || '').match(/\d+(?:\.\d+)?/g)?.join('') || '';
            const digitsB = weWord.match(/\d+(?:\.\d+)?/g)?.join('') || '';
            if (digitsA && digitsB && digitsA === digitsB && (cleanExp.includes(cleanWe) || cleanWe.includes(cleanExp))) return;
          }
          const idxInLine = lr.text.toLowerCase().indexOf(weWord.toLowerCase());
          const charW = cssBox.w / (lr.text.length || 1);
          const wordX = idxInLine >= 0 ? Math.round(cssBox.x + idxInLine * charW) : cssBox.x;
          const wordW = Math.max(14, Math.round((weWord.length || 3) * charW));
          const wordBox = {
            x: wordX,
            y: Math.max(0, cssBox.y - 1),
            w: wordW,
            h: cssBox.h + 2,
          };

          const errCategory =
            isColorType
              ? 'Color Mismatch'
              : we.type === 'number'
              ? 'Number Mismatch'
              : we.type === 'missing_word'
              ? 'Missing Word'
              : we.type === 'extra_word'
              ? 'Extra Word'
              : we.type === 'spelling'
              ? 'Spelling Mistake'
              : we.type === 'spacing'
              ? 'Spacing Difference'
              : we.type === 'formatting'
              ? 'Bold / Italic Formatting'
              : we.type === 'capitalization'
              ? 'Capitalization Difference'
              : we.type === 'punctuation_missing' || we.type === 'punctuation'
              ? 'Punctuation Difference'
              : 'Word Mistake';

          const colorIssueMsg = isColorType
            ? (we.issue || `Color Mismatch: Found "${weWord}" in ${we.foundColorName || 'custom color'}, expected ${we.expectedColorName || 'standard (black)'}`)
            : (we.issue || 'Discrepancy');

          directHighlights.push({
            id: `isi_box_word_${lr.lineNum || lr.lineIndex || idx}_${wIdx}`,
            index: lr.lineNum || lr.lineIndex || idx,
            target: weWord,
            box: wordBox,
            boxes: [wordBox],
            isMatch: false,
            isError: true,
            isWordDiscrepancy: true,
            isColorDiff: isColorType,
            color: isColorType ? 'rgba(245, 158, 11, 0.35)' : 'rgba(239, 68, 68, 0.50)',
            borderColor: isColorType ? '#d97706' : '#dc2626',
            comment: colorIssueMsg,
            category: errCategory,
            severity: isColorType ? 'medium' : 'high',
            expected: isColorType ? (we.expectedColorName || we.expected || 'standard (black)') : we.expected,
            found: isColorType ? (we.foundColorName || weWord || 'custom color') : weWord,
            details: colorIssueMsg,
            lineResult: lr,
            discrepancy: {
              id: `isi_box_word_${lr.lineNum || lr.lineIndex || idx}_${wIdx}`,
              category: errCategory,
              type: we.type || (isColorType ? 'color_mismatch' : 'word_mismatch'),
              severity: isColorType ? 'medium' : 'high',
              expected: isColorType ? (we.expectedColorName || we.expected || 'standard (black)') : we.expected,
              found: isColorType ? (we.foundColorName || weWord || 'custom color') : weWord,
              details: colorIssueMsg,
            },
          });
        });
      } else {
        directHighlights.push({
          id: `isi_box_err_${lr.lineNum || lr.lineIndex || idx}`,
          index: lr.lineNum || lr.lineIndex || idx,
          target: lr.text,
          box: cssBox,
          boxes: [cssBox],
          isMatch: false,
          isError: true,
          color: 'rgba(239, 68, 68, 0.38)',
          borderColor: '#dc2626',
          comment: lr.comment || 'Discrepancy / Unapproved Line',
          category: lr.status === 'extra_line' ? 'Extra Line' : 'ISI Discrepancy',
          severity: 'high',
          expected: lr.expected || '',
          found: lr.found || lr.text,
          details: lr.comment || '',
          lineResult: lr,
        });
      }
    }
    return directHighlights;
  };

  // If page is scanned/image-based (fewer than 25 vector text items), use direct OCR bounding boxes
  if (isIsiTarget && itemBoxes.length < 25 && pageBoxesFromIsi.length > 0) {
    const directHls = computeDirectIsiHighlights();
    if (directHls.length > 0) return directHls;
  }

  if (isIsiTarget && itemBoxes.length > 0) {
    // 1. Group rendered PDF text items into distinct visual lines by canvas screen Y coordinates (top-to-bottom)
    const sortedItems = [...itemBoxes]
      .filter((it) => it.cleanStr)
      .sort((a, b) => {
        if (Math.abs(a.y - b.y) <= 4) {
          return a.x - b.x;
        }
        return a.y - b.y; // Top of canvas (y=0) to bottom
      });

    const lineSegments = [];
    let curSegment = [];
    let curY = null;
    let curH = 12;

    for (const it of sortedItems) {
      const lineThreshold = Math.max(4, Math.min(10, (it.h || curH) * 0.65));
      if (curY === null || Math.abs(it.y - curY) > lineThreshold) {
        if (curSegment.length > 0) lineSegments.push(curSegment);
        curSegment = [it];
        curY = it.y;
        curH = it.h;
      } else {
        const prev = curSegment[curSegment.length - 1];
        const gap = it.x - (prev.x + prev.w);
        if (gap > 75) {
          // Significant column gap (>75px): start a new segment on the same baseline!
          lineSegments.push(curSegment);
          curSegment = [it];
        } else {
          curSegment.push(it);
        }
      }
    }
    if (curSegment.length > 0) lineSegments.push(curSegment);

    const pageLines = lineSegments.map((lineItems) => {
      const sorted = [...lineItems].sort((a, b) => a.x - b.x);
      const text = sorted.map((i) => i.str).join(' ').replace(/\s+/g, ' ').trim();
      const minX = Math.min(...sorted.map((m) => m.x));
      const minY = Math.min(...sorted.map((m) => m.y));
      const maxX = Math.max(...sorted.map((m) => m.x + m.w));
      const maxY = Math.max(...sorted.map((m) => m.y + m.h));
      return {
        rawY: lineItems[0].rawY,
        y: minY,
        text,
        clean: text.toLowerCase().replace(/[^a-z0-9]/g, ''),
        lineItems: sorted,
        box: {
          x: Math.round(minX - 1),
          y: Math.round(minY),
          w: Math.round(maxX - minX + 2),
          h: Math.round(maxY - minY),
        },
      };
    });

    const COMPOSITE_NON_ISI_LINE_REGEX =
      /^(?:Subject:|Preheader:|HCP EDUCATIONAL|IMMUNOVA$|AEROVIA$|NUCALA$|BENLYSTA$|FOR PATIENTS WITH|A focused conversation|symptom frequency|Explore a fictional|JORDAN|Works full time|CONSIDER WHETHER|Review exacerbation|EXPLORE (?:THE|MORE|PATIENT)|ADULTS\s*≥|MAY\s+HAVE|RISK\s+FOR|As\s+patients\s+age|decline\s+in|Certain\s+chronic|also\s+be\s+associated|risk\.|ARTHUR|\d+\s+years\s+old|living\s+with\s+diabetes|PATIENT\s+(?:SNAPSHOT|HISTORY)|Active\s+in\s+managing|Has\s+not\s+been|Discusses\s+preventive|Patients\s*≥|DIABETES|Observational\s+studies|some\s+adults\s+with|Educational\s+statement|Inform\s+your\s+PATIENTS|vaccination\s+conversations|SEE\s+EXAMPLES|PRACTICE|For\s+pricing\s+information|VACCINES\s+WAC|This\s+email\s+is\s+intended|STOP\s+OR\s+CHANGE|Trademarks\s+are\s+owned|©\d{4}|Produced\s+in\s+USA|Privacy\s+Notice|Please\s+do\s+not\s+respond|You\s+are\s+receiving|\[Email\s+Vendor|For\s+editorial\s+QA|Not\s+approved\s+promotional|PMUS-CBTEML|DESKTOP$|MOBILE$|APRETUDE\s+HCP\s+PROACT|Variable\s+Manuscript|(?:Magenta|Red|Blue)\s+symbol\s+denotes|Functional\s+Annotations|\d+(?:st|nd|rd|th)-party\s+header|Date:\s*\[|From:\s*ViiV|To:\s*\[|Subject\s+Line:|Preview\s+Text:|Email\s+Vendor\s+Variable|ViiV\s+Healthcare\s+does\s+not\s+control|This\s+is\s+an\s+industry-prepared|ARE\s+YOUR\s+PATIENTS\s+READY|WITHOUT\s+DAILY\s+PILLS|See\s+which\s+PrEP\s+patients|Give\s+them\s+the\s+power|View\s+patient\s+choice|Learn\s+more|View\s+in\s+browser|Apretude\s+cabotegravir|Kindly\s+\+Expand|Mockup\s+HTML|https?:\/\/|TDF\s+option|Staging\s+login|User\s+ID:|Password:|\[no\s+notes\s+on\s+this\s+page\]|-\s*\d+\s*-|In\s+the\s+HPTN|Which\s+PrEP|participants\s+choose|APRETUDE\s+or\s+TRUVADA|\(?TDF\/?(?:I|F)TC\)?|Your\s+patients\s+deserve|choice\s+on\s+how\s+to\s+PrEP|choice\s+data\s+today|It['’]s\s+time\s+to\s+help|patients\s+prioritize\s+HIV|prevention$|Give\s+them\s+the\s+power|HPTN\s+08[34]|HPTN\s*=|View\s+patient\s+choice|Learn\s+more|py$|—y$|i\.\s+be|References:|References\b|Lancotz|Delany|Fichenboun|To\s+report\s+SUSPECTED|VI\s+H[eo]allca|LA77|sun\s+gov|Tis\s+mai\s+tended|Thi\s+ma[il]{2}\s+was|Le[og]a?l\s+Notices|party\s+footer)/i;

    const highlights = [];
    let matchedAnyVectorLine = false;

    for (let pIdx = 0; pIdx < pageLines.length; pIdx++) {
      const pl = pageLines[pIdx];
      const plClean = pl.clean;
      if (!plClean && pl.text !== '•' && pl.text !== '-' && pl.text !== '*') continue;

      // 1. Strict skip for non-ISI marketing lines
      if (COMPOSITE_NON_ISI_LINE_REGEX.test(pl.text) || COMPOSITE_NON_ISI_LINE_REGEX.test(plClean)) {
        continue;
      }

      // 2. Find best matching ISI line result
      let matchedLr = null;
      let bestScore = 0;

      for (let lIdx = 0; lIdx < isiLineResults.length; lIdx++) {
        const lr = isiLineResults[lIdx];
        const lrClean = (lr.text || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        if (!lrClean && lr.text !== '•' && lr.text !== '-' && lr.text !== '*') continue;

        // Case A: Exact clean text match
        if (lrClean === plClean) {
          matchedLr = lr;
          bestScore = 1.0;
          break;
        }

        // Case B: Visual line is wrapped substring of longer statement/line
        if (lrClean.includes(plClean) && plClean.length >= 6) {
          const score = plClean.length / lrClean.length;
          if (score > bestScore) {
            bestScore = score;
            matchedLr = lr;
          }
        }
        // Case C: Statement is substring of visual line
        else if (plClean.includes(lrClean) && lrClean.length >= 6) {
          const score = lrClean.length / plClean.length;
          if (score > bestScore) {
            bestScore = score;
            matchedLr = lr;
          }
        }
        // Case D: High word overlap (sequence matching)
        else if (plClean.length >= 10 && lrClean.length >= 10) {
          const plWords = pl.text.toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 3);
          const lrWords = (lr.text || '').toLowerCase().split(/\s+/).map((w) => w.replace(/[^a-z0-9]/g, '')).filter((w) => w.length >= 3);
          if (plWords.length > 0 && lrWords.length > 0) {
            let overlap = 0;
            for (const pw of plWords) {
              if (lrWords.includes(pw)) overlap++;
            }
            const ratio = overlap / plWords.length;
            if (ratio >= 0.65 && ratio > bestScore) {
              bestScore = ratio;
              matchedLr = lr;
            }
          }
        }
      }

      if (matchedLr) {
        matchedAnyVectorLine = true;
        const safeLineH = Math.min(Math.max(pl.box.h, 12), 36);
        const safeLineBox = { ...pl.box, h: safeLineH };

        // User Requirement: Check words/sentences only, plus color mismatches if colors differ
        const realWordErrors = (matchedLr.wordErrors || []).filter(
          (we) =>
            we.type === 'number' ||
            we.type === 'word_changed' ||
            we.type === 'extra_word' ||
            we.type === 'missing_word' ||
            we.type === 'color' ||
            we.type === 'color_mismatch'
        );
        const hasWordErrors = realWordErrors.length > 0;
        const isMatch = matchedLr.color === 'green' && !hasWordErrors;
        const isLineMatch = matchedLr.color === 'green';

        // Base line highlight:
        // - Complete match -> Leave completely unmarked per user requirement ("dont hight if everthuing is oky")
        // - Mismatches / extra lines -> RED box
        // - Lines with word errors -> Do NOT mark the whole line; only mark the specific localized word errors below
        if (isMatch) {
          // Complete matching line: leave clean and unmarked
        } else if (!isLineMatch) {
          highlights.push({
            id: `isi_line_${matchedLr.lineNum || matchedLr.lineIndex || pIdx}`,
            index: matchedLr.lineNum || matchedLr.lineIndex || pIdx,
            target: pl.text,
            box: safeLineBox,
            boxes: [safeLineBox],
            isMatch: false,
            isError: true,
            color: 'red',
            category: matchedLr.status === 'extra_line' ? 'Extra Line' : 'Line Discrepancy',
            details: matchedLr.comment || 'Discrepancy in line',
            comment: matchedLr.comment || 'Discrepancy in line',
            expected: matchedLr.expected || pl.text,
            found: pl.text,
            isLineDiscrepancy: true,
            isMissingLine: matchedLr.status === 'missing_line',
          });
        } else if (hasWordErrors) {
          // User Requirement: Do NOT mark the entire line with a green/red box! Only mark the specific localized word errors below.
        }

        // Word error localized highlights inside this visual line
        if (hasWordErrors) {
          realWordErrors.forEach((we, wIdx) => {
            const weWord = (we.word || '').trim();
            if (!weWord) return;

            let wordBox = null;
            const isColorType = we.type === 'color' || we.type === 'color_mismatch';
            const cleanWeWord = weWord.toLowerCase().replace(/[^a-z0-9]/g, '');
            const cleanExpWord = (we.expected || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!isColorType && cleanWeWord && cleanExpWord) {
              if (cleanWeWord === cleanExpWord || isOcrWordMatch(cleanExpWord, cleanWeWord)) return;
              const digitsA = (we.expected || '').match(/\d+(?:\.\d+)?/g)?.join('') || '';
              const digitsB = weWord.match(/\d+(?:\.\d+)?/g)?.join('') || '';
              if (digitsA && digitsB && digitsA === digitsB && (cleanExpWord.includes(cleanWeWord) || cleanWeWord.includes(cleanExpWord))) return;
            }

            if (pl.lineItems && pl.lineItems.length > 0) {
              for (const item of pl.lineItems) {
                const itemStr = (item.str || '').trim();
                const cleanItemStr = itemStr.toLowerCase().replace(/[^a-z0-9]/g, '');
                if (!isColorType && cleanItemStr && cleanExpWord && (cleanItemStr === cleanExpWord || isOcrWordMatch(cleanExpWord, cleanItemStr))) return;

                if (itemStr.toLowerCase() === weWord.toLowerCase() || (cleanWeWord && cleanItemStr === cleanWeWord)) {
                  wordBox = {
                    x: Math.round(item.x - 1),
                    y: Math.round(item.y - 1),
                    w: Math.max(14, Math.round(item.w + 2)),
                    h: Math.min(32, Math.max(12, Math.round(item.h + 2))),
                  };
                  break;
                }

                const idxInItem = itemStr.toLowerCase().indexOf(weWord.toLowerCase());
                if (idxInItem >= 0) {
                  const charW = item.w / (itemStr.length || 1);
                  wordBox = {
                    x: Math.round(item.x + idxInItem * charW - 1),
                    y: Math.round(item.y - 1),
                    w: Math.max(14, Math.round(weWord.length * charW + 2)),
                    h: Math.min(32, Math.max(12, Math.round(item.h + 2))),
                  };
                  break;
                }
              }
            }

            if (!wordBox) {
              const idxInLine = pl.text.toLowerCase().indexOf(weWord.toLowerCase());
              if (idxInLine >= 0) {
                const charW = safeLineBox.w / (pl.text.length || 1);
                wordBox = {
                  x: Math.round(safeLineBox.x + idxInLine * charW - 1),
                  y: Math.round(safeLineBox.y - 1),
                  w: Math.max(14, Math.round(weWord.length * charW + 2)),
                  h: safeLineH,
                };
              }
            }

            if (wordBox) {
              const errCategory =
                isColorType
                  ? 'Color Mismatch'
                  : we.type === 'number'
                  ? 'Number Mismatch'
                  : we.type === 'missing_word'
                  ? 'Missing Word'
                  : we.type === 'extra_word'
                  ? 'Extra Word'
                  : we.type === 'spelling'
                  ? 'Spelling Mistake'
                  : we.type === 'spacing'
                  ? 'Spacing Difference'
                  : we.type === 'formatting'
                  ? 'Bold / Italic Formatting'
                  : we.type === 'capitalization'
                  ? 'Capitalization Difference'
                  : we.type === 'punctuation_missing' || we.type === 'punctuation'
                  ? 'Punctuation Difference'
                  : 'Word Mistake';

              const colorIssueMsg = isColorType
                ? (we.issue || `Color Mismatch: Found "${weWord}" in ${we.foundColorName || 'custom color'}, expected ${we.expectedColorName || 'standard (black)'}`)
                : (we.issue || `Discrepancy: "${weWord}" (expected "${we.expected}")`);

              highlights.push({
                id: `word_err_${pIdx}_${wIdx}`,
                index: pIdx,
                target: weWord,
                box: wordBox,
                boxes: [wordBox],
                isMatch: false,
                isError: true,
                isColorDiff: isColorType,
                color: isColorType ? 'rgba(245, 158, 11, 0.35)' : 'red',
                borderColor: isColorType ? '#d97706' : '#dc2626',
                isWordDiscrepancy: true,
                category: errCategory,
                severity: isColorType ? 'medium' : 'high',
                details: colorIssueMsg,
                comment: colorIssueMsg,
                expected: isColorType ? (we.expectedColorName || we.expected || 'standard (black)') : (we.expected || '(correct text)'),
                found: isColorType ? (we.foundColorName || weWord || 'custom color') : weWord,
                discrepancy: {
                  id: `word_err_${pIdx}_${wIdx}`,
                  category: errCategory,
                  type: we.type || (isColorType ? 'color_mismatch' : 'word_mismatch'),
                  severity: isColorType ? 'medium' : 'high',
                  expected: isColorType ? (we.expectedColorName || we.expected || 'standard (black)') : we.expected,
                  found: isColorType ? (we.foundColorName || weWord || 'custom color') : weWord,
                  details: colorIssueMsg,
                },
              });
            }
          });
        }
      }
    }

    if (highlights.length > 0 || matchedAnyVectorLine) {
      return highlights;
    }
  }

  // Fallback: If vector matching found 0 highlights, but direct OCR bounding boxes exist:
  if (isIsiTarget && pageBoxesFromIsi.length > 0) {
    const directHls = computeDirectIsiHighlights();
    if (directHls.length > 0) return directHls;
  }

  // In ISI comparison mode, if highlights were computed above, return them.
  // Otherwise if pure ISI comparison with no generic discrepancies, return empty.
  if (isIsiComparison && (!discrepancies || discrepancies.length === 0)) {
    return [];
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

  // User Requirement: "if line is complte match thenno need to mark anything... dont hight if everthuing is oky"
  // Approved master text and complete matches remain clean and unmarked on the PDF.

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

const EMPTY_ARRAY = [];

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
  isiLineResults = EMPTY_ARRAY,
  scale = 1.0,
  pageNumber = 1,
  onPageChange,
  onTotalPagesChange,
  scrollRef,
  onScroll,
  discrepancies = EMPTY_ARRAY,
  matchingTokens = EMPTY_ARRAY,
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
  const [highlightFilter, setHighlightFilter] = useState('all'); // 'all' (Green Matches + Red Errors) | 'errors' | 'matches'
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
  const [renderedPageInfo, setRenderedPageInfo] = useState(null);

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
        setRenderedPageInfo({ page, viewport, dpr, safePageNum });

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
  }, [pdfDoc, pageNumber, scale, isImageMode]);

  // Compute In-Place Highlights (Independent of canvas render lifecycle)
  useEffect(() => {
    let isCancelled = false;

    if (!renderedPageInfo) {
      setPageHighlights([]);
      return;
    }

    // Slide A (isAuditTarget === false) MUST ALWAYS BE 100% CLEAN AND UNTOUCHED.
    // User requirement: "pdf is main file jaisa h waisa rahne do pdf b me mismatch hop to red macth kp green"
    if (!isAuditTarget) {
      setPageHighlights([]);
      return;
    }

    async function computeHighlights() {
      try {
        const { page, viewport, dpr, safePageNum } = renderedPageInfo;
        const textContent = await page.getTextContent();
        if (isCancelled) return;

        // 1. Text & Formatting discrepancy bounding boxes
        const textHighlights = computePageHighlights(
          textContent ? textContent.items : [],
          viewport,
          discrepancies,
          matchingTokens,
          dpr,
          isWordToPdf,
          isIsiComparison,
          isiLineResults,
          safePageNum || 1
        );

        if (!isCancelled) {
          setPageHighlights(textHighlights);
        }
      } catch (err) {
        console.warn('[PdfVisualViewer] Highlight calculation error:', err);
      }
    }

    computeHighlights();

    return () => {
      isCancelled = true;
    };
  }, [renderedPageInfo, isAuditTarget, discrepancies, matchingTokens, isIsiComparison, isiLineResults]);

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
          {isAuditTarget && pageHighlights.length > 0 && (
            <div className="flex items-center gap-1 bg-white/90 border border-slate-200 rounded-lg p-0.5 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setHighlightFilter('errors')}
                className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
                  highlightFilter === 'errors'
                    ? 'bg-rose-600 text-white shadow-xs'
                    : 'text-rose-700 hover:bg-rose-100'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
                Discrepancies ({pageHighlights.filter((h) => !h.isMatch && !h.isColorDiff && h.category !== 'Color Mismatch').length})
              </button>
              {pageHighlights.filter((h) => h.isColorDiff || h.category === 'Color Mismatch').length > 0 && (
                <button
                  type="button"
                  onClick={() => setHighlightFilter('color')}
                  className={`px-2 py-0.5 rounded transition flex items-center gap-1 cursor-pointer ${
                    highlightFilter === 'color'
                      ? 'bg-amber-600 text-white shadow-xs'
                      : 'text-amber-700 hover:bg-amber-100'
                  }`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                  Color Mismatch ({pageHighlights.filter((h) => h.isColorDiff || h.category === 'Color Mismatch').length})
                </button>
              )}
              <button
                type="button"
                onClick={() => setHighlightFilter('all')}
                className={`px-2 py-0.5 rounded transition cursor-pointer ${
                  highlightFilter === 'all'
                    ? 'bg-slate-800 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({pageHighlights.length})
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

              {/* IN-PLACE VISUAL BOUNDING BOX OVERLAY (Slide B Audit Target Only) */}
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
                      if (highlightFilter === 'errors') return !hl.isMatch && !hl.isColorDiff && hl.category !== 'Color Mismatch';
                      if (highlightFilter === 'color') return hl.isColorDiff || hl.category === 'Color Mismatch';
                      return true;
                    })
                    .map((hl) => {
                      const isMatch = !!hl.isMatch;
                      const isColorMismatch =
                        hl.category === 'Color Mismatch' ||
                        hl.isColorDiff ||
                        hl.type === 'color_mismatch' ||
                        hl.type === 'color' ||
                        (hl.category && hl.category.toLowerCase().includes('color')) ||
                        (hl.discrepancy && (
                          hl.discrepancy.category === 'Color Mismatch' ||
                          hl.discrepancy.type === 'color_mismatch' ||
                          hl.discrepancy.type === 'color' ||
                          (hl.discrepancy.category && hl.discrepancy.category.toLowerCase().includes('color'))
                        ));

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
                                  : isColorMismatch
                                  ? isSelected
                                    ? 'border-2 border-amber-600 bg-amber-400/60 ring-2 ring-amber-500 z-30 shadow-md'
                                    : 'border-2 border-amber-500 bg-amber-200/45 hover:bg-amber-300/55 ring-1 ring-amber-400/70 shadow-xs z-25 text-amber-950'
                                  : isSelected
                                  ? 'border-2 border-rose-600 bg-rose-400/60 ring-2 ring-rose-500 z-30 shadow-md'
                                  : hl.isWordDiscrepancy
                                  ? 'border-2 border-rose-600 bg-rose-300/70 ring-1 ring-rose-500 shadow-sm z-25'
                                  : hl.isMissingLine || hl.isMissingWord
                                  ? 'border-b-2 border-dashed border-rose-600 bg-rose-200/40 z-15'
                                  : 'border-b-2 border-rose-500 bg-rose-200/35 hover:bg-rose-300/45 z-10'
                              }`}
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedError(isSelected ? null : (hl.discrepancy || hl));
                              }}
                              title={
                                isColorMismatch
                                  ? `🎨 Color Mismatch: "${hl.target}" — ${hl.details || hl.comment || 'Color differs from reference master'}`
                                  : hl.isWordDiscrepancy
                                  ? `⚠ ${hl.category}: "${hl.target}" — ${hl.details}`
                                  : hl.isMissingLine
                                  ? `⚠ Missing line: "${hl.target}"`
                                  : hl.isMissingWord
                                  ? `⚠ Missing in PDF: "${hl.target}"`
                                  : isMatch
                                  ? `✓ Complete line match: "${hl.target}"`
                                  : `#${hl.index} ${hl.category}: ${hl.details}`
                              }
                            >
                              {/* Error / Discrepancy indicator badge */}
                              {!isMatch && (
                                <span
                                  className={`absolute -top-3 right-0 flex items-center justify-center h-4 px-1.5 rounded-full text-white text-[9px] font-bold shadow-xs whitespace-nowrap pointer-events-none transition-opacity ${
                                    isColorMismatch
                                      ? isSelected
                                        ? 'opacity-100 bg-amber-600 ring-1 ring-white'
                                        : 'opacity-95 group-hover:opacity-100 bg-amber-600 ring-1 ring-white shadow-xs'
                                      : isSelected
                                      ? 'opacity-100 bg-rose-600 ring-1 ring-white'
                                      : hl.isMissingLine
                                      ? 'opacity-100 bg-rose-700 ring-1 ring-white'
                                      : hl.category === 'Extra Line'
                                      ? 'opacity-100 bg-rose-700 ring-1 ring-white'
                                      : hl.isMissingWord
                                      ? 'opacity-100 bg-rose-700 ring-1 ring-white'
                                      : hl.isWordDiscrepancy
                                      ? 'opacity-0 group-hover:opacity-100 bg-rose-600 ring-1 ring-white shadow-xs'
                                      : 'opacity-0 group-hover:opacity-100 bg-rose-600'
                                  }`}
                                >
                                  {isColorMismatch
                                    ? '🎨 Color Mismatch'
                                    : hl.isWordDiscrepancy
                                    ? `⚠ ${hl.category.replace(' Difference', '').replace(' Mistake', '')}`
                                    : hl.isMissingLine
                                    ? 'Missing line'
                                    : hl.category === 'Extra Line'
                                    ? 'Extra line'
                                    : hl.isMissingWord
                                    ? '^ Missing'
                                    : `#${hl.index}`}
                                </span>
                              )}

                              {/* Hover Tooltip Card */}
                              <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-xs p-2.5 rounded-xl bg-slate-900/95 text-white text-[11px] shadow-2xl z-50 pointer-events-none backdrop-blur-xs border border-slate-700 animate-fadeIn">
                                <div className="flex items-center gap-1.5 font-bold">
                                  {isColorMismatch ? (
                                    <span className="rounded px-1.5 py-0.5 text-[9px] uppercase border font-extrabold bg-amber-500/30 text-amber-200 border-amber-400/40">
                                      🎨 Color Mismatch
                                    </span>
                                  ) : isMatch ? (
                                    <span className="rounded px-1.5 py-0.5 text-[9px] uppercase border font-extrabold bg-emerald-500/30 text-emerald-200 border-emerald-400/30">
                                      ✓ Complete Line Match
                                    </span>
                                  ) : (
                                    <span className="rounded px-1.5 py-0.5 text-[9px] uppercase border font-extrabold bg-rose-500/30 text-rose-300 border-rose-400/30">
                                      #{hl.index} {hl.category}
                                    </span>
                                  )}
                                </div>
                                <div className="text-slate-200 mt-1 leading-snug line-clamp-2">
                                  {isColorMismatch
                                    ? hl.details || hl.comment || 'Color Mismatch: Text color differs from approved reference standard.'
                                    : isMatch
                                    ? `Complete line matches approved reference standard: "${hl.target}"`
                                    : hl.details || hl.comment}
                                </div>
                                <div className="flex items-center justify-between text-[9px] text-slate-400 mt-1.5 pt-1 border-t border-slate-800">
                                  <span>
                                    {isColorMismatch ? (
                                      <>Expected: <strong className="text-amber-300">{hl.expected || 'standard (black)'}</strong> | Found: <strong className="text-amber-300">{hl.found || 'custom color'}</strong></>
                                    ) : isMatch ? (
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
                {discrepancies.filter((d) => d.category !== 'Color Mismatch' && !d.type?.includes('color')).length || discrepancies.length} Discrepancies
              </span>
              {(pageHighlights.filter((h) => h.isColorDiff || h.category === 'Color Mismatch').length > 0 || discrepancies.filter((d) => d.category === 'Color Mismatch' || d.type?.includes('color')).length > 0) && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 text-amber-900 border border-amber-300 px-1.5 py-0.5 text-[10px] font-bold">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
                  {pageHighlights.filter((h) => h.isColorDiff || h.category === 'Color Mismatch').length || discrepancies.filter((d) => d.category === 'Color Mismatch' || d.type?.includes('color')).length} Color Mismatches
                </span>
              )}
            </div>
            {discrepancies.length === 0 && pageHighlights.filter((h) => !h.isMatch).length === 0 ? (
              <span className="text-[11px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                ✓ 100% Match with Staging
              </span>
            ) : (
              <span className="text-[11px] text-slate-500">
                Click marker on page or pill below to inspect & comment
              </span>
            )}
          </div>


          {/* Quick Discrepancy Pills */}
          {(discrepancies.length > 0 || pageHighlights.length > 0) && (
            <div className="flex gap-2 overflow-x-auto pb-1 pt-0.5 scrollbar-thin">
              {discrepancies.slice(0, 10).map((err, idx) => {
                const isSelected = selectedError?.id === err.id;
                const isColor = err.category === 'Color Mismatch' || err.type?.includes('color');
                const catColor =
                  isColor
                    ? 'bg-amber-50 border-amber-300 text-amber-950'
                    : err.category === 'Spacing'
                    ? 'bg-sky-50 border-sky-300 text-sky-900'
                    : err.category === 'Punctuation'
                    ? 'bg-pink-50 border-pink-300 text-pink-900'
                    : err.category === 'Numbers & Units' || err.category === 'Number Mismatch'
                    ? 'bg-cyan-50 border-cyan-300 text-cyan-950'
                    : err.category === 'Formatting (Bold / Italic)'
                    ? 'bg-purple-50 border-purple-300 text-purple-900'
                    : 'bg-rose-50 border-rose-300 text-rose-900';

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
                      {isColor ? '🎨 Color' : err.category}: {err.found || err.details}
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
            <div className={`mt-2 rounded-xl border-2 bg-white p-3.5 shadow-md text-xs space-y-2.5 animate-fadeIn ${
              selectedError.category === 'Color Mismatch' || selectedError.type?.includes('color') ? 'border-amber-300' : 'border-rose-200'
            }`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                      selectedError.category === 'Color Mismatch' || selectedError.type?.includes('color')
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-rose-100 text-rose-900'
                    }`}>
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
                  <span className={`block font-bold uppercase text-[9px] tracking-wider ${
                    selectedError.category === 'Color Mismatch' || selectedError.type?.includes('color')
                      ? 'text-amber-800'
                      : 'text-rose-700'
                  }`}>
                    Found in Composite Target:
                  </span>
                  <span className={`font-bold break-words ${
                    selectedError.category === 'Color Mismatch' || selectedError.type?.includes('color')
                      ? 'text-amber-950'
                      : 'text-rose-900'
                  }`}>
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
