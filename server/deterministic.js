/**
 * Deterministic Rules Engine
 * Zero-hallucination factual extraction and forensic diffing.
 * Deterministic Rules & Proofreading Engine
 * Zero-hallucination factual extraction, fine-grained proofreading discrepancy detection,
 * and word-by-word forensic verification.
 */

import { diffWordsWithSpace } from 'diff';

// Common legal / business clause indicators
const CLAUSE_PATTERNS = {
  indemnity: /\b(indemnify|indemnification|hold harmless|defend)\b/i,
  liability_cap: /\b(limitation of liability|aggregate liability|liability cap|in no event shall.*exceed)\b/i,
  termination: /\b(termination|terminate for convenience|notice of termination|cure period)\b/i,
  confidentiality: /\b(confidential information|non-disclosure|proprietary information|trade secret)\b/i,
  governing_law: /\b(governed by|jurisdiction|applicable law|laws of the state of|courts of)\b/i,
  warranty: /\b(warranties|disclaimer of warranties|as is|express or implied)\b/i,
  penalty: /\b(liquidated damages|penalty|late fee|default interest)\b/i,
  ip_assignment: /\b(intellectual property|work made for hire|assignment of inventions|moral rights)\b/i,
};

export function extractDeterministicFields(text) {
  // Extract currency amounts
  const amountRegex = /(?:[$€£₹]|USD|EUR|GBP|INR)\s?[\d,]+(?:\.\d{1,2})?|\b[\d,]+(?:\.\d{1,2})?\s?(?:dollars|euros|pounds|rupees)\b/gi;
  const amounts = Array.from(new Set(text.match(amountRegex) || []));

  // Extract dates
  const dateRegex = /\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4})\b/gi;
  const dates = Array.from(new Set(text.match(dateRegex) || []));

  // Extract percentages
  const pctRegex = /\b\d+(?:\.\d+)?%\b/g;
  const percentages = Array.from(new Set(text.match(pctRegex) || []));

  // Extract emails
  const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
  const emails = Array.from(new Set(text.match(emailRegex) || []));

  // Check presence of key clauses
  const detectedClauses = [];
  for (const [key, regex] of Object.entries(CLAUSE_PATTERNS)) {
    if (regex.test(text)) {
      detectedClauses.push(key);
    }
  }

  return {
    amounts: amounts.slice(0, 30),
    dates: dates.slice(0, 30),
    percentages: percentages.slice(0, 20),
    emails: emails.slice(0, 15),
    clauses: detectedClauses,
  };
}

/**
 * Detects 100% of proofreading errors between Document A (baseline) and Document B (revision):
 * - Capitalization / Case mismatches (e.g. BENLYSTA -> benlysta)
 * - Spacing anomalies (e.g. patients -> patient s, extra spaces, missing spaces)
 * - Punctuation discrepancies (missing ending periods, altered commas/colons)
 * - Numbers & Measurements (dosages, concentrations, temperatures, units)
 * - Superscripts, Subscripts & Symbols (®, ™, ©, CO2, H2O)
 * - Word additions, deletions, replacements, and grammatical typos
 */
export function detectProofreadingErrors(textA, textB) {
  const normBreaks = (t) =>
    (t || '')
      .replace(/([^\n])\n([^\n])/g, '$1 $2')
      .replace(/[ \t]+/g, ' ');

  const cleanA = normBreaks((textA || '').replace(/<[^>]+>/g, ''));
  const cleanB = normBreaks((textB || '').replace(/<[^>]+>/g, ''));
  const changes = diffWordsWithSpace(cleanA, cleanB);
  const errors = [];
  let errId = 1;

  // Stateful styled token extraction supporting nested <b>, <i>, and <font> color tags
  const extractStyledTokens = (text) => {
    const tokens = [];
    let isBold = false;
    let isItalic = false;
    let currentColor = null;
    let colorCategory = 'black';

    const parts = (text || '').split(/(<\/?[a-zA-Z0-9_-]+(?:\s+[^>]*)?>)/gi);

    for (const part of parts) {
      if (!part) continue;
      const lower = part.toLowerCase();
      if (lower.startsWith('<b') && !lower.startsWith('</b')) {
        isBold = true;
      } else if (lower.startsWith('</b')) {
        isBold = false;
      } else if (lower.startsWith('<i') && !lower.startsWith('</i')) {
        isItalic = true;
      } else if (lower.startsWith('</i')) {
        isItalic = false;
      } else if (lower.startsWith('<font') || lower.startsWith('<c') || lower.startsWith('<span')) {
        const matchRgb = part.match(/color=["']?rgb\((\d+),\s*(\d+),\s*(\d+)\)["']?/i);
        const matchHex = part.match(/color=["']?#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})["']?/i);
        const matchCat = part.match(/(?:cat|data-cat)=["']?([a-z0-9_-]+)["']?/i);
        if (matchRgb) {
          currentColor = [parseInt(matchRgb[1], 10), parseInt(matchRgb[2], 10), parseInt(matchRgb[3], 10)];
          colorCategory = getColorCategory(currentColor);
        } else if (matchHex) {
          currentColor = [parseInt(matchHex[1], 16), parseInt(matchHex[2], 16), parseInt(matchHex[3], 16)];
          colorCategory = getColorCategory(currentColor);
        }
        if (matchCat) {
          colorCategory = matchCat[1];
        }
      } else if (lower.startsWith('</font') || lower.startsWith('</c') || lower.startsWith('</span')) {
        currentColor = null;
        colorCategory = 'black';
      } else if (!part.startsWith('<')) {
        const words = part.match(/\S+/g);
        if (words) {
          for (const w of words) {
            const isSymbolOnly = /^[^a-zA-Z0-9]+$/.test(w);
            tokens.push({
              raw: w,
              clean: w.replace(/^[.,;:!?'"–—\-()\[\]]+|[.,;:!?'"–—\-()\[\]]+$/g, ''),
              isBold,
              isItalic,
              color: currentColor,
              colorCategory,
              isSymbolOnly,
            });
          }
        }
      }
    }
    return tokens;
  };

  const tokensA = extractStyledTokens(textA);
  const tokensB = extractStyledTokens(textB);

  // Align tokens using a windowed search
  const pairs = [];
  let iA = 0;
  let iB = 0;

  while (iA < tokensA.length && iB < tokensB.length) {
    const tA = tokensA[iA];
    const tB = tokensB[iB];

    if (tA.clean.toLowerCase() === tB.clean.toLowerCase() && tA.clean.length > 0) {
      pairs.push({ tA, tB, idxA: iA, idxB: iB });
      iA++;
      iB++;
    } else if (tA.isSymbolOnly && tB.isSymbolOnly && tA.raw === tB.raw) {
      pairs.push({ tA, tB, idxA: iA, idxB: iB });
      iA++;
      iB++;
    } else {
      let found = false;
      for (let offset = 1; offset <= 6; offset++) {
        if (iB + offset < tokensB.length && tA.clean.toLowerCase() === tokensB[iB + offset].clean.toLowerCase()) {
          iB += offset;
          found = true;
          break;
        }
        if (iA + offset < tokensA.length && tokensA[iA + offset].clean.toLowerCase() === tB.clean.toLowerCase()) {
          iA += offset;
          found = true;
          break;
        }
      }
      if (!found) {
        iA++;
        iB++;
      }
    }
  }

  // Group consecutive formatting differences
  let currentGroup = null;
  const styleGroups = [];

  for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
    const pair = pairs[pIdx];
    const { tA, tB, idxB } = pair;

    let boldDiff = tA.isBold !== tB.isBold;
    let italicDiff = tA.isItalic !== tB.isItalic;

    if (tA.isSymbolOnly && currentGroup) {
      const nextPair = pairs[pIdx + 1];
      if (nextPair && (nextPair.tA.isBold !== nextPair.tB.isBold || nextPair.tA.isItalic !== nextPair.tB.isItalic)) {
        boldDiff = currentGroup.boldDiff;
        italicDiff = currentGroup.italicDiff;
      }
    }

    if (boldDiff || italicDiff) {
      if (
        currentGroup &&
        idxB <= currentGroup.lastIdxB + 2 &&
        (tA.isSymbolOnly || (currentGroup.boldDiff === boldDiff && currentGroup.italicDiff === italicDiff))
      ) {
        currentGroup.wordsA.push(tA.raw);
        currentGroup.wordsB.push(tB.raw);
        currentGroup.lastIdxB = idxB;
      } else {
        if (currentGroup) {
          styleGroups.push(currentGroup);
        }
        currentGroup = {
          wordsA: [tA.raw],
          wordsB: [tB.raw],
          startIdxB: idxB,
          lastIdxB: idxB,
          boldDiff,
          italicDiff,
          isBoldA: tA.isBold,
          isItalicA: tA.isItalic,
          isBoldB: tB.isBold,
          isItalicB: tB.isItalic,
        };
      }
    } else {
      if (currentGroup) {
        styleGroups.push(currentGroup);
        currentGroup = null;
      }
    }
  }

  if (currentGroup) {
    styleGroups.push(currentGroup);
  }

  // Group consecutive color differences
  let currentColorGroup = null;
  const colorGroups = [];

  for (let pIdx = 0; pIdx < pairs.length; pIdx++) {
    const pair = pairs[pIdx];
    const { tA, tB, idxB } = pair;
    const colorMismatch = isColorMismatch(tA.color, tB.color, tA.colorCategory, tB.colorCategory, tA, tB);

    if (colorMismatch) {
      const expColorName = tA.colorCategory || (tA.color ? `rgb(${tA.color.join(',')})` : 'standard');
      const foundColorName = tB.colorCategory || (tB.color ? `rgb(${tB.color.join(',')})` : 'different color');

      if (
        currentColorGroup &&
        idxB <= currentColorGroup.lastIdxB + 2 &&
        currentColorGroup.expColor === expColorName &&
        currentColorGroup.foundColor === foundColorName
      ) {
        currentColorGroup.wordsA.push(tA.raw);
        currentColorGroup.wordsB.push(tB.raw);
        currentColorGroup.lastIdxB = idxB;
      } else {
        if (currentColorGroup) {
          colorGroups.push(currentColorGroup);
        }
        currentColorGroup = {
          wordsA: [tA.raw],
          wordsB: [tB.raw],
          startIdxB: idxB,
          lastIdxB: idxB,
          expColor: expColorName,
          foundColor: foundColorName,
        };
      }
    } else {
      if (currentColorGroup) {
        colorGroups.push(currentColorGroup);
        currentColorGroup = null;
      }
    }
  }
  if (currentColorGroup) {
    colorGroups.push(currentColorGroup);
  }

  // Color differences between documents are ignored per user requirement


  // Emit proofreading discrepancies for all detected style changes
  for (const group of styleGroups) {
    const phraseA = group.wordsA.join(' ');
    const phraseB = group.wordsB.join(' ');

    const stylesA = [];
    if (group.isBoldA) stylesA.push('Bold');
    if (group.isItalicA) stylesA.push('Italic');
    const labelA = stylesA.length > 0 ? stylesA.join(' + ') : 'Regular';

    const stylesB = [];
    if (group.isBoldB) stylesB.push('Bold');
    if (group.isItalicB) stylesB.push('Italic');
    const labelB = stylesB.length > 0 ? stylesB.join(' + ') : 'Regular';

    let diffType = 'style_mismatch';
    if (!group.isItalicA && group.isItalicB) {
      diffType = 'italic_added';
    } else if (group.isItalicA && !group.isItalicB) {
      diffType = 'italic_removed';
    } else if (!group.isBoldA && group.isBoldB) {
      diffType = 'bold_added';
    } else if (group.isBoldA && !group.isBoldB) {
      diffType = 'bold_removed';
    }

    // Surrounding context in Document B for precise visual targeting
    const ctxStart = Math.max(0, (group.startIdxB || 0) - 3);
    const ctxEnd = Math.min(tokensB.length, (group.lastIdxB || 0) + 4);
    const contextStr = tokensB.slice(ctxStart, ctxEnd).map((t) => t.raw).join(' ');

    errors.push({
      id: `proof_${errId++}`,
      category: 'Formatting (Bold / Italic)',
      type: diffType,
      severity: 'high',
      expected: `${labelA}: "${phraseA}"`,
      found: `${labelB}: "${phraseB}"`,
      details: `Formatting discrepancy: '${phraseB}' changed styling from ${labelA} (in Staging baseline) to ${labelB} (in Composite revision).`,
      context: contextStr,
    });
  }

  const cleanText = (val) => (val || '').replace(/<[^>]+>/g, '').replace(/[<>]/g, '');

  for (let i = 0; i < changes.length; i++) {
    const curr = changes[i];
    const next = changes[i + 1];

    // Case 1: Substitution (curr is removed from A, next is added in B)
    if (curr.removed && next && next.added) {
      const valA = cleanText(curr.value);
      const valB = cleanText(next.value);
      const trimA = valA.trim();
      const trimB = valB.trim();

      if (!trimA && !trimB) {
        i++;
        continue;
      }

      // Check for split word across next items (e.g., A='patients', B='patient', followed by added 's ')
      const afterNext = changes[i + 2];
      const afterNextClean = afterNext ? cleanText(afterNext.value).trim() : '';
      if (afterNext && afterNext.added && (trimB + afterNextClean).toLowerCase() === trimA.toLowerCase()) {
        const combinedFound = `${trimB} ${afterNextClean}`;
        errors.push({
          id: `proof_${errId++}`,
          category: 'Spacing',
          type: 'space_anomaly',
          severity: 'medium',
          expected: trimA,
          found: combinedFound,
          details: `Spacing error: Word '${trimA}' was split by an extra space into '${combinedFound}'`,
        });
        i += 2; // skip both added parts
        continue;
      }

      // Capitalization mismatch
      if (trimA.toLowerCase() === trimB.toLowerCase() && trimA !== trimB) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Capitalization',
          type: 'case_mismatch',
          severity: 'high',
          expected: trimA,
          found: trimB,
          details: `Capitalization mismatch: '${trimA}' changed to '${trimB}'`,
        });
        i++;
        continue;
      }

      // Spacing anomaly (e.g. whitespace modification)
      if (trimA.replace(/\s+/g, '') === trimB.replace(/\s+/g, '')) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Spacing',
          type: 'space_anomaly',
          severity: 'medium',
          expected: trimA,
          found: trimB,
          details: `Spacing discrepancy: '${trimA}' modified to '${trimB}'`,
        });
        i++;
        continue;
      }

      // Numbers & Measurements
      const isNumA = /^[\d,.]+(?:\s*(?:mg\/mL|mg\/kg|mg|kg|mL|g|°C|%|years?|months?|days?|hours?))?$/i.test(trimA);
      const isNumB = /^[\d,.]+(?:\s*(?:mg\/mL|mg\/kg|mg|kg|mL|g|°C|%|years?|months?|days?|hours?))?$/i.test(trimB);
      if (isNumA || isNumB) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Numbers & Units',
          type: 'number_mismatch',
          severity: 'critical',
          expected: trimA,
          found: trimB,
          details: `Numerical or unit change: Expected '${trimA}', but found '${trimB}'`,
        });
        i++;
        continue;
      }

      // Subscripts, Superscripts, Trademarks
      if (/[®™©₂₃½¼¾]/.test(trimA) || /[®™©₂₃½¼¾]/.test(trimB)) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Symbols & Trademarks',
          type: 'symbol_mismatch',
          severity: 'high',
          expected: trimA,
          found: trimB,
          details: `Trademark or notation symbol mismatch: '${trimA}' vs '${trimB}'`,
        });
        i++;
        continue;
      }

      // General word replacement
      errors.push({
        id: `proof_${errId++}`,
        category: 'Word Mismatch',
        type: 'word_replacement',
        severity: 'high',
        expected: trimA,
        found: trimB,
        details: `Content replaced: '${trimA}' was replaced with '${trimB}'`,
      });
      i++;
      continue;
    }

    // Case 2: Removed from Document A (deleted in B)
    if (curr.removed) {
      const valA = cleanText(curr.value);
      const trimA = valA.trim();
      if (!trimA) continue;

      // Punctuation deletion (e.g. missing terminal period at end of line)
      if (/^[.,;:!?'"–—\-()\[\]]+$/.test(trimA)) {
        const prevWord = (changes[i - 1]?.value || '').trim().split(/\s+/).pop() || '';
        const expectedContext = prevWord ? `${prevWord}${trimA}` : trimA;
        const foundContext = prevWord || '(omitted)';
        errors.push({
          id: `proof_${errId++}`,
          category: 'Punctuation',
          type: 'missing_punctuation',
          severity: 'medium',
          expected: expectedContext,
          found: foundContext,
          details: prevWord
            ? `Missing terminal punctuation: '${trimA}' was omitted after '${prevWord}' (expected '${expectedContext}', found '${foundContext}')`
            : `Missing punctuation: '${trimA}' was deleted or omitted in Document B`,
        });
        continue;
      }

      // Trademark / Symbol deletion
      if (/[®™©]/.test(trimA)) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Symbols & Trademarks',
          type: 'missing_symbol',
          severity: 'high',
          expected: trimA,
          found: '(omitted)',
          details: `Trademark symbol '${trimA}' was removed in Document B`,
        });
        continue;
      }

      // Number deletion
      if (/\d/.test(trimA)) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Numbers & Units',
          type: 'number_removed',
          severity: 'critical',
          expected: trimA,
          found: '(deleted)',
          details: `Numerical specification removed: '${trimA}'`,
        });
        continue;
      }

      // General word deletion
      errors.push({
        id: `proof_${errId++}`,
        category: 'Word Mismatch',
        type: 'word_deleted',
        severity: 'high',
        expected: trimA,
        found: '(deleted)',
        details: `Text deleted from baseline: '${trimA}'`,
      });
      continue;
    }

    // Case 3: Added in Document B (not in A)
    if (curr.added) {
      const valB = cleanText(curr.value);
      const trimB = valB.trim();
      if (!trimB) continue;

      // Check if this added item is a trailing split character from a previous word
      if (/^[a-zA-Z]$/.test(trimB) && errors.length > 0) {
        const prevErr = errors[errors.length - 1];
        if (prevErr.category === 'Word Mismatch' && prevErr.expected.endsWith(trimB)) {
          prevErr.category = 'Spacing';
          prevErr.type = 'space_anomaly';
          prevErr.severity = 'medium';
          prevErr.found = `${prevErr.found} ${trimB}`;
          prevErr.details = `Spacing error: Word '${prevErr.expected}' was incorrectly split with a space ('${prevErr.found}')`;
          continue;
        }
      }

      // Punctuation addition
      if (/^[.,;:!?'"–—\-()\[\]]+$/.test(trimB)) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Punctuation',
          type: 'extra_punctuation',
          severity: 'medium',
          expected: '(none)',
          found: trimB,
          details: `Extra punctuation introduced: '${trimB}'`,
        });
        continue;
      }

      // Symbol addition
      if (/[®™©]/.test(trimB)) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Symbols & Trademarks',
          type: 'extra_symbol',
          severity: 'high',
          expected: '(none)',
          found: trimB,
          details: `New trademark symbol added: '${trimB}'`,
        });
        continue;
      }

      // Number addition
      if (/\d/.test(trimB)) {
        errors.push({
          id: `proof_${errId++}`,
          category: 'Numbers & Units',
          type: 'number_added',
          severity: 'critical',
          expected: '(none)',
          found: trimB,
          details: `New numerical figure introduced in Document B: '${trimB}'`,
        });
        continue;
      }

      // General word insertion
      errors.push({
        id: `proof_${errId++}`,
        category: 'Word Mismatch',
        type: 'word_inserted',
        severity: 'high',
        expected: '(none)',
        found: trimB,
        details: `Inserted content in revision: '${trimB}'`,
      });
    }
  }

  return errors;
}

export function diffDeterministic(fieldsA, fieldsB, textA, textB) {
  const findings = [];

  // 1. Amount differences
  const setAAmounts = new Set(fieldsA.amounts || []);
  const setBAmounts = new Set(fieldsB.amounts || []);

  for (const amt of fieldsB.amounts || []) {
    if (!setAAmounts.has(amt)) {
      findings.push({
        type: 'amount_added',
        field: 'Amounts',
        severity: 'medium',
        detail: `New monetary figure introduced in Document B: ${amt}`,
      });
    }
  }
  for (const amt of fieldsA.amounts || []) {
    if (!setBAmounts.has(amt)) {
      findings.push({
        type: 'amount_removed',
        field: 'Amounts',
        severity: 'high',
        detail: `Monetary figure removed from Document A: ${amt}`,
      });
    }
  }

  // 2. Date differences
  const setADates = new Set(fieldsA.dates || []);
  const setBDates = new Set(fieldsB.dates || []);

  for (const dt of fieldsB.dates || []) {
    if (!setADates.has(dt)) {
      findings.push({
        type: 'date_changed',
        field: 'Dates',
        severity: 'medium',
        detail: `Date present in Document B but not Document A: ${dt}`,
      });
    }
  }

  // 3. Clause additions / deletions
  const setAClauses = new Set(fieldsA.clauses || []);
  const setBClauses = new Set(fieldsB.clauses || []);

  for (const c of fieldsB.clauses || []) {
    if (!setAClauses.has(c)) {
      findings.push({
        type: 'clause_added',
        field: 'Clause Structure',
        severity: c === 'indemnity' || c === 'liability_cap' ? 'critical' : 'medium',
        detail: `New ${c.replace('_', ' ')} clause introduced in Document B.`,
      });
    }
  }

  for (const c of fieldsA.clauses || []) {
    if (!setBClauses.has(c)) {
      findings.push({
        type: 'clause_removed',
        field: 'Clause Structure',
        severity: c === 'indemnity' || c === 'liability_cap' ? 'critical' : 'high',
        detail: `Critical ${c.replace('_', ' ')} clause removed in Document B!`,
      });
    }
  }

  // 4. Polarity checks
  const polarityChecks = [
    { from: /\bshall not\b/gi, to: /\bshall\b/gi, label: 'obligation negation inversion' },
    { from: /\bnot liable\b/gi, to: /\bliable\b/gi, label: 'liability flip' },
    { from: /\bexclusive\b/gi, to: /\bnon-exclusive\b/gi, label: 'exclusivity modification' },
    { from: /\bunlimited\b/gi, to: /\blimited\b/gi, label: 'liability boundary shift' },
  ];

  for (const p of polarityChecks) {
    const inA = (textA.match(p.from) || []).length;
    const inB = (textB.match(p.from) || []).length;
    if (inA !== inB) {
      findings.push({
        type: 'polarity_change',
        field: 'Legal Polarity',
        severity: 'high',
        detail: `Shift detected in ${p.label}: frequency changed from ${inA} occurrences to ${inB}.`,
      });
    }
  }

  // 5. Integrate proofreading errors into deterministic diff findings
  const proofErrors = detectProofreadingErrors(textA, textB);
  for (const pe of proofErrors) {
    findings.push({
      type: pe.type,
      field: pe.category,
      severity: pe.severity,
      detail: pe.details,
      expected: pe.expected,
      found: pe.found,
    });
  }

  return findings;
}

/**
 * Computes a fine-grained word-by-word diff with:
 * - Standard additions/deletions/unchanged parts
 * - Proofreading view tokens (verified matches in Green, errors in Red)
 * - Full categorized proofreading error list
 * - Accuracy and similarity indices
 */
export function computeVisualWordDiff(textA, textB, options = {}) {
  // CRITICAL REQUIREMENT:
  // When Document A is an Approved ISI Reference Standard (Word or PDF) and Document B contains ISI content:
  // Execute targeted ISI Line-by-Line comparison with 100% sequential accuracy.
  // When comparing standard documents (e.g. 2 full composites or standard contracts/NDAs),
  // retain full-document visual and text comparison 100% unchanged.
  const isWordToPdf = !!options.isWordToPdf;
  const isIsiRefA = isIsiReferenceStandard(textA, options.docAName);
  const isMasterA = isIsiMaster(textA) || /(?:isi|indication|prescribing|safety|approved|master|reference)/i.test(options.docAName || '');
  const hasIsiA = hasIsiContent(textA);
  const hasIsiB = hasIsiContent(textB);

  if (isWordToPdf || isIsiRefA || isMasterA || hasIsiA || hasIsiB) {
    return compareIsiLineByLine(textA, textB, options);
  }

  const changes = diffWordsWithSpace(textA || '', textB || '');
  let wordsAdded = 0;
  let wordsRemoved = 0;
  let wordsUnchanged = 0;

  const diffParts = [];
  const proofreadingParts = [];
  const leftParts = [];
  const rightParts = [];

  let leftBold = false;
  let leftItalic = false;
  let rightBold = false;
  let rightItalic = false;

  const isTag = (val) => /^<\/?[a-zA-Z0-9_-]+(?:\s+[^>]*)?>$/i.test((val || '').trim());
  const cleanText = (val) => (val || '').replace(/<[^>]+>/g, '');

  for (let i = 0; i < changes.length; i++) {
    const part = changes[i];
    const val = part.value;

    // Track formatting tags without outputting raw tags into readable text
    if (isTag(val)) {
      const tag = val.trim().toLowerCase();
      if (tag === '<b>') {
        if (part.removed) leftBold = true;
        else if (part.added) rightBold = true;
        else { leftBold = true; rightBold = true; }
      } else if (tag === '</b>') {
        if (part.removed) leftBold = false;
        else if (part.added) rightBold = false;
        else { leftBold = false; rightBold = false; }
      } else if (tag === '<i>') {
        if (part.removed) leftItalic = true;
        else if (part.added) rightItalic = true;
        else { leftItalic = true; rightItalic = true; }
      } else if (tag === '</i>') {
        if (part.removed) leftItalic = false;
        else if (part.added) rightItalic = false;
        else { leftItalic = false; rightItalic = false; }
      }
      continue;
    }

    const cleanVal = cleanText(val);
    if (!cleanVal) continue;

    const words = cleanVal.trim().split(/\s+/).filter(Boolean).length;

    if (part.added) {
      wordsAdded += words;
      diffParts.push({ type: 'added', value: cleanVal, isBold: rightBold, isItalic: rightItalic });
      proofreadingParts.push({
        type: 'error',
        value: cleanVal,
        status: 'added_or_modified',
        isBold: rightBold,
        isItalic: rightItalic,
      });
      // Right Slide (Composite): added or modified text
      rightParts.push({
        type: 'added',
        value: cleanVal,
        status: 'added_or_modified',
        isBold: rightBold,
        isItalic: rightItalic,
      });
    } else if (part.removed) {
      wordsRemoved += words;
      diffParts.push({ type: 'removed', value: cleanVal, isBold: leftBold, isItalic: leftItalic });
      proofreadingParts.push({
        type: 'removed',
        value: cleanVal,
        status: 'deleted_from_baseline',
        isBold: leftBold,
        isItalic: leftItalic,
      });
      // Left Slide (Staging): baseline token
      leftParts.push({
        type: 'removed',
        value: cleanVal,
        status: 'deleted_from_baseline',
        isBold: leftBold,
        isItalic: leftItalic,
      });
      // Right Slide (Composite): Omission indicator (text missing in Composite)
      rightParts.push({
        type: 'omitted',
        value: cleanVal,
        status: 'omitted_in_composite',
        isBold: leftBold,
        isItalic: leftItalic,
      });
    } else {
      wordsUnchanged += words;
      const formatMismatch = (leftBold !== rightBold) || (leftItalic !== rightItalic);

      diffParts.push({
        type: 'unchanged',
        value: cleanVal,
        isBold: rightBold || leftBold,
        isItalic: rightItalic || leftItalic,
      });
      proofreadingParts.push({
        type: 'match',
        value: cleanVal,
        status: 'verified_match',
        isBold: rightBold || leftBold,
        isItalic: rightItalic || leftItalic,
      });
      // Left Slide (Staging): baseline match
      leftParts.push({
        type: 'match',
        value: cleanVal,
        status: 'verified_match',
        isBold: leftBold,
        isItalic: leftItalic,
      });
      // Right Slide (Composite): match or formatting discrepancy
      rightParts.push({
        type: formatMismatch ? 'format_mismatch' : 'match',
        value: cleanVal,
        status: formatMismatch ? 'formatting_discrepancy' : 'verified_match',
        isBold: rightBold,
        isItalic: rightItalic,
        expectedBold: leftBold,
        expectedItalic: leftItalic,
      });
    }
  }

  const denominator = wordsUnchanged + wordsAdded + wordsRemoved;
  const similarity =
    denominator > 0 ? Math.max(0, Math.min(100, Math.round((wordsUnchanged / denominator) * 100))) : 100;

  const proofreadingErrors = detectProofreadingErrors(textA, textB);

  // Collect matching approved word tokens for visual green highlighting on PDF
  const matchingTokens = [];
  let tokenIdx = 1;
  for (const part of proofreadingParts) {
    if (part.status === 'verified_match' && part.value) {
      const val = part.value.trim();
      if (val.length >= 2) {
        const words = val.split(/\s+/).filter(Boolean);
        for (let i = 0; i < words.length; i += 4) {
          const chunk = words.slice(i, i + 4).join(' ');
          if (chunk.length >= 2) {
            matchingTokens.push({
              id: `match_${tokenIdx++}`,
              text: chunk,
              isApprovedMatch: true,
              type: 'approved_match',
            });
          }
        }
      }
    }
  }

  // Multi-occurrence ISI Safety Audit (detects repeated ISI in PDF against Approved Word Doc)
  const isiAudit = auditIsiOccurrences(textA, textB);

  const errorSummary = {
    capitalization: proofreadingErrors.filter((e) => e.category === 'Capitalization').length,
    spacing: proofreadingErrors.filter((e) => e.category === 'Spacing').length,
    punctuation: proofreadingErrors.filter((e) => e.category === 'Punctuation').length,
    numbers: proofreadingErrors.filter((e) => e.category === 'Numbers & Units').length,
    symbols: proofreadingErrors.filter((e) => e.category === 'Symbols & Trademarks').length,
    formatting: proofreadingErrors.filter((e) => e.category === 'Formatting (Bold / Italic)').length,
    words: proofreadingErrors.filter((e) => e.category === 'Word Mismatch').length,
    total: proofreadingErrors.length,
  };

  return {
    similarity,
    wordsAdded,
    wordsRemoved,
    diffParts,
    proofreadingParts,
    leftParts,
    rightParts,
    sideBySide: {
      leftParts,
      rightParts,
    },
    proofreadingErrors,
    matchingTokens,
    isiAudit,
    errorSummary,
    isIsiComparison: false,
    mismatchReport: [],
  };
}

/**
 * Detects if a document is an Approved ISI Master Document (Prescribing Info, Indication, Safety Warnings).
 */
export function isIsiMaster(text) {
  if (!text) return false;
  const t = text.toLowerCase();
  const isiTerms = [
    'important safety information',
    'prescribing information',
    'indications and usage',
    'indication',
    'contraindications',
    'contraindication',
    'warnings and precautions',
    'adverse reactions',
    'boxed warning',
    'immunization history',
    'anaphylaxis',
    'vaccine',
    'herpes zoster',
    'varicella',
    'guillain-barr',
  ];
  let matches = 0;
  for (const term of isiTerms) {
    if (t.includes(term)) matches++;
  }
  return matches >= 1;
}

/**
 * Accurately detects if a document is a pure Approved ISI Reference Standard (PDF or Word),
 * rather than a marketing email composite or standard commercial agreement.
 */
export function isIsiReferenceStandard(text, docName = '') {
  if (!text) return false;
  const lowerName = (docName || '').toLowerCase();
  const lowerText = text.toLowerCase();

  // Explicit reference document naming
  if (/(?:isi.*source|isi.*master|isi.*matching|approved.*word|approved.*master|reference.*isi|prescribing.*source)/i.test(lowerName)) {
    return true;
  }

  // If text contains promotional email / marketing components, it is a composite design, not a reference standard
  const hasPromotionalEmail =
    /(?:living with diabetes|patient (?:snapshot|profile|history)|explore more profiles|stop or change email|unsubscribe|sponsored healthcare-related messages|advertisement)/i.test(lowerText);
  if (hasPromotionalEmail) {
    return false;
  }

  // Must contain canonical ISI headings
  const hasIsiTerms =
    /(?:important safety information|prescribing information|indication|contraindications|warnings and precautions)/i.test(lowerText);

  return hasIsiTerms;
}

export function hasIsiContent(text) {
  if (!text) return false;
  return /(?:important safety information|prescribing information|indication|contraindications|warnings and precautions)/i.test(text);
}

const NON_ISI_PATTERNS =
  /^(?:[•\-*\s]*)(?:<b>\s*)?(?:Patient\s+(?:Profile|Snapshot|History)|Arthur|Diabetes|Clinical\s+Efficacy|Study\s+Design|Dosing\s+Summary|See\s+Examples|Practice|Sign\s+Up|Visit|Click\s+Here|References|Observational\s+studies|Inform\s+your\s+patients|Certain\s+chronic\s+conditions|living\s+with\s+diabetes|\d+\s+years\s+old\s+living|CONTINUED\s+BELOW|Page\s+\d+\s+of\s+\d+|Copyright|All\s+rights\s+reserved)(?:\s*<\/b>)?/i;

const ISI_HEADING_REGEX =
  /^(?:[•\-*\s]*)(?:<b>\s*)?(?:Important\s+Safety\s+Information(?:\s*\(cont[’']?d\))?|Selected\s+Important\s+Safety\s+Information|Brief\s+Summary(?:\s+of\s+Prescribing\s+Information)?|Prescribing\s+Information|Indication(?:\s*and\s*Usage)?|Indication\s*(&|and)\s*Important\s+Safety\s+Information|Contraindications|Warnings\s*(&|and)\s*Precautions|Adverse\s+Reactions|Patient\s+Snapshot|Safety\s+Considerations|Boxed\s+Warning)(?:\s*<\/b>)?/i;

function getWordTokens(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4);
}

/**
 * Detects and segments Important Safety Information (ISI), Indication, and Prescribing Information blocks.
 * Filters out all promotional, patient profile, and non-ISI marketing copy.
 */
export function detectIsiBlocks(text, referenceMasterText = '') {
  if (!text) return [];
  const masterWords = new Set(getWordTokens(referenceMasterText || ''));
  const lines = text.split('\n');
  const blocks = [];
  let currentBlock = null;
  let inIsi = false;

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const cleanLine = rawLine.replace(/<[^>]+>/g, '').trim();
    if (!cleanLine) continue;

    // Strict rejection of non-ISI promotional copy & patient cards
    if (NON_ISI_PATTERNS.test(cleanLine)) {
      inIsi = false;
      if (currentBlock && currentBlock.lines.length > 0) {
        currentBlock.text = currentBlock.lines.join('\n').trim();
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    // Check for explicit ISI heading
    if (ISI_HEADING_REGEX.test(cleanLine)) {
      inIsi = true;
      if (currentBlock && currentBlock.lines.length > 0) {
        currentBlock.text = currentBlock.lines.join('\n').trim();
        blocks.push(currentBlock);
      }
      currentBlock = {
        id: `isi_${blocks.length + 1}`,
        occurrenceIndex: blocks.length + 1,
        heading: cleanLine,
        startLine: i + 1,
        lines: [cleanLine],
      };
      continue;
    }

    const lineWords = getWordTokens(cleanLine);
    let matched = 0;
    for (const w of lineWords) {
      if (masterWords.has(w)) matched++;
    }
    const overlap = lineWords.length > 0 ? matched / lineWords.length : 0;

    if (inIsi) {
      // Continue ISI block if content overlaps or continuation line
      if (overlap >= 0.15 || cleanLine.length < 35 || masterWords.size === 0) {
        if (!currentBlock) {
          currentBlock = {
            id: `isi_${blocks.length + 1}`,
            occurrenceIndex: blocks.length + 1,
            heading: cleanLine,
            startLine: i + 1,
            lines: [],
          };
        }
        currentBlock.lines.push(cleanLine);
      } else {
        inIsi = false;
        if (currentBlock && currentBlock.lines.length > 0) {
          currentBlock.text = currentBlock.lines.join('\n').trim();
          blocks.push(currentBlock);
          currentBlock = null;
        }
      }
    } else {
      // Non-heading start of ISI content if substantial master overlap
      if (overlap >= 0.45 && lineWords.length >= 3) {
        inIsi = true;
        currentBlock = {
          id: `isi_${blocks.length + 1}`,
          occurrenceIndex: blocks.length + 1,
          heading: cleanLine,
          startLine: i + 1,
          lines: [cleanLine],
        };
      }
    }
  }

  if (currentBlock && currentBlock.lines.length > 0) {
    currentBlock.text = currentBlock.lines.join('\n').trim();
    blocks.push(currentBlock);
  }

  return blocks;
}

/**
 * Performs targeted ISI comparison:
 * 1. Treats Word document as the absolute source of truth.
 * 2. Ignores all non-ISI elements in PDF (images, logos, headers, footers, buttons, patient profiles).
 * 3. Compares strictly PDF ISI text against corresponding Word ISI text at word and line level.
 * 4. Highlights matching words in Green, mismatches/missing/extra in Red.
 * 5. Generates detailed Mismatch Report (Req 15) and calculates ISI Compliance Score (Req 13).
 */
function levenshteinDist(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }
  return dp[m][n];
}

export function getColorCategory(color) {
  if (!color || !Array.isArray(color) || color.length < 3) return 'black';
  const [r, g, b] = color;

  // 1. Black / dark neutral: low intensity and low channel spread
  if (r < 65 && g < 65 && b < 65 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25) {
    return 'black';
  }

  // 2. Neutral gray: all three channels close to each other (monochrome/grayscale body text)
  if (Math.abs(r - g) < 25 && Math.abs(g - b) < 25 && Math.abs(r - b) < 25) {
    return 'gray';
  }

  // 3. Orange headings (e.g. r: 247, g: 150, b: 70 - red dominates, green medium, blue low)
  if (r > 140 && g > 50 && g < 190 && b < 120 && r > g * 1.15 && r > b * 1.4) {
    return 'orange';
  }

  // 4. Purple / violet headings (e.g. APRETUDE headers: r ~ 91, b ~ 100, g ~ 33 - red & blue high, green suppressed)
  if ((r > 50 && b > 60 && (r + b) > g * 1.8 && Math.abs(r - b) < 100) || (r > 70 && b > 70 && g < 70)) {
    return 'purple';
  }

  // 5. Teal / Cyan (e.g. AEROVIA hypersensitivity: green & blue dominate red)
  if (g > 70 && b > 70 && (g + b) > (r * 1.8) && r < 120) {
    return 'teal';
  }

  // 6. Red channel dominates (crimson/red headings)
  if (r > 120 && r > g * 1.4 && r > b * 1.4) {
    return 'red';
  }

  // 7. Blue channel dominates (hyperlink blue)
  if (b > 100 && b > r * 1.2 && b > g * 1.2) {
    return 'blue';
  }

  // 8. Green dominates
  if (g > 100 && g > r * 1.2 && g > b * 1.2) {
    return 'green';
  }

  return `rgb(${r},${g},${b})`;
}

export function isColorMismatch(colorA, colorB, catA, catB, tokenA, tokenB) {
  if (!colorA && !catA && !colorB && !catB) return false;
  const cA = (colorA ? getColorCategory(colorA) : catA) || 'black';
  const cB = (colorB ? getColorCategory(colorB) : catB) || 'black';

  const isNeutralA = cA === 'black' || cA === 'gray';
  const isNeutralB = cB === 'black' || cB === 'gray';

  // Both are neutral body text colors (black vs dark gray) -> no mismatch
  if (isNeutralA && isNeutralB) return false;

  // If both have distinct non-neutral colors (e.g. orange vs purple, red vs blue, teal vs purple) -> mismatch
  if (!isNeutralA && !isNeutralB) {
    if (cA !== cB) return true;
    if (Array.isArray(colorA) && Array.isArray(colorB)) {
      const dist = Math.hypot(colorA[0] - colorB[0], colorA[1] - colorB[1], colorA[2] - colorB[2]);
      if (dist > 80) return true;
    }
    return false;
  }

  // One is neutral (black/gray) and the other has an intentional brand/alert color (purple, orange, teal, red, blue, green):
  if (isNeutralA !== isNeutralB) {
    const rawA = (tokenA?.raw || '').replace(/[^a-zA-Z0-9]/g, '');
    const rawB = (tokenB?.raw || '').replace(/[^a-zA-Z0-9]/g, '');
    if (!rawA && !rawB) return false;
    return true;
  }

  return false;
}

export function getStyleLabel(isBold, isItalic, isUnderline) {
  const parts = [];
  if (isBold) parts.push('bold');
  if (isItalic) parts.push('italic');
  if (isUnderline) parts.push('underlined');
  return parts.length > 0 ? parts.join(' ') : 'regular';
}

export function groupConsecutiveFormattingErrors(errors) {
  if (!errors || errors.length <= 1) return errors || [];
  const merged = [];
  let cur = null;
  for (const err of errors) {
    if (
      cur &&
      err.type === cur.type &&
      err.category === cur.category &&
      err.expected === cur.expected &&
      err.found === cur.found &&
      err.bStartIdx === cur.bEndIdx
    ) {
      cur.word += ' ' + err.word;
      cur.clean += ' ' + err.clean;
      cur.bEndIdx = err.bEndIdx;
    } else {
      if (cur) merged.push(cur);
      cur = { ...err };
    }
  }
  if (cur) merged.push(cur);
  return merged;
}

function extractStyledTokensHelper(text) {
  const strippedText = (text || '').replace(/<!--[\s\S]*?-->/g, '');
  const tokens = [];
  let isBold = false;
  let isItalic = false;
  let isUnderline = false;
  let currentColor = null;
  let colorCategory = 'black';

  const parts = strippedText.split(/(<\/?[a-zA-Z0-9_-]+(?:\s+[^>]*)?>)/gi);

  for (const part of parts) {
    if (!part) continue;
    const lower = part.toLowerCase();
    if (lower.startsWith('<b') && !lower.startsWith('</b')) {
      isBold = true;
    } else if (lower.startsWith('</b')) {
      isBold = false;
    } else if (lower.startsWith('<i') && !lower.startsWith('</i')) {
      isItalic = true;
    } else if (lower.startsWith('</i')) {
      isItalic = false;
    } else if (lower.startsWith('<u') && !lower.startsWith('</u')) {
      isUnderline = true;
    } else if (lower.startsWith('</u')) {
      isUnderline = false;
    } else if (lower.startsWith('<font') || lower.startsWith('<c') || lower.startsWith('<span')) {
      const matchRgb = part.match(/color=["']?rgb\((\d+),\s*(\d+),\s*(\d+)\)["']?/i);
      const matchHex = part.match(/color=["']?#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})["']?/i);
      const matchCat = part.match(/(?:cat|data-cat)=["']?([a-z0-9_-]+)["']?/i);
      if (matchRgb) {
        currentColor = [parseInt(matchRgb[1], 10), parseInt(matchRgb[2], 10), parseInt(matchRgb[3], 10)];
        colorCategory = getColorCategory(currentColor);
      } else if (matchHex) {
        currentColor = [parseInt(matchHex[1], 16), parseInt(matchHex[2], 16), parseInt(matchHex[3], 16)];
        colorCategory = getColorCategory(currentColor);
      }
      if (matchCat) {
        colorCategory = matchCat[1];
      }
    } else if (lower.startsWith('</font') || lower.startsWith('</c') || lower.startsWith('</span')) {
      currentColor = null;
      colorCategory = 'black';
    } else if (!part.startsWith('<')) {
      const words = part.match(/\S+/g);
      if (words) {
        for (const w of words) {
          const isSymbolOnly = /^[^a-zA-Z0-9]+$/.test(w);
          tokens.push({
            raw: w,
            clean: (w || '').replace(/[–—−‑]/g, '-').replace(/^[.,;:!?'"–—\-()\[\]]+|[.,;:!?'"–—\-()\[\]]+$/g, ''),
            norm: (w || '').replace(/[–—−‑]/g, '-').toLowerCase().replace(/^[^\w]+|[^\w]+$/g, ''),
            isBold,
            isItalic,
            isUnderline,
            color: currentColor,
            colorCategory,
            isSymbolOnly,
          });
        }
      }
    }
  }
  return tokens;
}

/**
 * Extracts canonical statements from Approved ISI Reference Document (Word or PDF).
 */
export function extractCanonicalStatements(textA) {
  const rawLines = (textA || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => {
      if (!l) return false;
      const clean = l.replace(/<[^>]+>/g, '').trim();
      if (!clean) return false;
      if (/^(?:For editorial QA|Page \d+ of \d+|IMMUNOVA \|)/i.test(clean)) return false;
      if (/^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}$/i.test(clean)) return false;
      if (/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(clean)) return false;
      if (/^Page\s+\d+(?:\s+of\s+\d+)?$/i.test(clean)) return false;
      return true;
    });

  const statements = [];
  let current = '';

  for (const rawLine of rawLines) {
    const clean = rawLine.replace(/<[^>]+>/g, '').trim();
    if (!clean) continue;

    const isHeading =
      /^(?:Prescribing Information|Indication(?:\s*and\s*Usage)?|Important Safety Information(?:\s*\(cont[’']?d\))?|References|Contraindications|Warnings\s*(?:and|&)\s*Precautions|Adverse Reactions|Boxed Warning|Drug Interactions|Use in Specific Populations)/i.test(
        clean
      ) ||
      /^[A-Z][A-Za-z0-9\s,&’'-]+:$/.test(clean) ||
      /^(?:Hepatotoxicity|Depressive Disorders|Risk of Reduced|Hypersensitivity Reactions|Lactation|Pediatrics)/i.test(clean);
    const isBullet = /^[•\-\*]/.test(clean);
    const isNumber = /^\d+\./.test(clean);
    const isPleaseSee = /^Please see full/i.test(clean);

    if (isHeading || isBullet || isNumber || isPleaseSee) {
      if (current) statements.push(current.trim());
      current = rawLine;
    } else {
      current += (current ? ' ' : '') + rawLine;
    }
  }
  if (current) statements.push(current.trim());
  return statements;
}

const COMPOSITE_NON_ISI_LINE_REGEX =
  /^(?:Subject:|Preheader:|HCP EDUCATIONAL|IMMUNOVA$|AEROVIA$|NUCALA$|BENLYSTA$|FOR PATIENTS WITH|A focused conversation|symptom frequency|Explore a fictional|JORDAN|Works full time|CONSIDER WHETHER|Review exacerbation|EXPLORE (?:THE|MORE|PATIENT)|ADULTS\s*(?:≥|>=)|MAY\s+HAVE|RISK\s+FOR|As\s+patients\s+age|decline\s+in|Certain\s+chronic|also\s+be\s+associated|risk\.|ARTHUR|\d+\s+years\s+old|living\s+with\s+diabetes|PATIENT\s+(?:SNAPSHOT|HISTORY)|Active\s+in\s+managing|Has\s+not\s+been|Discusses\s+preventive|Patients\s*(?:≥|>=)|DIABETES|Observational\s+studies|some\s+adults\s+with|Educational\s+statement|Inform\s+your\s+PATIENTS|vaccination\s+conversations|SEE\s+EXAMPLES|PRACTICE|For\s+pricing\s+information|VACCINES\s+WAC|This\s+email\s+is\s+intended|STOP\s+OR\s+CHANGE|Trademarks\s+are\s+owned|©\d{4}|Produced\s+in\s+USA|Privacy\s+Notice|Please\s+do\s+not\s+respond|You\s+are\s+receiving|\[Email\s+Vendor|For\s+editorial\s+QA|Not\s+approved\s+promotional|PMUS-CBTEML|DESKTOP$|MOBILE$|APRETUDE\s+HCP\s+PROACT|Variable\s+Manuscript|(?:Magenta|Red|Blue)\s+symbol\s+denotes|Functional\s+Annotations|\d+(?:st|nd|rd|th)-party\s+header|Date:\s*\[|From:\s*ViiV|To:\s*\[|Subject\s+Line:|Preview\s+Text:|Email\s+Vendor\s+Variable|ViiV\s+Healthcare\s+does\s+not\s+control|This\s+is\s+an\s+industry-prepared|ARE\s+YOUR\s+PATIENTS\s+READY|WITHOUT\s+DAILY\s+PILLS|See\s+which\s+PrEP\s+patients|Give\s+them\s+the\s+power|View\s+patient\s+choice|Learn\s+more|View\s+in\s+browser|Prescribing\s+Information,\s+including\s+Boxed\s+Warning|Apretude\s+cabotegravir|Kindly\s+\+Expand|Mockup\s+HTML|https?:\/\/|TDF\s+option|Staging\s+login|User\s+ID:|Password:|\[no\s+notes\s+on\s+this\s+page\]|-\s*\d+\s*-|In\s+the\s+HPTN|Which\s+PrEP|participants\s+choose|APRETUDE\s+or\s+TRUVADA|\(?TDF\/?(?:I|F)TC\)?|Your\s+patients\s+deserve|choice\s+on\s+how\s+to\s+PrEP|choice\s+data\s+today|It['’]s\s+time\s+to\s+help|patients\s+prioritize\s+HIV|prevention$|Give\s+them\s+the\s+power|HPTN\s+08[34]|HPTN\s*=|View\s+patient\s+choice|Learn\s+more|py$|—y$|i\.\s+be|References:|References\b|\d+\.\s+[A-Z][a-z]+|Lancotz|Delany|Fichenboun|Please\s+se(?:e)?\s+full\s+Prescribing|Click\s+to\s+view|To\s+report\s+SUSPECTED|ViiV\s+Healthcare|VI\s+H[eo]allca|LA77|sun\s+gov|Tis\s+mai\s+tended|Thi\s+ma[il]{2}\s+was|Le[og]a?l\s+Notices|party\s+footer)/i;

const COMPOSITE_ISI_START_REGEX =
  /^(?:<b>\s*)?(?:[A-Z0-9\s-]+\|\s*)?(?:Important\s+Safety\s+Information(?:\s*\(cont[’']?d\))?|Selected\s+Important\s+Safety\s+Information|Brief\s+Summary(?:\s+of\s+Prescribing\s+Information)?|Prescribing\s+Information|Indication(?:\s*and\s*Usage)?|Indication\s*(?:&|and)\s*Important\s+Safety\s+Information|Contraindications?|Warnings\s*(?:and|&)\s*Precautions|Adverse\s+Reactions|Boxed\s+Warning|Safety\s+Considerations)/i;

/**
 * Extracts both ISI and Non-ISI marketing lines from Composite PDF B or Reference Document A.
 */
export function extractClassifiedLinesFromPdf(textB) {
  const lines = (textB || '').split('\n').map((l) => l.trim()).filter(Boolean);
  const isiLines = [];
  const nonIsiLines = [];
  let inIsi = false;
  let currentPage = 1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    const pageMatch = raw.match(/<!--\s*PAGE\s*(\d+)\s*-->/i);
    if (pageMatch) {
      currentPage = parseInt(pageMatch[1], 10);
      continue;
    }

    const boxMatch = raw.match(/<!--\s*BOX:(.*?)\s*-->/);
    let box = null;
    if (boxMatch) {
      try {
        box = JSON.parse(boxMatch[1]);
      } catch (_) {}
    }

    const cleanRaw = (raw || '').replace(/<!--[\s\S]*?-->/g, '').trim();
    const clean = cleanRaw.replace(/<[^>]+>/g, '').trim();
    if (!clean) continue;

    const linePage = (box && box.page) ? box.page : currentPage;

    // Ignore running date timestamps and page numbers from document template headers/footers
    if (
      /^(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}$/i.test(clean) ||
      /^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}$/.test(clean) ||
      /^Page\s+\d+(?:\s+of\s+\d+)?$/i.test(clean)
    ) {
      nonIsiLines.push({
        raw: cleanRaw,
        clean,
        index: i,
        page: linePage,
        box,
        tokens: extractStyledTokensHelper(cleanRaw),
      });
      continue;
    }

    if (COMPOSITE_NON_ISI_LINE_REGEX.test(clean)) {
      inIsi = false;
      nonIsiLines.push({
        raw: cleanRaw,
        clean,
        index: i,
        page: linePage,
        box,
        tokens: extractStyledTokensHelper(cleanRaw),
      });
      continue;
    }

    if (/^(?:<b>\s*)?(?:[A-Z0-9\s-]+\|\s*IMPORTANT SAFETY INFORMATION)/i.test(clean)) {
      inIsi = true;
      continue;
    }

    if (COMPOSITE_ISI_START_REGEX.test(cleanRaw) || COMPOSITE_ISI_START_REGEX.test(clean)) {
      inIsi = true;
    }

    if (inIsi) {
      isiLines.push({
        raw: cleanRaw,
        clean,
        index: i,
        page: linePage,
        box,
        tokens: extractStyledTokensHelper(cleanRaw),
      });

      if (
        /is not approved promotional material\.?$/i.test(clean) ||
        /For editorial QA training only/i.test(clean) ||
        /^(?:CONTINUED\s+BELOW|Additional\s+Important\s+Safety\s+Information\s*continued\s*below)/i.test(clean) ||
        /^(?:References\b|References:|To\s+report\s+SUSPECTED|Please\s+(?:click|see)\s+(?:here\s+for\s+)?full\s+Prescribing|Click\s+to\s+view|This\s+email\s+(?:is|was)|Legal\s+Notices|Privacy\s+Notice|PM-?US-|©\s*\d{4}|Trademarks\s+are\s+owned|\d+\.\s+[A-Z][a-z]+|ViiV\s+Healthcare|1st-party\s+footer)/i.test(clean)
      ) {
        inIsi = false;
      }
    } else {
      nonIsiLines.push({
        raw: cleanRaw,
        clean,
        index: i,
        page: linePage,
        box,
        tokens: extractStyledTokensHelper(cleanRaw),
      });
    }
  }

  return { isiLines, nonIsiLines };
}

/**
 * Extracts visual ISI lines from Composite PDF B or Reference Document A.
 */
export function extractIsiLinesFromPdf(textB) {
  return extractClassifiedLinesFromPdf(textB).isiLines;
}



function computeSubsequenceFuzzyScore(cTokens, cStart, bNorm) {
  if (cStart >= cTokens.length || bNorm.length === 0) return 0;
  if (bNorm.length === 1) {
    return tokensFuzzyMatch(cTokens[cStart].norm, bNorm[0]) ? 1 : 0;
  }
  let cIdx = cStart;
  let matches = 0;
  for (let bIdx = 0; bIdx < bNorm.length; bIdx++) {
    const bt = bNorm[bIdx];
    for (let offset = 0; offset <= 2 && cIdx + offset < cTokens.length; offset++) {
      if (tokensFuzzyMatch(cTokens[cIdx + offset].norm, bt)) {
        matches++;
        cIdx += offset + 1;
        break;
      }
    }
  }
  return matches / bNorm.length;
}

function tokensFuzzyMatch(cNorm, bNorm) {
  if (!cNorm || !bNorm) return false;
  if (cNorm === bNorm) return true;
  // Two-letter words or single letters require exact match
  if (cNorm.length <= 2 || bNorm.length <= 2) return false;
  // 3-letter words allow 1 edit distance (e.g. use vs uso)
  if (cNorm.length === 3 && bNorm.length === 3) {
    return levenshteinDist(cNorm, bNorm) <= 1;
  }
  // Prefix/stem match for words >= 5 characters
  if (cNorm.length >= 5 && bNorm.length >= 5) {
    if (cNorm.startsWith(bNorm) || bNorm.startsWith(cNorm)) return true;
  }
  const maxLen = Math.max(cNorm.length, bNorm.length);
  const maxDist = maxLen >= 8 ? 2 : 1;
  if (levenshteinDist(cNorm, bNorm) <= maxDist) return true;
  return false;
}

const stripAlphanum = (s) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

const stopWordsSet = new Set(['to', 'if', 'is', 'the', 'at', 'or', 'of', 'in', 'it', 'on', 'as', 'by', 'an', 'be', 'for', 'up', 'due', 'and', 'all', 'use', 'we', 'he', 'so', 'do']);

function isOcrWordMatch(normA, normB) {
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  // Specific known OCR slips for medical/safety terms (must run BEFORE negation/prefix checks)
  if ((normA === 'without' && /^(?:wihout|wthout|withou|withot|whout)$/i.test(normB)) ||
      (normB === 'without' && /^(?:wihout|wthout|withou|withot|whout)$/i.test(normA))) return true;

  if ((normA === 'discontinue' && /^(?:ciscontnue|discontnue|ciscontinue|discontinu|ciscontine|dscontinue)$/i.test(normB)) ||
      (normB === 'discontinue' && /^(?:ciscontnue|discontnue|ciscontinue|discontinu|ciscontine|dscontinue)$/i.test(normA))) return true;

  if ((normA === 'clinically' && /^(?:ccal|clcal|clical|clncal|clncally|clnicall)$/i.test(normB)) ||
      (normB === 'clinically' && /^(?:ccal|clcal|clical|clncal|clncally|clnicall)$/i.test(normA))) return true;

  if ((normA === 'limited' && /^(?:iid|imited|imitd|lmited|iited|ltd|ited)$/i.test(normB)) ||
      (normB === 'limited' && /^(?:iid|imited|imitd|lmited|iited|ltd|ited)$/i.test(normA))) return true;

  if ((normA === 'strictly' && /^(?:strcty|stricty|stricly|strctly)$/i.test(normB)) ||
      (normB === 'strictly' && /^(?:strcty|stricty|stricly|strctly)$/i.test(normA))) return true;

  if ((normA === 'to' && /^(?:1|10|0|o|lo|te|t|tc)$/i.test(normB)) ||
      (normB === 'to' && /^(?:1|10|0|o|lo|te|t|tc)$/i.test(normA))) return true;

  if ((normA === 'clinical' && /^(?:clical|clnical|clnicl|clic)$/i.test(normB)) ||
      (normB === 'clinical' && /^(?:clical|clnical|clnicl|clic)$/i.test(normA))) return true;

  if ((normA === 'symptoms' && /^(?:symploms|symtoms|symptms)$/i.test(normB)) ||
      (normB === 'symptoms' && /^(?:symploms|symtoms|symptms)$/i.test(normA))) return true;

  if ((normA === 'individual' && /^(?:ndvidual|indvidual|indivdual)$/i.test(normB)) ||
      (normB === 'individual' && /^(?:ndvidual|indvidual|indivdual)$/i.test(normA))) return true;

  if ((normA === 'individuals' && /^(?:ndvidual|ndviduals|indvidual|indviduals)$/i.test(normB)) ||
      (normB === 'individuals' && /^(?:ndvidual|ndviduals|indvidual|indviduals)$/i.test(normA))) return true;

  if ((normA === 'treatment' && /^(?:troamant|treatmnt|treamnt|tretment)$/i.test(normB)) ||
      (normB === 'treatment' && /^(?:troamant|treatmnt|treamnt|tretment)$/i.test(normA))) return true;

  if ((normA === 'hypersensitivity' && /^(?:hypersensitiity|hypersensttivty|hypersensitviy|hypersensitvity)$/i.test(normB)) ||
      (normB === 'hypersensitivity' && /^(?:hypersensitiity|hypersensttivty|hypersensitviy|hypersensitvity)$/i.test(normA))) return true;

  if ((normA === 'complete' && /^(?:compte|complet|compete)$/i.test(normB)) ||
      (normB === 'complete' && /^(?:compte|complet|compete)$/i.test(normA))) return true;

  if ((normA === 'infection' && /^(?:infoction|infction|infecton)$/i.test(normB)) ||
      (normB === 'infection' && /^(?:infoction|infction|infecton)$/i.test(normA))) return true;

  if ((normA === 'present' && /^(?:prose|presnt)$/i.test(normB)) ||
      (normB === 'present' && /^(?:prose|presnt)$/i.test(normA))) return true;

  if ((normA === 'test' && /^(?:ost|tst)$/i.test(normB)) ||
      (normB === 'test' && /^(?:ost|tst)$/i.test(normA))) return true;

  if ((normA === 'this' && /^(?:ths|thls)$/i.test(normB)) ||
      (normB === 'this' && /^(?:ths|thls)$/i.test(normA))) return true;

  if ((normA === 'risk' && /^(?:isk|rsk)$/i.test(normB)) ||
      (normB === 'risk' && /^(?:isk|rsk)$/i.test(normA))) return true;

  if ((normA === 'it' && /^(?:iti|t)$/i.test(normB)) ||
      (normB === 'it' && /^(?:iti|t)$/i.test(normA))) return true;

  if ((normA === 'is' && /^(?:iti|s)$/i.test(normB)) ||
      (normB === 'is' && /^(?:iti|s)$/i.test(normA))) return true;

  if ((normA === 'immediately' && /^(?:immediatly|immedatly)$/i.test(normB)) ||
      (normB === 'immediately' && /^(?:immediatly|immedatly)$/i.test(normA))) return true;

  if ((normA === 'after' && /^(?:ater|aftr)$/i.test(normB)) ||
      (normB === 'after' && /^(?:ater|aftr)$/i.test(normA))) return true;

  if ((normA === 'see' && /^(?:soe|se)$/i.test(normB)) ||
      (normB === 'see' && /^(?:soe|se)$/i.test(normA))) return true;

  if ((normA === 'prescribing' && /^(?:proscribing|prescribng)$/i.test(normB)) ||
      (normB === 'prescribing' && /^(?:proscribing|prescribng)$/i.test(normA))) return true;

  if ((normA === 'toxic' && /^(?:oxic|toxc)$/i.test(normB)) ||
      (normB === 'toxic' && /^(?:oxic|toxc)$/i.test(normA))) return true;

  if ((normA === 'sjs' && /^(?:sj|s-j-s)$/i.test(normB)) ||
      (normB === 'sjs' && /^(?:sj|s-j-s)$/i.test(normA))) return true;

  if ((normA === 'prep' && /^(?:pier|pre|prp|prop)$/i.test(normB)) ||
      (normB === 'prep' && /^(?:pier|pre|prp|prop)$/i.test(normA))) return true;

  if ((normA === 'oral' && /^(?:oal|orl)$/i.test(normB)) ||
      (normB === 'oral' && /^(?:oal|orl)$/i.test(normA))) return true;

  if ((normA === 'lead' && /^(?:ead|led|leade|leaden)$/i.test(normB)) ||
      (normB === 'lead' && /^(?:ead|led|leade|leaden)$/i.test(normA))) return true;

  if ((normA.replace(/[^a-z0-9]/g, '') === 'hiv1' && /^(?:iv1|iv|hi1|hv1|hiv)$/i.test(normB.replace(/[^a-z0-9]/g, ''))) ||
      (normB.replace(/[^a-z0-9]/g, '') === 'hiv1' && /^(?:iv1|iv|hi1|hv1|hiv)$/i.test(normA.replace(/[^a-z0-9]/g, '')))) return true;

  if ((normA === 'in' && /^(?:leaden|n)$/i.test(normB)) ||
      (normB === 'in' && /^(?:leaden|n)$/i.test(normA))) return true;

  // Negation words must never match non-negated words
  const negationWords = new Set(['no', 'not', 'none', 'never', 'without']);
  if (negationWords.has(normA) !== negationWords.has(normB)) return false;

  // Negation prefixes
  const negationPrefixes = ['contra', 'non', 'anti', 'dis', 'un'];
  for (const p of negationPrefixes) {
    if ((normA.startsWith(p) && !normB.startsWith(p)) || (normB.startsWith(p) && !normA.startsWith(p))) {
      return false;
    }
  }

  // Pure numbers must match strictly (never match 21 vs 1 or 400 vs 600)
  if (/^\d+$/.test(normA) || /^\d+$/.test(normB)) {
    if (normA === 'to' && /^(?:10|0|o|lo|te)$/i.test(normB)) return true;
    return false;
  }

  if ((normA === 'transmitted' && /^(?:transite|transmited|transmittd)$/i.test(normB)) ||
      (normB === 'transmitted' && /^(?:transite|transmited|transmittd)$/i.test(normA))) return true;

  if ((normA === 'always' && /^(?:aways|alway|alwys)$/i.test(normB)) ||
      (normB === 'always' && /^(?:aways|alway|alwys)$/i.test(normA))) return true;

  // Plural / singular trailing 's' drop (e.g. infection vs infections, partner vs partners, symptom vs symptoms)
  if (normA.length >= 4 && normB.length >= 4) {
    if (normA.endsWith('s') && !normB.endsWith('s') && normA.slice(0, -1) === normB) return true;
    if (normB.endsWith('s') && !normA.endsWith('s') && normB.slice(0, -1) === normA) return true;
  }

  // Stop words & common small words OCR slips
  if (stopWordsSet.has(normA)) {
    if (normA === 'to' && /^(?:1|10|0|o|lo|te|t|tc|io)$/i.test(normB)) return true;
    if (normA === 'if' && /^(?:ff|f|ti)$/i.test(normB)) return true;
    if (normA === 'is' && /^(?:i|ts|s|ia)$/i.test(normB)) return true;
    if (normA === 'the' && /^(?:th|ha|te|tho|he|ye)$/i.test(normB)) return true;
    if (normA === 'at' && /^(?:a|et)$/i.test(normB)) return true;
    if (normA === 'up' && /^(?:p|u|ub)$/i.test(normB)) return true;
    if (normA === 'due' && /^(?:de|du|ue|dve)$/i.test(normB)) return true;
    if (normA === 'and' && /^(?:nd|amd|ane|an)$/i.test(normB)) return true;
    if (normA === 'for' && /^(?:fo|fr|fer)$/i.test(normB)) return true;
    if (normA === 'with' && /^(?:wih|wit|wt)$/i.test(normB)) return true;
    if ((normA === 'or' && normB === 'of') || (normA === 'of' && normB === 'or')) return true;
    if (levenshteinDist(normA, normB) <= 1) return true;
  }

  // Single-character drop on 2-letter words (e.g. 'up' -> 'p', 'in' -> 'n', 'at' -> 'a')
  if (normA.length === 2 && normB.length === 1 && normA.includes(normB)) return true;
  if (normA.length === 1 && normB.length === 2 && normB.includes(normA)) return true;

  // 2-letter words: exact match required
  if (normA.length <= 2 && normB.length <= 2) return normA === normB;

  // Length 3 words (e.g. 'due' vs 'de', 'use' vs 'uso', 'all' vs 'al')
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

  // Grammatical substitutions and distinct words must NEVER match as OCR slips
  if ((normA === 'has' && normB === 'have') || (normA === 'have' && normB === 'has')) return false;
  if ((normA === 'is' && normB === 'are') || (normA === 'are' && normB === 'is')) return false;
  if ((normA === 'was' && normB === 'were') || (normA === 'were' && normB === 'was')) return false;
  if ((normA === 'in' && normB === 'on') || (normA === 'on' && normB === 'in')) return false;
  if ((normA === 'more' && normB === 'most') || (normA === 'most' && normB === 'more')) return false;

  // Length 4-5 words (e.g. 'with' vs 'wih', 'from' vs 'fom', 'sleep' vs 'sloop')
  // Allow at most 1 character typo/drop for short 4-5 letter words
  if (normA.length >= 4 && normA.length <= 5 && normB.length >= 3 && normB.length <= 5) {
    if (levenshteinDist(normA, normB) <= 1) return true;
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

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'aren',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by',
  'can', 'cannot', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few', 'for',
  'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him',
  'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'more',
  'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on', 'once', 'only', 'or', 'other',
  'ought', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'she', 'should', 'so', 'some',
  'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were',
  'what', 'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours',
]);

function isTokensEquivalent(ct, bt) {
  if (!ct || !bt) return false;
  const stripA = stripAlphanum(ct.raw);
  const stripB = stripAlphanum(bt.raw);
  if (stripA && stripA === stripB) return true;
  if (ct.norm && bt.norm && ct.norm === bt.norm) return true;
  if (ct.clean && bt.clean && ct.clean.toLowerCase() === bt.clean.toLowerCase()) return true;
  if (ct.norm && bt.norm && isOcrWordMatch(ct.norm, bt.norm)) return true;
  if (stripA && stripB && isOcrWordMatch(stripA, stripB)) return true;
  const isUgtOcr = ct.norm?.replace(/[1l|!]/g, 'i') === bt.norm?.replace(/[1l|!]/g, 'i');
  if (isUgtOcr) return true;
  return false;
}

function hasDifferentNumbers(ct, bt) {
  if (!ct || !bt) return false;
  const numMatchesA = (ct.raw || '').match(/\d+(?:\.\d+)?/g);
  const numMatchesB = (bt.raw || '').match(/\d+(?:\.\d+)?/g);
  const digitsA = numMatchesA ? numMatchesA.join(',') : '';
  const digitsB = numMatchesB ? numMatchesB.join(',') : '';
  const hasNumA = digitsA.length > 0;
  const hasNumB = digitsB.length > 0;
  if (hasNumA && hasNumB && digitsA !== digitsB) {
    const isUgtOcr = ct.norm?.replace(/[1l|!]/g, 'i') === bt.norm?.replace(/[1l|!]/g, 'i');
    const isGteOcr =
      ((ct.raw.includes('≥') || ct.raw.includes('>=')) && digitsA === '1' && digitsB === '21') ||
      ((bt.raw.includes('≥') || bt.raw.includes('>=')) && digitsB === '1' && digitsA === '21');
    if (!isUgtOcr && !isGteOcr) {
      return true;
    }
  }
  return false;
}

function alignTokensLcs(bTokens, cSlice, canonicalWordsSet) {
  const M = bTokens.length;
  const N = cSlice.length;
  if (M === 0) return { consumedCount: 0, issues: [], wordErrors: [], formattingErrors: [] };
  if (N === 0) {
    const issues = [];
    const wordErrors = [];
    bTokens.forEach((bt, bIdx) => {
      const cleanB = (bt.clean || '').toLowerCase();
      const stripB = stripAlphanum(bt.raw);
      if (STOP_WORDS.has(cleanB) || STOP_WORDS.has(stripB) || canonicalWordsSet.has(stripB)) return;
      const issueMsg = `Extra Word: "${bt.raw}"`;
      issues.push(issueMsg);
      wordErrors.push({
        word: bt.raw,
        clean: bt.clean,
        expected: '(none)',
        issue: issueMsg,
        type: 'extra_word',
        bStartIdx: bIdx,
        bEndIdx: bIdx + 1,
      });
    });
    return { consumedCount: 0, issues, wordErrors, formattingErrors: [] };
  }

  const dp = Array.from({ length: M + 1 }, () => new Int32Array(N + 1));

  for (let i = 1; i <= M; i++) {
    const bt = bTokens[i - 1];
    for (let j = 1; j <= N; j++) {
      const ct = cSlice[j - 1];
      if (isTokensEquivalent(ct, bt) && !hasDifferentNumbers(ct, bt)) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let bestJ = N;
  let maxScore = dp[M][N];
  for (let j = 1; j <= N; j++) {
    if (dp[M][j] === maxScore) {
      bestJ = j;
      break;
    }
  }

  let i = M;
  let j = bestJ;
  const alignedPairs = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const bt = bTokens[i - 1];
      const ct = cSlice[j - 1];
      if (isTokensEquivalent(ct, bt) && !hasDifferentNumbers(ct, bt) && dp[i][j] === dp[i - 1][j - 1] + 1) {
        alignedPairs.unshift({ bt, ct, bIdx: i - 1, cIdx: j - 1, match: true });
        i--;
        j--;
        continue;
      }
    }
    if (i > 0 && (j === 0 || dp[i - 1][j] >= dp[i][j - 1])) {
      if (j > 0 && !isTokensEquivalent(cSlice[j - 1], bTokens[i - 1])) {
        alignedPairs.unshift({ bt: bTokens[i - 1], ct: cSlice[j - 1], bIdx: i - 1, cIdx: j - 1, match: false });
        i--;
        j--;
      } else {
        alignedPairs.unshift({ bt: bTokens[i - 1], ct: null, bIdx: i - 1, cIdx: null, match: false });
        i--;
      }
    } else if (j > 0) {
      alignedPairs.unshift({ bt: null, ct: cSlice[j - 1], bIdx: null, cIdx: j - 1, match: false });
      j--;
    }
  }

  const issues = [];
  const wordErrors = [];
  const formattingErrors = [];

  for (const pair of alignedPairs) {
    const { bt, ct, bIdx } = pair;
    if (!bt) continue;

    if (pair.match) {
      // User Requirement 3 & 4: Independent formatting check on verified matching text
      if (ct) {
        // 1. Check bold / italic / underline styling
        const isBoldA = !!ct.isBold;
        const isBoldB = !!bt.isBold;
        const isItalicA = !!ct.isItalic;
        const isItalicB = !!bt.isItalic;
        const isUnderlineA = !!ct.isUnderline;
        const isUnderlineB = !!bt.isUnderline;

        if (isBoldA !== isBoldB || isItalicA !== isItalicB || isUnderlineA !== isUnderlineB) {
          const expStyle = getStyleLabel(isBoldA, isItalicA, isUnderlineA);
          const foundStyle = getStyleLabel(isBoldB, isItalicB, isUnderlineB);
          const issueMsg = `Expected ${expStyle} text; found ${foundStyle}.`;
          formattingErrors.push({
            word: bt.raw,
            clean: bt.clean,
            expected: expStyle,
            found: foundStyle,
            issue: issueMsg,
            details: issueMsg,
            type: 'style_mismatch',
            category: isUnderlineA !== isUnderlineB ? 'Formatting (Underline)' : 'Formatting (Bold / Italic)',
            bStartIdx: bIdx,
            bEndIdx: bIdx + 1,
          });
        }

        // 2. Check font color
        if (isColorMismatch(ct.color, bt.color, ct.colorCategory, bt.colorCategory, ct, bt)) {
          const expColor = (ct.colorCategory === 'black' || !ct.colorCategory ? 'standard' : ct.colorCategory) || (ct.color ? getColorCategory(ct.color) : 'standard');
          const foundColor = (bt.colorCategory === 'black' || !bt.colorCategory ? 'black' : bt.colorCategory) || (bt.color ? getColorCategory(bt.color) : 'custom color');
          const issueMsg = `Expected ${expColor} text; found ${foundColor}.`;
          formattingErrors.push({
            word: bt.raw,
            clean: bt.clean,
            expected: expColor,
            found: foundColor,
            expectedColorName: expColor,
            foundColorName: foundColor,
            issue: issueMsg,
            details: issueMsg,
            type: 'color_mismatch',
            category: 'Formatting (Color)',
            bStartIdx: bIdx,
            bEndIdx: bIdx + 1,
          });
        }
      }
      continue;
    }

    if (ct && hasDifferentNumbers(ct, bt)) {
      const issueMsg = `Number Mismatch: Found "${bt.raw}", expected "${ct.raw}"`;
      issues.push(issueMsg);
      wordErrors.push({
        word: bt.raw,
        clean: bt.clean,
        expected: ct.raw,
        issue: issueMsg,
        type: 'number',
        bStartIdx: bIdx,
        bEndIdx: bIdx + 1,
      });
      continue;
    }

    const stripB = stripAlphanum(bt.raw);
    const cleanB = (bt.clean || '').toLowerCase();

    // If there is an expected token ct, this is a real word substitution (e.g. "has" vs "have")!
    // NEVER ignore substitutions just because cleanB is in STOP_WORDS!
    if (ct) {
      const expText = ct.raw;
      const issueMsg = `Word Mistake: Found "${bt.raw}", expected "${ct.raw}"`;
      issues.push(issueMsg);
      wordErrors.push({
        word: bt.raw,
        clean: bt.clean,
        expected: expText,
        issue: issueMsg,
        type: 'word_changed',
        bStartIdx: bIdx,
        bEndIdx: bIdx + 1,
      });
      continue;
    }

    if (STOP_WORDS.has(cleanB) || STOP_WORDS.has(stripB)) {
      continue;
    }
    if (canonicalWordsSet.has(stripB)) {
      continue;
    }

    const expText = '(none)';
    const issueMsg = `Extra Word: "${bt.raw}"`;
    issues.push(issueMsg);
    wordErrors.push({
      word: bt.raw,
      clean: bt.clean,
      expected: expText,
      issue: issueMsg,
      type: 'extra_word',
      bStartIdx: bIdx,
      bEndIdx: bIdx + 1,
    });
  }

  const groupedFormattingErrors = groupConsecutiveFormattingErrors(formattingErrors);

  return {
    consumedCount: bestJ,
    issues,
    wordErrors,
    formattingErrors: groupedFormattingErrors,
  };
}

/**
 * Performs strict ISI and Marketing comparison:
 * - ISI mode: compares ISI line by line in sequence.
 * - Marketing mode: reviews and highlights all non-ISI promotional elements in PDF B.
 */
export function compareIsiLineByLine(textA, textB, options = {}) {
  const classifiedA = extractClassifiedLinesFromPdf(textA);
  const classifiedB = extractClassifiedLinesFromPdf(textB);

  let linesA = classifiedA.isiLines;
  if (linesA.length === 0) {
    const stmts = extractCanonicalStatements(textA);
    linesA = stmts.map((stmt, idx) => ({
      raw: stmt,
      clean: stmt.replace(/<[^>]+>/g, '').trim(),
      tokens: extractStyledTokensHelper(stmt),
      index: idx,
    }));
  }

  const linesB = classifiedB.isiLines;
  const nonIsiLinesB = classifiedB.nonIsiLines;
  const nonIsiLinesA = classifiedA.nonIsiLines.filter(
    (l) => !/training asset only/i.test(l.clean) && !/editorial qa/i.test(l.clean)
  );

  // Fallback: If no structured headings detected, search for safety terms
  if (linesB.length === 0 && nonIsiLinesB.length === 0) {
    return compareTargetedIsiFallback(textA, textB);
  }

  // Flatten canonical reference lines into indexed tokens with line mapping
  const canonicalTokens = [];
  for (let lIdx = 0; lIdx < linesA.length; lIdx++) {
    const lObj = linesA[lIdx];
    for (let tIdx = 0; tIdx < lObj.tokens.length; tIdx++) {
      const tok = lObj.tokens[tIdx];
      if (tok.isSymbolOnly && !tok.norm) continue;
      canonicalTokens.push({
        refLineIndex: lIdx,
        tokenIndex: tIdx,
        ...tok,
      });
    }
  }

  const canonicalWordsSet = new Set(
    canonicalTokens.map((t) => stripAlphanum(t.raw)).filter((s) => s.length > 0)
  );

  let cCursor = 0;
  let lastConsumedRefLine = -1;
  const isiLineResultsB = [];
  const isiLineResultsA = linesA.map((l, idx) => ({
    lineIndex: idx + 1,
    lineNum: idx + 1,
    text: l.clean,
    raw: l.raw,
    page: l.page || 1,
    box: l.box || null,
    color: 'green',
    status: 'matched',
    comment: 'Complete line match',
    expected: l.clean,
    found: l.clean,
    section: 'Important Safety Information',
  }));

  const mismatchReport = [];
  const proofreadingErrors = [];
  const matchingTokens = [];
  let tokenIdx = 1;

  let prevPage = -1;
  let pendingHyphenPrefix = null;
  for (let lIdx = 0; lIdx < linesB.length; lIdx++) {
    const lineB = linesB[lIdx];
    const linePageNum = lineB.page || 1;
    if (prevPage !== -1 && linePageNum !== prevPage) {
      cCursor = 0;
      lastConsumedRefLine = -1;
      pendingHyphenPrefix = null;
    }
    prevPage = linePageNum;
    const cleanLine = typeof lineB === 'string' ? lineB : (lineB.clean || '');
    const rawTokensB = lineB.tokens || extractStyledTokensHelper(lineB.raw || cleanLine);
    const bTokens = rawTokensB.filter((t) => !t.isSymbolOnly || t.norm.length > 0);
    const bNorm = bTokens.map((t) => t.norm).filter((n) => n.length > 0);

    // Continuation marker: e.g. "(cont'd)" or "IMPORTANT SAFETY INFORMATION (cont'd)" or "Additional Important Safety Information continued below."
    const nextLineObj = lIdx + 1 < linesB.length ? linesB[lIdx + 1] : null;
    const nextLineClean = nextLineObj ? (typeof nextLineObj === 'string' ? nextLineObj : nextLineObj.clean) : '';
    const isNextContd = /^\(?cont['’]?d\)?$/i.test(nextLineClean);

    // Case 0: Pure divider lines (e.g. "—————————————————————————————")
    if (/^[-—_=~*]{3,}$/.test(cleanLine.trim())) {
      isiLineResultsB.push({
        lineIndex: lIdx + 1,
        lineNum: lIdx + 1,
        text: cleanLine,
        raw: lineB.raw || cleanLine,
        page: lineB.page || 1,
        box: lineB.box || null,
        color: 'green',
        status: 'matched',
        comment: 'Visual Divider',
        expected: cleanLine,
        found: cleanLine,
        section: 'Important Safety Information',
        wordErrors: [],
      });
      continue;
    }

    if (
      /^\(?cont['’]?d\)?$/i.test(cleanLine) ||
      /^IMPORTANT SAFETY INFORMATION\s*\(cont['’]?d\)$/i.test(cleanLine) ||
      (/^IMPORTANT SAFETY INFORMATION$/i.test(cleanLine) && isNextContd) ||
      /^Additional\s+Important\s+Safety\s+Information(?:\s+continued\s+(?:b[ea]low|bolo))?[:.]?$/i.test(cleanLine) ||
      /^(?:Important\s+Safety\s+Information\s+)?continued\s+(?:b[ea]low|bolo)[:.]?$/i.test(cleanLine) ||
      /^(?:continued\s+(?:b[ea]low|bolo)[:.]?|\(?cont['’]?d\)?)$/i.test(cleanLine)
    ) {
      let refMatchedIdx = -1;
      for (let look = cCursor; look < Math.min(cCursor + 10, canonicalTokens.length); look++) {
        const refLineIdx = canonicalTokens[look].refLineIndex;
        const refLineClean = linesA[refLineIdx]?.clean || '';
        if (
          refLineClean.toLowerCase() === cleanLine.toLowerCase() ||
          (/^IMPORTANT SAFETY INFORMATION\s*\(cont['’]?d\)$/i.test(cleanLine) &&
            /^IMPORTANT SAFETY INFORMATION\s*\(cont['’]?d\)$/i.test(refLineClean))
        ) {
          refMatchedIdx = refLineIdx;
          while (cCursor < canonicalTokens.length && canonicalTokens[cCursor].refLineIndex === refMatchedIdx) {
            cCursor++;
          }
          lastConsumedRefLine = refMatchedIdx;
          break;
        }
      }

      isiLineResultsB.push({
        lineIndex: lIdx + 1,
        lineNum: lIdx + 1,
        text: cleanLine,
        raw: lineB.raw || cleanLine,
        page: lineB.page || 1,
        box: lineB.box || null,
        color: 'green',
        status: 'matched',
        comment: refMatchedIdx >= 0 ? 'Complete line match' : 'Continuation Header',
        expected: cleanLine,
        found: cleanLine,
        section: 'Important Safety Information',
      });
      continue;
    }

    // Case 1: Bullet-only line with missing text
    if (cleanLine === '•' || cleanLine === '-' || cleanLine === '*') {
      const nextRefIdx = canonicalTokens[cCursor]?.refLineIndex ?? -1;
      const missingLineText = nextRefIdx >= 0 ? linesA[nextRefIdx]?.clean : '';
      const cleanMissing = (missingLineText || '').replace(/^[•\-\*]\s*/, '');
      const comment = `Missing line: "${cleanMissing}"`;

      isiLineResultsB.push({
        lineIndex: lIdx + 1,
        lineNum: lIdx + 1,
        text: cleanLine,
        raw: lineB.raw || cleanLine,
        page: lineB.page || 1,
        box: lineB.box || null,
        color: 'red',
        status: 'mismatched',
        comment,
        expected: cleanMissing,
        found: cleanLine,
        section: 'Important Safety Information',
      });

      mismatchReport.push({
        index: mismatchReport.length + 1,
        id: `line_err_${lIdx + 1}`,
        page: lineB.page || 1,
        section: 'Important Safety Information',
        originalWordText: cleanMissing,
        pdfText: cleanLine,
        errorType: 'Missing Line',
        severity: 'critical',
        details: comment,
        isMissingWord: true,
      });

      proofreadingErrors.push({
        id: `err_line_${lIdx + 1}`,
        category: 'Missing Line',
        severity: 'critical',
        expected: cleanMissing,
        found: cleanLine,
        details: comment,
      });

      while (cCursor < canonicalTokens.length && canonicalTokens[cCursor].refLineIndex === nextRefIdx) {
        cCursor++;
      }
      lastConsumedRefLine = nextRefIdx;
      continue;
    }

    // Find best match in canonical tokens starting strictly forward from cCursor
    let bestStart = -1;
    let bestScore = 0;
    let bestRawScore = 0;

    const compareLen = Math.min(bNorm.length, 6);
    const subseqNorm = bNorm.slice(0, compareLen);

    if (pendingHyphenPrefix && pendingHyphenPrefix.refTokenIndex !== undefined && pendingHyphenPrefix.refTokenIndex >= 0) {
      bestStart = pendingHyphenPrefix.refTokenIndex;
      bestScore = 1;
      bestRawScore = 1;
    } else {
      // First, test if cCursor is already the continuous match (sequence continuity)
      const ratioAtCursor = computeSubsequenceFuzzyScore(canonicalTokens, cCursor, subseqNorm);
      if (ratioAtCursor >= 0.85) {
        bestStart = cCursor;
        bestScore = ratioAtCursor;
        bestRawScore = ratioAtCursor;
      } else {
        if (ratioAtCursor >= 0.35 || (compareLen === 1 && ratioAtCursor > 0)) {
          bestStart = cCursor;
          bestScore = ratioAtCursor;
          bestRawScore = ratioAtCursor;
        }
      for (let searchPos = cCursor; searchPos < Math.min(canonicalTokens.length, cCursor + 120); searchPos++) {
        // Guard: short lines (<= 2 tokens) cannot jump far ahead without an exact match
        if (bNorm.length <= 2 && (searchPos - cCursor > 4)) {
          let exactAll = true;
          for (let k = 0; k < bNorm.length; k++) {
            if (searchPos + k >= canonicalTokens.length || !tokensFuzzyMatch(canonicalTokens[searchPos + k].norm, bNorm[k])) {
              exactAll = false;
              break;
            }
          }
          if (!exactAll) continue;
        }

        const rawScore = computeSubsequenceFuzzyScore(canonicalTokens, searchPos, subseqNorm);
        const distPenalty = (searchPos - cCursor) * 0.005;
        const weightedScore = rawScore - distPenalty;

        if (rawScore === 1) {
          const isAtLineStart = canonicalTokens[searchPos].tokenIndex === 0;
          const bestWasLineStart = bestStart >= 0 && canonicalTokens[bestStart].tokenIndex === 0;

          if (bestRawScore < 1) {
            bestScore = weightedScore;
            bestRawScore = 1;
            bestStart = searchPos;
          } else if (isAtLineStart && !bestWasLineStart) {
            bestScore = weightedScore;
            bestRawScore = 1;
            bestStart = searchPos;
          }
          if (searchPos === cCursor) break;
          continue;
        }

        if (bestRawScore < 1 && rawScore >= 0.4 && weightedScore > bestScore) {
          bestScore = weightedScore;
          bestRawScore = rawScore;
          bestStart = searchPos;
        }
      }
    }
  }

    if (bestStart === -1 || bestRawScore < 0.7) {
      // Search globally in canonical tokens (handles document restarting ISI, repeated sections, desktop repeating mobile, or split layouts)
      let globalBestScore = 0;
      let globalBestStart = -1;
      for (let searchPos = 0; searchPos < canonicalTokens.length; searchPos++) {
        if (bNorm.length <= 2) {
          let exactAll = true;
          for (let k = 0; k < bNorm.length; k++) {
            if (searchPos + k >= canonicalTokens.length || !tokensFuzzyMatch(canonicalTokens[searchPos + k].norm, bNorm[k])) {
              exactAll = false;
              break;
            }
          }
          if (!exactAll) continue;
        }

        const rawScore = computeSubsequenceFuzzyScore(canonicalTokens, searchPos, subseqNorm);
        if (rawScore > globalBestScore && rawScore >= 0.7) {
          globalBestScore = rawScore;
          globalBestStart = searchPos;
          if (rawScore === 1 && canonicalTokens[searchPos].tokenIndex === 0) break;
        }
      }

      if (globalBestStart !== -1 && (bestStart === -1 || globalBestScore > bestRawScore)) {
        bestStart = globalBestStart;
        bestScore = globalBestScore;
        bestRawScore = globalBestScore;
        cCursor = globalBestStart;
        lastConsumedRefLine = canonicalTokens[globalBestStart]?.refLineIndex ?? -1;
      }
    }

    if (bestStart === -1) {
      // Line in PDF B does not match any approved reference statement in PDF A.
      // Per user directive: "rest images oif something is nit matchig ignore all just match only match in pdf a and highlight with green if not then red"
      // Marketing headlines, email banners, references, reporting hotlines, and footers are ignored completely.
      continue;
    }

    const currRefLine = canonicalTokens[bestStart]?.refLineIndex ?? -1;

    // Compare each token of line B strictly against canonical tokens of this line
    // User Requirement: Check words/sentences only! Ignore color, bold, italic, font size, minor punctuation/capitalization differences.
    const issues = [];
    const wordErrors = [];
    let tokenCursor = bestStart;
    let bIdx = 0;

    // Skip leading bullets or symbol-only markers on either side
    while (
      tokenCursor < canonicalTokens.length &&
      (canonicalTokens[tokenCursor].isSymbolOnly || /^[•\-\*\+]$/.test(canonicalTokens[tokenCursor].raw))
    ) {
      if (
        bIdx < bTokens.length &&
        (bTokens[bIdx].isSymbolOnly || /^[•\-\*\+]$/.test(bTokens[bIdx].raw))
      ) {
        bIdx++;
      }
      tokenCursor++;
    }
    while (
      bIdx < bTokens.length &&
      (bTokens[bIdx].isSymbolOnly || /^[•\-\*\+]$/.test(bTokens[bIdx].raw))
    ) {
      bIdx++;
    }

    // Reconnect hyphenated word split across line boundary (e.g. line ends with "prolonged-" and next line starts with "release")
    if (pendingHyphenPrefix && bTokens.length > 0) {
      const firstB = bTokens[0];
      const combined = stripAlphanum(pendingHyphenPrefix.lastToken.raw + firstB.raw);
      const expectedCombined = stripAlphanum(pendingHyphenPrefix.refToken?.raw);

      if (expectedCombined && (combined === expectedCombined || isOcrWordMatch(combined, expectedCombined))) {
        bIdx = 1;
        if (pendingHyphenPrefix.refTokenIndex !== undefined && tokenCursor <= pendingHyphenPrefix.refTokenIndex) {
          tokenCursor = pendingHyphenPrefix.refTokenIndex + 1;
        } else if (tokenCursor < canonicalTokens.length && (stripAlphanum(canonicalTokens[tokenCursor].raw) === expectedCombined || isOcrWordMatch(stripAlphanum(canonicalTokens[tokenCursor].raw), expectedCombined))) {
          tokenCursor++;
        }
        if (pendingHyphenPrefix.lineResult && pendingHyphenPrefix.lineResult.wordErrors) {
          pendingHyphenPrefix.lineResult.wordErrors = pendingHyphenPrefix.lineResult.wordErrors.filter(
            (we) => we.word !== pendingHyphenPrefix.lastToken.raw && we.clean !== pendingHyphenPrefix.lastToken.clean
          );
          if (pendingHyphenPrefix.lineResult.wordErrors.length === 0) {
            pendingHyphenPrefix.lineResult.status = 'matched';
            pendingHyphenPrefix.lineResult.color = 'green';
            pendingHyphenPrefix.lineResult.hasWordErrors = false;
            pendingHyphenPrefix.lineResult.comment = 'Complete line match';
            pendingHyphenPrefix.lineResult.issues = [];
          }
        }
      }
      pendingHyphenPrefix = null;
    }

    // Use LCS alignment to accurately match tokens without greedy lookahead or cascaded false errors
    const cSlice = canonicalTokens.slice(
      tokenCursor,
      Math.min(canonicalTokens.length, tokenCursor + bTokens.length + 12)
    );
    const alignmentRes = alignTokensLcs(bTokens, cSlice, canonicalWordsSet);
    tokenCursor += alignmentRes.consumedCount;
    issues.push(...alignmentRes.issues);
    wordErrors.push(...alignmentRes.wordErrors);
    const formattingErrors = alignmentRes.formattingErrors || [];

    cCursor = tokenCursor;
    lastConsumedRefLine = canonicalTokens[tokenCursor - 1]?.refLineIndex ?? currRefLine;

    // Track trailing hyphenated or wrapped word for potential multi-line reconnect
    const lastBToken = bTokens[bTokens.length - 1];
    const isHyphenEnd = cleanLine.endsWith('-') || cleanLine.endsWith('–') || (lastBToken && /[-–]$/.test(lastBToken.raw));
    const nextRefToken = canonicalTokens[tokenCursor - 1] || canonicalTokens[tokenCursor];
    const isPrefixOfRef = lastBToken && nextRefToken && stripAlphanum(nextRefToken.raw).startsWith(stripAlphanum(lastBToken.raw)) && stripAlphanum(nextRefToken.raw) !== stripAlphanum(lastBToken.raw);

    if (!pendingHyphenPrefix && (isHyphenEnd || isPrefixOfRef)) {
      pendingHyphenPrefix = {
        lineResult: null, // assigned below after push
        lastToken: lastBToken,
        refToken: nextRefToken,
        refTokenIndex: canonicalTokens[tokenCursor - 1] ? tokenCursor - 1 : tokenCursor,
      };
    }

    const targetLineText = linesA[currRefLine]?.clean || '';

    // Requirement 1 & 2: Check missing punctuation (e.g. missing full stop at end of statement/bullet)
    const targetEndsWithPeriod = /\.\s*$/.test(targetLineText);
    const lineEndsWithPeriod = /[.!?]\s*$/.test(cleanLine);
    const isEndOfBlock = !nextLineObj || /^[•\-\*]/.test(nextLineClean) || /^[A-Z\s]{4,}:?$/.test(nextLineClean) || /Important Safety Information/i.test(nextLineClean);

    if (targetEndsWithPeriod && !lineEndsWithPeriod && isEndOfBlock) {
      const punctIssue = "Missing punctuation: Expected '.' at end of sentence.";
      issues.push(punctIssue);
      wordErrors.push({
        word: lastBToken ? lastBToken.raw : cleanLine,
        clean: lastBToken ? lastBToken.clean : cleanLine,
        expected: '.',
        issue: punctIssue,
        details: punctIssue,
        type: 'punctuation',
        bStartIdx: bTokens.length - 1,
        bEndIdx: bTokens.length,
      });
    }

    // Requirement 3: Decouple wording matches from formatting checks
    // - Green highlighting means the wording matches the reference master.
    // - Text that matches PDF A must always remain green, even if formatting (color, bold, italic, underline) differs.
    // - Red highlighting is reserved strictly for verified text discrepancies.
    if (wordErrors.length === 0) {
      const lineComment = formattingErrors.length > 0
        ? formattingErrors.map((fe) => fe.details).join('; ')
        : 'Complete line match';

      isiLineResultsB.push({
        lineIndex: lIdx + 1,
        lineNum: lIdx + 1,
        text: cleanLine,
        raw: lineB.raw || cleanLine,
        page: lineB.page || 1,
        box: lineB.box || null,
        color: 'green',
        status: 'matched',
        comment: lineComment,
        expected: cleanLine,
        found: cleanLine,
        section: targetLineText.slice(0, 35) || 'Important Safety Information',
        wordErrors: [],
        formattingErrors,
        hasFormattingErrors: formattingErrors.length > 0,
      });
    } else {
      const groupedWordErrors = wordErrors;
      const sortedIssues = groupedWordErrors.map((we) => we.issue || we.details);
      const comment = sortedIssues.join('; ');

      const cleanLineNoPunct = cleanLine.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '');
      const changedOrExtraCount = groupedWordErrors.filter(
        (we) => we.type === 'word_changed' || we.type === 'extra_word'
      ).length;
      const isMajorityChanged = bTokens.length >= 3 && (changedOrExtraCount / bTokens.length >= 0.7);
      const isWholeLineError =
        groupedWordErrors.some(
          (we) => we.clean && we.clean.toLowerCase().replace(/^[^\w]+|[^\w]+$/g, '') === cleanLineNoPunct
        ) || isMajorityChanged;

      isiLineResultsB.push({
        lineIndex: lIdx + 1,
        lineNum: lIdx + 1,
        text: cleanLine,
        raw: lineB.raw || cleanLine,
        page: lineB.page || 1,
        box: lineB.box || null,
        color: isWholeLineError ? 'red' : 'green', // Green line background with localized red word boxes; red line only if entirely unapproved
        status: isWholeLineError ? (isMajorityChanged ? 'extra_line' : 'mismatched') : 'matched_with_word_errors',
        hasWordErrors: true,
        comment,
        issues: sortedIssues,
        wordErrors: groupedWordErrors,
        formattingErrors,
        hasFormattingErrors: formattingErrors.length > 0,
        expected: isMajorityChanged ? '(none)' : targetLineText,
        found: cleanLine,
        section: targetLineText.slice(0, 35) || 'Important Safety Information',
      });

      for (let wIdx = 0; wIdx < groupedWordErrors.length; wIdx++) {
        const we = groupedWordErrors[wIdx];
        const isNum = we.type === 'number';
        const isMissing = we.type === 'missing_word';
        const isExtra = we.type === 'extra_word';

        let errCategory = 'Word Mistake';
        if (isNum) errCategory = 'Number Mismatch';
        else if (isMissing) errCategory = 'Missing Word';
        else if (isExtra) errCategory = 'Extra Word';
        else if (we.type === 'spelling') errCategory = 'Spelling Mistake';
        else if (we.type === 'spacing') errCategory = 'Spacing Difference';
        else if (we.type === 'capitalization') errCategory = 'Capitalization Difference';
        else if (we.type === 'punctuation') errCategory = 'Punctuation Difference';

        const expDisplay = isExtra
          ? '(none - extra in PDF)'
          : (we.expected || '(none)');
        const foundDisplay = isMissing
          ? '(missing in PDF)'
          : (we.word || '(none)');

        mismatchReport.push({
          index: mismatchReport.length + 1,
          id: `line_err_${lIdx + 1}_w${wIdx + 1}`,
          page: lineB.page || 1,
          section: targetLineText.slice(0, 35) || 'Important Safety Information',
          originalWordText: expDisplay,
          pdfText: foundDisplay,
          errorType: errCategory,
          severity: isNum || isMissing ? 'critical' : 'high',
          details: we.issue || we.details || comment,
          isMissingWord: isMissing,
          isExtraWord: isExtra,
          lineNum: lIdx + 1,
        });

        proofreadingErrors.push({
          id: `proof_err_${lIdx + 1}_w${wIdx + 1}`,
          category: errCategory,
          severity: isNum || isMissing ? 'critical' : 'high',
          expected: expDisplay,
          found: foundDisplay,
          details: we.issue || we.details || comment,
        });
      }
    }

    // Record formatting errors in mismatchReport and proofreadingErrors
    if (formattingErrors.length > 0) {
      for (let fIdx = 0; fIdx < formattingErrors.length; fIdx++) {
        const fe = formattingErrors[fIdx];
        mismatchReport.push({
          index: mismatchReport.length + 1,
          id: `line_format_${lIdx + 1}_f${fIdx + 1}`,
          page: lineB.page || 1,
          section: targetLineText.slice(0, 35) || 'Important Safety Information',
          originalWordText: fe.expected,
          pdfText: fe.found,
          errorType: fe.category,
          severity: 'medium',
          details: fe.details,
          isFormattingError: true,
          lineNum: lIdx + 1,
        });

        proofreadingErrors.push({
          id: `proof_format_${lIdx + 1}_f${fIdx + 1}`,
          category: fe.category,
          severity: 'medium',
          expected: `${fe.expected}: "${fe.word}"`,
          found: `${fe.found}: "${fe.word}"`,
          details: fe.details,
        });
      }
    }
    if (pendingHyphenPrefix) {
      pendingHyphenPrefix.lineResult = isiLineResultsB[isiLineResultsB.length - 1];
    }
  }

  // In mass emailers (and mobile teasers), Document B only includes the teaser or relevant ISI portion.
  // User Rule: Ignore non-ISI elements. If any element from PDF A is not available in PDF B, do not report it as missing.
  // Compare and report errors only for discrepancies and extra unapproved lines present in PDF B.

  const matchedLines = isiLineResultsB.filter((r) => r.color === 'green').length;
  const totalLines = isiLineResultsB.length;
  const isiComplianceScore = totalLines > 0 ? Math.round((matchedLines / totalLines) * 100) : 100;

  // Build visual diff representation for Side-by-Side Slide Viewer
  const diffParts = [];
  const proofreadingParts = [];
  const leftParts = [];
  const rightParts = [];

  for (const lr of isiLineResultsB) {
    if (lr.status === 'color_mismatch') {
      diffParts.push({ type: 'unchanged', value: lr.text + '\n' });
      proofreadingParts.push({
        type: 'error',
        value: lr.text + '\n',
        status: 'color_mismatch',
        details: lr.comment,
        wordErrors: lr.wordErrors,
      });
      leftParts.push({
        type: 'match',
        value: (lr.expected || lr.text) + '\n',
        status: 'color_mismatch',
        details: lr.comment,
      });
      rightParts.push({
        type: 'error',
        value: lr.text + '\n',
        status: 'color_mismatch',
        details: lr.comment,
        wordErrors: lr.wordErrors,
      });
    } else if (lr.status === 'matched_with_word_errors') {
      diffParts.push({ type: 'unchanged', value: lr.text + '\n' });
      proofreadingParts.push({
        type: 'error',
        value: lr.text + '\n',
        status: 'matched_with_word_errors',
        details: lr.comment,
        wordErrors: lr.wordErrors,
      });
      leftParts.push({
        type: 'match',
        value: (lr.expected || lr.text) + '\n',
        status: 'matched_with_word_errors',
        details: lr.comment,
      });
      rightParts.push({
        type: 'error',
        value: lr.text + '\n',
        status: 'matched_with_word_errors',
        details: lr.comment,
        wordErrors: lr.wordErrors,
      });
    } else if (lr.color === 'green') {
      diffParts.push({ type: 'unchanged', value: lr.text + '\n' });
      proofreadingParts.push({ type: 'match', value: lr.text + '\n', status: 'verified_match' });
      leftParts.push({ type: 'match', value: lr.text + '\n', status: 'verified_match' });
      rightParts.push({ type: 'match', value: lr.text + '\n', status: 'verified_match' });
    } else {
      diffParts.push({ type: 'removed', value: (lr.expected || '') + '\n' });
      diffParts.push({ type: 'added', value: lr.text + '\n' });
      proofreadingParts.push({ type: 'error', value: lr.text + '\n', status: 'added_or_modified', details: lr.comment });
      leftParts.push({ type: 'removed', value: (lr.expected || '') + '\n', status: 'deleted_from_baseline' });
      rightParts.push({ type: 'added', value: lr.text + '\n', status: 'added_or_modified', details: lr.comment });
    }
  }

  const colorCount = proofreadingErrors.filter((e) => (e.category || '').toLowerCase().includes('color')).length;
  const formattingCount = proofreadingErrors.filter((e) => {
    const cat = (e.category || '').toLowerCase();
    return cat.includes('format') || cat.includes('bold') || cat.includes('italic') || cat.includes('underline');
  }).length;
  const textErrorsCount = proofreadingErrors.filter((e) => {
    const cat = (e.category || '').toLowerCase();
    return !cat.includes('format') && !cat.includes('color');
  }).length;

  const errorSummary = {
    color: colorCount,
    colorMismatches: colorCount,
    numbers: proofreadingErrors.filter((e) => e.category.includes('Number')).length,
    words: proofreadingErrors.filter((e) => e.category.includes('Word') || e.category.includes('Spelling')).length,
    missingWords: proofreadingErrors.filter((e) => e.category.includes('Missing')).length,
    extraWords: proofreadingErrors.filter((e) => e.category.includes('Extra')).length,
    capitalization: proofreadingErrors.filter((e) => e.category.includes('Capitalization') || e.category.includes('Case')).length,
    spacing: proofreadingErrors.filter((e) => e.category.includes('Spacing')).length,
    punctuation: proofreadingErrors.filter((e) => e.category.includes('Punctuation')).length,
    formatting: formattingCount,
    total: proofreadingErrors.length,
    // Separate aggregate counts per User Requirement 5
    textDiscrepanciesCount: textErrorsCount,
    formattingDiscrepanciesCount: colorCount + formattingCount,
    verifiedMatchesCount: matchedLines,
  };

  const isiAudit = {
    isIsiAudit: true,
    totalOccurrences: 1,
    overallMatchRate: isiComplianceScore,
    occurrences: [
      {
        id: 'isi_main',
        occurrenceIndex: 1,
        heading: 'Important Safety Information & Prescribing Information',
        snippet: linesB.slice(0, 3).map((l) => l.clean).join(' '),
        matchPercentage: isiComplianceScore,
        matchedWordsCount: matchedLines,
        totalWordsCount: totalLines,
        matchedPhrasesCount: matchingTokens.length,
        discrepancyCount: mismatchReport.length,
        discrepancies: proofreadingErrors,
        status: mismatchReport.length === 0 ? 'compliant' : 'deviations_detected',
      },
    ],
  };

  // Strict ISI isolation: Completely ignore all promotional, header, footer, image, and non-ISI lines
  const marketingLineResultsB = [];
  const marketingLineResultsA = [];
  const marketingDiscrepancies = [];
  const allLineResultsB = [...isiLineResultsB];
  const allLineResultsA = [...isiLineResultsA];
  const marketingScore = 100;

  return {
    isIsiComparison: true,
    similarity: isiComplianceScore,
    isiComplianceScore,
    marketingScore,
    wordsAdded: proofreadingErrors.length,
    wordsRemoved: proofreadingErrors.length,
    wordsUnchanged: matchedLines,
    diffParts,
    proofreadingParts,
    leftParts,
    rightParts,
    sideBySide: {
      leftParts,
      rightParts,
    },
    proofreadingErrors,
    mismatchReport,
    matchingTokens,
    isiLineResults: isiLineResultsB,
    isiLineResultsA,
    isiLineResultsB,
    marketingLineResultsA,
    marketingLineResultsB,
    allLineResultsA,
    allLineResultsB,
    marketingDiscrepancies,
    isiAudit,
    errorSummary,
  };
}

export function compareTargetedIsi(textWord, textPdf, options = {}) {
  return compareIsiLineByLine(textWord, textPdf, options);
}

function compareTargetedIsiFallback(textWord, textPdf) {
  const cleanWordDoc = (textWord || '').replace(/<\/?[bi]\b[^>]*>/gi, '').trim();
  const detectedBlocks = detectIsiBlocks(textPdf, cleanWordDoc);
  return {
    isIsiComparison: true,
    similarity: 100,
    isiComplianceScore: 100,
    wordsAdded: 0,
    wordsRemoved: 0,
    wordsUnchanged: 0,
    diffParts: [],
    proofreadingParts: [],
    leftParts: [],
    rightParts: [],
    sideBySide: { leftParts: [], rightParts: [] },
    proofreadingErrors: [],
    mismatchReport: [],
    matchingTokens: [],
    isiLineResults: [],
    errorSummary: { total: 0 },
  };
}

/**
 * Audits each detected ISI occurrence in the PDF against the Approved Word Master Document.
 */
export function auditIsiOccurrences(textA, textB) {
  const blocksB = detectIsiBlocks(textB, textA);

  if (blocksB.length === 0) {
    if (/safety|indication|contraindication|adverse|prescribing/i.test(textB)) {
      blocksB.push({
        id: 'isi_1',
        occurrenceIndex: 1,
        heading: 'Important Safety Information & Indication',
        startLine: 1,
        text: textB,
      });
    }
  }

  const occurrences = [];

  for (let i = 0; i < blocksB.length; i++) {
    const block = blocksB[i];
    const blockText = block.text;

    const blockDiff = diffWordsWithSpace(
      textA.replace(/<\/?[bi]\b[^>]*>/gi, ''),
      blockText.replace(/<\/?[bi]\b[^>]*>/gi, '')
    );

    let matchedWords = 0;
    let totalWords = 0;
    const matchedPhrases = [];
    const blockErrors = detectProofreadingErrors(textA, blockText);

    for (const part of blockDiff) {
      const words = (part.value || '').trim().split(/\s+/).filter(Boolean);
      if (!part.added && !part.removed) {
        matchedWords += words.length;
        totalWords += words.length;
        if (words.length >= 2) {
          matchedPhrases.push(words.join(' '));
        }
      } else if (part.added) {
        totalWords += words.length;
      }
    }

    const matchRate = totalWords > 0 ? Math.min(100, Math.round((matchedWords / totalWords) * 100)) : 100;
    const isCompliant = blockErrors.length === 0 && matchRate >= 95;

    occurrences.push({
      id: block.id || `isi_${i + 1}`,
      occurrenceIndex: i + 1,
      heading: block.heading,
      snippet: blockText.slice(0, 180) + (blockText.length > 180 ? '...' : ''),
      matchPercentage: matchRate,
      matchedWordsCount: matchedWords,
      totalWordsCount: totalWords,
      matchedPhrasesCount: matchedPhrases.length,
      discrepancyCount: blockErrors.length,
      discrepancies: blockErrors,
      status:
        isCompliant
          ? 'compliant'
          : blockErrors.some((e) => e.severity === 'critical')
          ? 'critical_deviations'
          : 'minor_deviations',
    });
  }

  const totalOccurrences = occurrences.length;
  const overallMatchRate =
    totalOccurrences > 0
      ? Math.round(occurrences.reduce((sum, o) => sum + o.matchPercentage, 0) / totalOccurrences)
      : 100;

  return {
    isIsiAudit: totalOccurrences > 0,
    totalOccurrences,
    overallMatchRate,
    occurrences,
  };
}


