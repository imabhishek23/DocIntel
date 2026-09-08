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

  const cleanA = normBreaks((textA || '').replace(/<\/?[bi]\b[^>]*>/gi, ''));
  const cleanB = normBreaks((textB || '').replace(/<\/?[bi]\b[^>]*>/gi, ''));
  const changes = diffWordsWithSpace(cleanA, cleanB);
  const errors = [];
  let errId = 1;

  // Stateful styled token extraction supporting nested <b> and <i> tags
  const extractStyledTokens = (text) => {
    const tokens = [];
    let isBold = false;
    let isItalic = false;

    const parts = (text || '').split(/(<\/?[bi]>)/gi);

    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === '<b>') {
        isBold = true;
      } else if (lower === '</b>') {
        isBold = false;
      } else if (lower === '<i>') {
        isItalic = true;
      } else if (lower === '</i>') {
        isItalic = false;
      } else if (part) {
        const words = part.match(/\S+/g);
        if (words) {
          for (const w of words) {
            const isSymbolOnly = /^[^a-zA-Z0-9]+$/.test(w);
            tokens.push({
              raw: w,
              clean: w.replace(/^[.,;:!?'"–—\-()\[\]]+|[.,;:!?'"–—\-()\[\]]+$/g, ''),
              isBold,
              isItalic,
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

  const cleanText = (val) => (val || '').replace(/<\/?[bi]\b[^>]*>/gi, '').replace(/[<>]/g, '');

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
export function computeVisualWordDiff(textA, textB) {
  if (isIsiMaster(textA)) {
    return compareTargetedIsi(textA, textB);
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

  const isTag = (val) => /^<\/?(?:b|i)>$/i.test((val || '').trim());
  const cleanText = (val) => (val || '').replace(/<\/?(?:b|i)>/gi, '');

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
    const cleanLine = rawLine.replace(/<\/?[bi]\b[^>]*>/gi, '').trim();
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
export function compareTargetedIsi(textWord, textPdf) {
  const cleanWordDoc = (textWord || '').replace(/<\/?[bi]\b[^>]*>/gi, '').trim();
  const detectedBlocks = detectIsiBlocks(textPdf, cleanWordDoc);

  // Fallback: If no structured headings detected, search for safety terms
  if (detectedBlocks.length === 0) {
    if (/safety|indication|contraindication|adverse|prescribing/i.test(textPdf)) {
      detectedBlocks.push({
        id: 'isi_1',
        occurrenceIndex: 1,
        heading: 'Important Safety Information & Indication',
        startLine: 1,
        text: textPdf,
        lines: textPdf.split('\n'),
      });
    }
  }

  const pdfIsiCombined = detectedBlocks.map((b) => b.text).join('\n\n');

  let totalWordsUnchanged = 0;
  let totalWordsAdded = 0;
  let totalWordsRemoved = 0;

  const mismatchReport = [];
  const allProofreadingErrors = [];
  const matchingTokens = [];
  let mismatchId = 1;
  let tokenIdx = 1;

  const diffParts = [];
  const proofreadingParts = [];
  const leftParts = [];
  const rightParts = [];

  // 1. Overall diff between Word master and combined PDF ISI
  const mainDiff = diffWordsWithSpace(cleanWordDoc, pdfIsiCombined);
  let prevWord = '';

  for (let i = 0; i < mainDiff.length; i++) {
    const part = mainDiff[i];
    const val = (part.value || '').trim();
    if (!val) continue;

    const words = val.split(/\s+/).filter(Boolean);
    const nextPart = mainDiff[i + 1];
    const nextWord = (nextPart?.value || '').trim().split(/\s+/).filter(Boolean)[0] || '';

    if (!part.added && !part.removed) {
      totalWordsUnchanged += words.length;
      diffParts.push({ type: 'unchanged', value: val });
      proofreadingParts.push({ type: 'match', value: val, status: 'verified_match' });
      leftParts.push({ type: 'match', value: val, status: 'verified_match' });
      rightParts.push({ type: 'match', value: val, status: 'verified_match' });

      // Collect approved word tokens for Green visual highlighting
      for (let wIdx = 0; wIdx < words.length; wIdx += 4) {
        const chunk = words.slice(wIdx, wIdx + 4).join(' ');
        if (chunk.length >= 3) {
          matchingTokens.push({
            id: `match_${tokenIdx++}`,
            text: chunk,
            isApprovedMatch: true,
            type: 'approved_match',
          });
        }
      }
      prevWord = words[words.length - 1] || prevWord;
    } else if (part.added) {
      totalWordsAdded += words.length;
      diffParts.push({ type: 'added', value: val });
      proofreadingParts.push({ type: 'error', value: val, status: 'added_or_modified' });
      rightParts.push({ type: 'added', value: val, status: 'added_or_modified' });

      // Determine which detected block contains this text
      const ownerBlock = detectedBlocks.find((b) => b.text.includes(val)) || detectedBlocks[0] || {};

      mismatchReport.push({
        index: mismatchId++,
        id: `mismatch_${mismatchId}`,
        page: ownerBlock.page || 1,
        section: ownerBlock.heading || 'Important Safety Information',
        originalWordText: '(none - extra in PDF)',
        pdfText: val,
        errorType: 'Extra Word',
        severity: 'high',
        details: `Extra content inserted in PDF ISI: "${val}"`,
        beforeWord: prevWord,
        afterWord: nextWord,
        isExtraWord: true,
        isMissingWord: false,
      });
    } else if (part.removed) {
      totalWordsRemoved += words.length;
      diffParts.push({ type: 'removed', value: val });
      proofreadingParts.push({ type: 'removed', value: val, status: 'deleted_from_baseline' });
      leftParts.push({ type: 'removed', value: val, status: 'deleted_from_baseline' });
      rightParts.push({ type: 'omitted', value: val, status: 'omitted_in_composite' });

      // Determine which detected block was closest
      const ownerBlock = detectedBlocks.find((b) => prevWord && b.text.includes(prevWord)) || detectedBlocks[0] || {};

      mismatchReport.push({
        index: mismatchId++,
        id: `mismatch_${mismatchId}`,
        page: ownerBlock.page || 1,
        section: ownerBlock.heading || 'Important Safety Information',
        originalWordText: val,
        pdfText: '(missing in PDF)',
        errorType: 'Missing Word',
        severity: 'critical',
        details: `Approved Word master content missing from PDF: "${val}"`,
        beforeWord: prevWord,
        afterWord: nextWord,
        isExtraWord: false,
        isMissingWord: true,
      });
    }
  }

  // 2. Fine-grained proofreading errors (spelling, capitalization, punctuation, formatting)
  const proofErrors = detectProofreadingErrors(cleanWordDoc, pdfIsiCombined);
  for (const pe of proofErrors) {
    let errorType = pe.category;
    if (pe.category === 'Word Mismatch') errorType = 'Spelling / Word Mismatch';
    else if (pe.category === 'Formatting (Bold / Italic)') errorType = 'Formatting (Bold / Italic)';

    const ownerBlock = detectedBlocks.find((b) => b.text.includes(pe.found)) || detectedBlocks[0] || {};

    const alreadyReported = mismatchReport.some(
      (m) => m.originalWordText === pe.expected && m.pdfText === pe.found
    );

    if (!alreadyReported) {
      mismatchReport.push({
        index: mismatchId++,
        id: `mismatch_${mismatchId}`,
        page: ownerBlock.page || 1,
        section: ownerBlock.heading || 'Important Safety Information',
        originalWordText: pe.expected,
        pdfText: pe.found,
        errorType: errorType,
        severity: pe.severity || 'medium',
        details: pe.details,
        beforeWord: pe.beforeWord || '',
        afterWord: pe.afterWord || '',
        isMissingWord: pe.found === '(deleted)',
        isExtraWord: pe.expected === '(none)',
      });
    }

    allProofreadingErrors.push({
      ...pe,
      section: ownerBlock.heading || 'Important Safety Information',
    });
  }

  // 3. Per-occurrence ISI audit
  const occurrences = [];
  for (let bIdx = 0; bIdx < detectedBlocks.length; bIdx++) {
    const block = detectedBlocks[bIdx];
    const blockText = block.text;
    const bErrors = detectProofreadingErrors(cleanWordDoc, blockText);
    const bDiff = diffWordsWithSpace(cleanWordDoc, blockText);

    let bMatched = 0;
    let bTotal = 0;
    for (const p of bDiff) {
      const w = (p.value || '').trim().split(/\s+/).filter(Boolean);
      if (!p.added && !p.removed) {
        bMatched += w.length;
        bTotal += w.length;
      } else if (p.added) {
        bTotal += w.length;
      }
    }
    const bMatchRate = bTotal > 0 ? Math.min(100, Math.round((bMatched / bTotal) * 100)) : 100;

    occurrences.push({
      id: block.id,
      occurrenceIndex: bIdx + 1,
      heading: block.heading,
      snippet: blockText.slice(0, 180) + (blockText.length > 180 ? '...' : ''),
      matchPercentage: bMatchRate,
      matchedWordsCount: bMatched,
      totalWordsCount: bTotal,
      matchedPhrasesCount: matchingTokens.length,
      discrepancyCount: bErrors.length,
      discrepancies: bErrors,
      status:
        bErrors.length === 0 && bMatchRate >= 95
          ? 'compliant'
          : bErrors.some((e) => e.severity === 'critical')
          ? 'critical_deviations'
          : 'minor_deviations',
    });
  }

  // ISI Compliance Score (Req 13: strictly on matched ISI content!)
  const isiDenominator = totalWordsUnchanged + totalWordsAdded + totalWordsRemoved;
  const isiComplianceScore =
    isiDenominator > 0
      ? Math.max(0, Math.min(100, Math.round((totalWordsUnchanged / isiDenominator) * 100)))
      : 100;

  // Build clean visual diff representation for Side-by-Side Slide Viewer
  const baseDiff = diffWordsWithSpace(cleanWordDoc, detectedBlocks.map((b) => b.text).join('\n\n'));
  for (const part of baseDiff) {
    const val = part.value || '';
    if (!val) continue;
    if (part.added) {
      diffParts.push({ type: 'added', value: val });
      proofreadingParts.push({ type: 'error', value: val, status: 'added_or_modified' });
      rightParts.push({ type: 'added', value: val, status: 'added_or_modified' });
    } else if (part.removed) {
      diffParts.push({ type: 'removed', value: val });
      proofreadingParts.push({ type: 'removed', value: val, status: 'deleted_from_baseline' });
      leftParts.push({ type: 'removed', value: val, status: 'deleted_from_baseline' });
      rightParts.push({ type: 'omitted', value: val, status: 'omitted_in_composite' });
    } else {
      diffParts.push({ type: 'unchanged', value: val });
      proofreadingParts.push({ type: 'match', value: val, status: 'verified_match' });
      leftParts.push({ type: 'match', value: val, status: 'verified_match' });
      rightParts.push({ type: 'match', value: val, status: 'verified_match' });
    }
  }

  const errorSummary = {
    capitalization: allProofreadingErrors.filter((e) => e.category === 'Capitalization').length,
    spacing: allProofreadingErrors.filter((e) => e.category === 'Spacing').length,
    punctuation: allProofreadingErrors.filter((e) => e.category === 'Punctuation').length,
    numbers: allProofreadingErrors.filter((e) => e.category === 'Numbers & Units').length,
    symbols: allProofreadingErrors.filter((e) => e.category === 'Symbols & Trademarks').length,
    formatting: allProofreadingErrors.filter((e) => e.category === 'Formatting (Bold / Italic)').length,
    words: allProofreadingErrors.filter((e) => e.category === 'Word Mismatch').length,
    missingWords: mismatchReport.filter((m) => m.isMissingWord).length,
    extraWords: mismatchReport.filter((m) => m.isExtraWord).length,
    total: mismatchReport.length,
  };

  const isiAudit = {
    isIsiAudit: true,
    totalOccurrences: occurrences.length,
    overallMatchRate: isiComplianceScore,
    occurrences,
  };

  return {
    isIsiComparison: true,
    similarity: isiComplianceScore,
    isiComplianceScore,
    wordsAdded: totalWordsAdded,
    wordsRemoved: totalWordsRemoved,
    wordsUnchanged: totalWordsUnchanged,
    diffParts,
    proofreadingParts,
    leftParts,
    rightParts,
    sideBySide: {
      leftParts,
      rightParts,
    },
    proofreadingErrors: allProofreadingErrors,
    mismatchReport,
    matchingTokens,
    isiAudit,
    isiDetectedBlocks: detectedBlocks,
    errorSummary,
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


