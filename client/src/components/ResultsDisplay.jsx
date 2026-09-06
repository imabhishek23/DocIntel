import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import ScoreCard from './ScoreCard';
import {
  Download,
  MessageSquare,
  Copy,
  Check,
  RotateCcw,
  ShieldAlert,
  FileText,
  AlertTriangle,
  Scale,
  ListOrdered,
  Layers,
  ChevronRight,
  GitCompare,
  Eye,
  Columns,
  Image as ImageIcon,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Search,
  Lock,
  Unlock,
  Trash2,
  Plus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getExportUrl } from '../api';
import { diffWordsWithSpace } from 'diff';
import PdfVisualViewer from './PdfVisualViewer';

const EMPTY_DISCREPANCIES = [];

export default function ResultsDisplay({ result, mode = 'analyze', onReset, onOpenQA }) {
  const {
    reviewId,
    title,
    documentName,
    docAName,
    docBName,
    overallScore = 75,
    criticalCount = 0,
    highCount = 0,
    mediumCount = 0,
    lowCount = 0,
    verdict,
    summary = '',
    documentType,
    findings = [],
    changes = [],
    complianceGaps = [],
    obligations = [],
    extractedFields,
    deterministicDiffs = [],
    modelUsed,
    textA: rawTextA,
    textB: rawTextB,
    documentText,
    diffParts: backendDiffParts,
    similarity: backendSimilarity,
    wordsAdded: backendWordsAdded,
    wordsRemoved: backendWordsRemoved,
    imageA: initialImageA,
    imageB: initialImageB,
    hasImages,
    imagePreview,
    pdfUrlA,
    pdfUrlB,
    pdfA,
    pdfB,
    pdfUrl,
    pdfData,
    fileA,
    fileB,
    file,
  } = result;

  const [renderedImageA, setRenderedImageA] = useState(null);
  const [renderedImageB, setRenderedImageB] = useState(null);
  const imageA = initialImageA || renderedImageA;
  const imageB = initialImageB || renderedImageB;
  const hasBothImages = !!(imageA && imageB);

  const hasVisualDocuments = !!(
    pdfUrlA ||
    pdfA ||
    fileA ||
    pdfUrlB ||
    pdfB ||
    fileB ||
    imageA ||
    imageB ||
    hasImages
  );

  const [slideDisplayMode, setSlideDisplayMode] = useState(hasVisualDocuments ? 'visual' : 'redline');
  const [pdfZoom, setPdfZoom] = useState(1.0);
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotalPages, setPdfTotalPages] = useState(1);

  const [activeTab, setActiveTab] = useState(mode === 'compare' ? 'proofreading' : 'findings');
  const [diffView, setDiffView] = useState('slides'); // 'slides' | 'proofread' | 'inline' | 'slider' | 'images'
  const [highlightTarget, setHighlightTarget] = useState('composite'); // 'composite' | 'both'
  const [severityFilter, setSeverityFilter] = useState('all');
  const [proofCategoryFilter, setProofCategoryFilter] = useState('all');
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);

  // Synchronized scrolling refs & state
  const leftSlideRef = useRef(null);
  const rightSlideRef = useRef(null);
  const isScrollingRef = useRef(null);
  const isSyncingRef = useRef(false);
  const [syncScroll, setSyncScroll] = useState(true);

  // Resizable split-pane state & drag handling
  const [splitRatio, setSplitRatio] = useState(50); // Left slide width % (50 = 50/50 balanced)
  const [isDraggingSplit, setIsDraggingSplit] = useState(false);
  const [isDesktop, setIsDesktop] = useState(
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : true
  );
  const splitContainerRef = useRef(null);
  const stagingCanvasRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      setIsDesktop(window.innerWidth >= 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const handleMouseDownSplit = (e) => {
    e.preventDefault();
    setIsDraggingSplit(true);
  };

  const handleMouseMoveSplit = useCallback(
    (e) => {
      if (!isDraggingSplit || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = ((e.clientX - rect.left) / rect.width) * 100;
      const clamped = Math.min(85, Math.max(15, Math.round(pct)));
      setSplitRatio(clamped);
    },
    [isDraggingSplit]
  );

  const handleMouseUpSplit = useCallback(() => {
    setIsDraggingSplit(false);
  }, []);

  useEffect(() => {
    if (isDraggingSplit) {
      window.addEventListener('mousemove', handleMouseMoveSplit);
      window.addEventListener('mouseup', handleMouseUpSplit);
    } else {
      window.removeEventListener('mousemove', handleMouseMoveSplit);
      window.removeEventListener('mouseup', handleMouseUpSplit);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMoveSplit);
      window.removeEventListener('mouseup', handleMouseUpSplit);
    };
  }, [isDraggingSplit, handleMouseMoveSplit, handleMouseUpSplit]);

  // Slide comments & notes state (persisted locally)
  const storageKey = `docintel_comments_${reviewId || 'current'}`;
  const [comments, setComments] = useState(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [newCommentModalOpen, setNewCommentModalOpen] = useState(false);
  const [activeCommentTarget, setActiveCommentTarget] = useState({
    target: 'both', // 'slideA' | 'slideB' | 'both'
    snippet: '',
    errorId: null,
  });
  const [commentText, setCommentText] = useState('');
  const [commentTag, setCommentTag] = useState('Issue'); // 'Issue' | 'Question' | 'Todo' | 'Approved'
  const [showCommentsPanel, setShowCommentsPanel] = useState(true);
  const [commentCopied, setCommentCopied] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(comments));
    } catch {}
  }, [comments, storageKey]);

  const handleLeftScroll = () => {
    if (!syncScroll || !leftSlideRef.current || !rightSlideRef.current) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    const left = leftSlideRef.current;
    const right = rightSlideRef.current;

    // Vertical synchronization
    const maxLeftY = left.scrollHeight - left.clientHeight;
    if (maxLeftY > 0) {
      const pctY = left.scrollTop / maxLeftY;
      const maxRightY = right.scrollHeight - right.clientHeight;
      right.scrollTop = Math.round(pctY * maxRightY);
    }

    // Horizontal synchronization (for wide/big PDFs)
    const maxLeftX = left.scrollWidth - left.clientWidth;
    if (maxLeftX > 0) {
      const pctX = left.scrollLeft / maxLeftX;
      const maxRightX = right.scrollWidth - right.clientWidth;
      right.scrollLeft = Math.round(pctX * maxRightX);
    }

    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  };

  const handleRightScroll = () => {
    if (!syncScroll || !leftSlideRef.current || !rightSlideRef.current) return;
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;

    const left = leftSlideRef.current;
    const right = rightSlideRef.current;

    // Vertical synchronization
    const maxRightY = right.scrollHeight - right.clientHeight;
    if (maxRightY > 0) {
      const pctY = right.scrollTop / maxRightY;
      const maxLeftY = left.scrollHeight - left.clientHeight;
      left.scrollTop = Math.round(pctY * maxLeftY);
    }

    // Horizontal synchronization (for wide/big PDFs)
    const maxRightX = right.scrollWidth - right.clientWidth;
    if (maxRightX > 0) {
      const pctX = right.scrollLeft / maxRightX;
      const maxLeftX = left.scrollWidth - left.clientWidth;
      left.scrollLeft = Math.round(pctX * maxLeftX);
    }

    requestAnimationFrame(() => {
      isSyncingRef.current = false;
    });
  };

  const handleAddComment = () => {
    if (!commentText.trim()) return;
    const newComment = {
      id: `comm_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      text: commentText.trim(),
      tag: commentTag,
      target: activeCommentTarget.target,
      snippet: activeCommentTarget.snippet || '',
      errorId: activeCommentTarget.errorId || null,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    setComments((prev) => [newComment, ...prev]);
    setCommentText('');
    setNewCommentModalOpen(false);
  };

  const handleDeleteComment = (id) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
  };

  const handleCopyAllComments = () => {
    if (comments.length === 0) return;
    const text = comments
      .map(
        (c, idx) =>
          `[${idx + 1}] [${c.tag.toUpperCase()}] (${c.target === 'slideA' ? 'Document A' : c.target === 'slideB' ? 'Document B' : 'Both Documents'})` +
          (c.snippet ? `\nReferencing: "${c.snippet}"` : '') +
          `\nComment: ${c.text}\n`
      )
      .join('\n');
    navigator.clipboard.writeText(`=== REVIEWER SLIDE COMMENTS & NOTES ===\n\n${text}`);
    setCommentCopied(true);
    setTimeout(() => setCommentCopied(false), 2000);
  };

  // Extract or compute textA and textB for visual diff
  const { textA, textB } = useMemo(() => {
    let tA = rawTextA || '';
    let tB = rawTextB || '';

    if ((!tA || !tB) && documentText && documentText.includes('=== Document B:')) {
      const parts = documentText.split(/=== Document [AB]: [^\n]* ===\n/);
      if (parts.length >= 3) {
        tA = tA || (parts[1] || '').trim();
        tB = tB || (parts[2] || '').trim();
      }
    }
    return { textA: tA, textB: tB };
  }, [rawTextA, rawTextB, documentText]);

  // Compute or reuse word diff parts and counts
  const { diffParts, similarity, wordsAdded, wordsRemoved } = useMemo(() => {
    if (backendDiffParts && backendDiffParts.length > 0) {
      return {
        diffParts: backendDiffParts,
        similarity: backendSimilarity !== undefined ? backendSimilarity : overallScore,
        wordsAdded: backendWordsAdded || 0,
        wordsRemoved: backendWordsRemoved || 0,
      };
    }

    if (textA && textB) {
      const parts = diffWordsWithSpace(textA, textB);
      let added = 0;
      let removed = 0;
      let unchanged = 0;

      const mapped = parts.map((p) => {
        const words = p.value.trim().split(/\s+/).filter(Boolean).length;
        let type = 'unchanged';
        if (p.added) {
          added += words;
          type = 'added';
        } else if (p.removed) {
          removed += words;
          type = 'removed';
        } else {
          unchanged += words;
        }
        return { type, value: p.value };
      });

      const denominator = unchanged + added + removed;
      const sim = denominator > 0 ? Math.round((unchanged / denominator) * 100) : 100;

      return {
        diffParts: mapped,
        similarity: sim,
        wordsAdded: added,
        wordsRemoved: removed,
      };
    }

    return {
      diffParts: [],
      similarity: overallScore,
      wordsAdded: 0,
      wordsRemoved: 0,
    };
  }, [backendDiffParts, backendSimilarity, backendWordsAdded, backendWordsRemoved, textA, textB, overallScore]);

  // Compute or extract 100% granular proofreading error breakdown
  const { proofreadingErrors, errorSummary } = useMemo(() => {
    if (result.proofreadingErrors && result.proofreadingErrors.length > 0) {
      const errs = result.proofreadingErrors;
      const sum = result.errorSummary || {
        capitalization: errs.filter((e) => e.category === 'Capitalization').length,
        spacing: errs.filter((e) => e.category === 'Spacing').length,
        punctuation: errs.filter((e) => e.category === 'Punctuation').length,
        numbers: errs.filter((e) => e.category === 'Numbers & Units').length,
        symbols: errs.filter((e) => e.category === 'Symbols & Trademarks').length,
        formatting: errs.filter((e) => e.category === 'Formatting (Bold / Italic)').length,
        words: errs.filter((e) => e.category === 'Word Mismatch').length,
        total: errs.length,
      };
      return { proofreadingErrors: errs, errorSummary: sum };
    }

    if (textA && textB) {
      const changes = diffWordsWithSpace(textA, textB);
      const errors = [];
      let errId = 1;

      for (let i = 0; i < changes.length; i++) {
        const curr = changes[i];
        const next = changes[i + 1];

        if (curr.removed && next && next.added) {
          const trimA = curr.value.trim();
          const trimB = next.value.trim();
          const afterNext = changes[i + 2];

          if (afterNext && afterNext.added && (trimB + afterNext.value.trim()).toLowerCase() === trimA.toLowerCase()) {
            const combinedFound = `${trimB} ${afterNext.value.trim()}`;
            errors.push({
              id: `err_${errId++}`,
              category: 'Spacing',
              type: 'space_anomaly',
              severity: 'medium',
              expected: trimA,
              found: combinedFound,
              details: `Spacing error: Word '${trimA}' was split by an extra space into '${combinedFound}'`,
            });
            i += 2;
            continue;
          }

          if (trimA.toLowerCase() === trimB.toLowerCase() && trimA !== trimB) {
            errors.push({
              id: `err_${errId++}`,
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

          if (trimA.replace(/\s+/g, '') === trimB.replace(/\s+/g, '')) {
            errors.push({
              id: `err_${errId++}`,
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

          const isNumA = /^[\d,.]+(?:\s*(?:mg\/mL|mg\/kg|mg|kg|mL|g|°C|%|years?|months?|days?|hours?))?$/i.test(trimA);
          const isNumB = /^[\d,.]+(?:\s*(?:mg\/mL|mg\/kg|mg|kg|mL|g|°C|%|years?|months?|days?|hours?))?$/i.test(trimB);
          if (isNumA || isNumB) {
            errors.push({
              id: `err_${errId++}`,
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

          if (/[®™©₂₃½¼¾]/.test(trimA) || /[®™©₂₃½¼¾]/.test(trimB)) {
            errors.push({
              id: `err_${errId++}`,
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

          errors.push({
            id: `err_${errId++}`,
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

        if (curr.removed) {
          const trimA = curr.value.trim();
          if (!trimA) continue;

          if (/^[.,;:!?'"–—\-()\[\]]+$/.test(trimA)) {
            const prevWord = (changes[i - 1]?.value || '').trim().split(/\s+/).pop() || '';
            const expectedContext = prevWord ? `${prevWord}${trimA}` : trimA;
            const foundContext = prevWord || '(omitted)';
            errors.push({
              id: `err_${errId++}`,
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

          if (/[®™©]/.test(trimA)) {
            errors.push({
              id: `err_${errId++}`,
              category: 'Symbols & Trademarks',
              type: 'missing_symbol',
              severity: 'high',
              expected: trimA,
              found: '(omitted)',
              details: `Trademark symbol '${trimA}' was removed in Document B`,
            });
            continue;
          }

          errors.push({
            id: `err_${errId++}`,
            category: 'Word Mismatch',
            type: 'word_deleted',
            severity: 'high',
            expected: trimA,
            found: '(deleted)',
            details: `Text deleted from baseline: '${trimA}'`,
          });
          continue;
        }

        if (curr.added) {
          const trimB = curr.value.trim();
          if (!trimB) continue;

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

          if (/^[.,;:!?'"–—\-()\[\]]+$/.test(trimB)) {
            errors.push({
              id: `err_${errId++}`,
              category: 'Punctuation',
              type: 'extra_punctuation',
              severity: 'medium',
              expected: '(none)',
              found: trimB,
              details: `Extra punctuation introduced: '${trimB}'`,
            });
            continue;
          }

          if (/[®™©]/.test(trimB)) {
            errors.push({
              id: `err_${errId++}`,
              category: 'Symbols & Trademarks',
              type: 'extra_symbol',
              severity: 'high',
              expected: '(none)',
              found: trimB,
              details: `New trademark symbol added: '${trimB}'`,
            });
            continue;
          }

          errors.push({
            id: `err_${errId++}`,
            category: 'Word Mismatch',
            type: 'word_inserted',
            severity: 'high',
            expected: '(none)',
            found: trimB,
            details: `Inserted content in revision: '${trimB}'`,
          });
        }
      }

      return {
        proofreadingErrors: errors,
        errorSummary: {
          capitalization: errors.filter((e) => e.category === 'Capitalization').length,
          spacing: errors.filter((e) => e.category === 'Spacing').length,
          punctuation: errors.filter((e) => e.category === 'Punctuation').length,
          numbers: errors.filter((e) => e.category === 'Numbers & Units').length,
          symbols: errors.filter((e) => e.category === 'Symbols & Trademarks').length,
          formatting: errors.filter((e) => e.category === 'Formatting (Bold / Italic)').length,
          words: errors.filter((e) => e.category === 'Word Mismatch').length,
          total: errors.length,
        },
      };
    }

    return {
      proofreadingErrors: [],
      errorSummary: { capitalization: 0, spacing: 0, punctuation: 0, numbers: 0, symbols: 0, formatting: 0, words: 0, total: 0 },
    };
  }, [result.proofreadingErrors, result.errorSummary, textA, textB]);

  // Compute or extract side-by-side slide tokens
  const { leftParts, rightParts } = useMemo(() => {
    if (result.leftParts && result.rightParts && result.leftParts.length > 0) {
      return { leftParts: result.leftParts, rightParts: result.rightParts };
    }
    const lp = [];
    const rp = [];
    for (const part of diffParts) {
      if (part.type === 'removed') {
        lp.push({ type: 'removed', value: part.value, isBold: part.isBold, isItalic: part.isItalic });
        rp.push({ type: 'omitted', value: part.value, isBold: part.isBold, isItalic: part.isItalic });
      } else if (part.type === 'added') {
        rp.push({ type: 'added', value: part.value, isBold: part.isBold, isItalic: part.isItalic });
      } else {
        lp.push({ type: 'match', value: part.value, isBold: part.isBold, isItalic: part.isItalic });
        rp.push({ type: 'match', value: part.value, isBold: part.isBold, isItalic: part.isItalic });
      }
    }
    return { leftParts: lp, rightParts: rp };
  }, [result.leftParts, result.rightParts, diffParts]);

  const handleCopySummary = () => {
    navigator.clipboard.writeText(summary);
    setCopiedSummary(true);
    setTimeout(() => setCopiedSummary(false), 2000);
  };

  const filteredFindings = findings.filter((f) => {
    if (severityFilter === 'all') return true;
    return f.severity === severityFilter;
  });

  const getSeverityBadge = (sev) => {
    const s = (sev || 'low').toLowerCase();
    switch (s) {
      case 'critical':
        return <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-bold text-rose-700">CRITICAL</span>;
      case 'high':
        return <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-bold text-amber-800">HIGH</span>;
      case 'medium':
        return <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-800">MEDIUM</span>;
      default:
        return <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">LOW</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-xs font-bold text-white uppercase tracking-wider">
              {mode} mode
            </span>
            <span className="text-xs text-slate-400">•</span>
            <span className="text-xs text-slate-500">Engine: {modelUsed || 'DocIntel Forensic AI'}</span>
          </div>
          <h2 className="mt-1 font-display text-xl font-bold text-slate-900">
            {mode === 'compare'
              ? `${docAName || 'Document A'} VS ${docBName || 'Document B'}`
              : (documentName || title || 'Document Audit Report')}
          </h2>
          {documentType && <p className="text-xs text-slate-500">Document Type: {documentType}</p>}
        </div>

        {/* Action buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => onOpenQA(result)}
            className="flex items-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-indigo-700 transition"
          >
            <MessageSquare className="h-4 w-4" />
            Ask AI Assistant
          </button>

          {reviewId && (
            <div className="flex items-center gap-1">
              <a
                href={getExportUrl(reviewId, 'markdown')}
                download
                className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="h-3.5 w-3.5 text-slate-500" />
                Markdown
              </a>
              <a
                href={getExportUrl(reviewId, 'json')}
                download
                className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 transition"
              >
                <Download className="h-3.5 w-3.5 text-slate-500" />
                JSON
              </a>
            </div>
          )}

          <button
            onClick={onReset}
            className="flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            New Review
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          COMPARE MODE: Top 3 Stat Cards (Similarity, Words Added, Words Removed)
         ───────────────────────────────────────────────────────────── */}
      {mode === 'compare' && (
        <div className="space-y-6">
          {/* Top 3 Stat Cards + Proofreading Discrepancy Bar */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* 1. Similarity */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm flex flex-col justify-center items-center text-center">
              <span className="font-display text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
                {similarity}%
              </span>
              <span className="mt-2 text-xs font-bold uppercase tracking-wider text-slate-400">
                Similarity
              </span>
            </div>

            {/* 2. Words Added */}
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/50 p-6 shadow-sm flex flex-col justify-center items-center text-center">
              <span className="font-display text-4xl sm:text-5xl font-extrabold text-emerald-600 tracking-tight">
                +{wordsAdded}
              </span>
              <span className="mt-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
                Words Added
              </span>
            </div>

            {/* 3. Words Removed */}
            <div className="rounded-2xl border border-rose-100 bg-rose-50/50 p-6 shadow-sm flex flex-col justify-center items-center text-center">
              <span className="font-display text-4xl sm:text-5xl font-extrabold text-rose-600 tracking-tight">
                -{wordsRemoved}
              </span>
              <span className="mt-2 text-xs font-bold uppercase tracking-wider text-rose-700">
                Words Removed
              </span>
            </div>
          </div>

          {/* Proofreading Discrepancy Quick Overview */}
          <div className="rounded-2xl border border-slate-200 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 p-5 text-white shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className={`flex h-9 w-9 items-center justify-center rounded-xl ${errorSummary.total === 0 ? 'bg-emerald-500' : 'bg-rose-500'} text-white shadow-lg`}>
                  {errorSummary.total === 0 ? <CheckCircle2 className="h-5 w-5" /> : <AlertCircle className="h-5 w-5" />}
                </div>
                <div>
                  <h4 className="text-sm font-bold tracking-tight">
                    {errorSummary.total === 0
                      ? '100% Perfect Match — 0 Discrepancies'
                      : `${errorSummary.total} Proofreading Discrepancies Detected`}
                  </h4>
                  <p className="text-xs text-slate-300">
                    {errorSummary.total === 0
                      ? 'All text, numbers, punctuation, spaces, and formatting match perfectly.'
                      : 'Audit inspected spaces, punctuation, numbers, capitalization, and symbols.'}
                  </p>
                </div>
              </div>

              {/* Categorized Pills */}
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
                <span className="rounded-lg bg-white/10 px-2.5 py-1 backdrop-blur-sm border border-white/10">
                  🔤 Case: <strong className="text-amber-300">{errorSummary.capitalization}</strong>
                </span>
                <span className="rounded-lg bg-white/10 px-2.5 py-1 backdrop-blur-sm border border-white/10">
                  ␣ Space: <strong className="text-sky-300">{errorSummary.spacing}</strong>
                </span>
                <span className="rounded-lg bg-white/10 px-2.5 py-1 backdrop-blur-sm border border-white/10">
                  ⸲ Punctuation: <strong className="text-pink-300">{errorSummary.punctuation}</strong>
                </span>
                <span className="rounded-lg bg-white/10 px-2.5 py-1 backdrop-blur-sm border border-white/10">
                  🔢 Numbers: <strong className="text-rose-300">{errorSummary.numbers}</strong>
                </span>
                <span className="rounded-lg bg-white/10 px-2.5 py-1 backdrop-blur-sm border border-white/10">
                  🔣 Symbols: <strong className="text-emerald-300">{errorSummary.symbols}</strong>
                </span>
                <span className="rounded-lg bg-white/10 px-2.5 py-1 backdrop-blur-sm border border-white/10">
                  🔠 Format: <strong className="text-purple-300">{errorSummary.formatting || 0}</strong>
                </span>
              </div>
            </div>
          </div>

          {/* VISUAL DIFF CARD */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900 flex items-center gap-2">
                  <GitCompare className="h-5 w-5 text-indigo-600" />
                  Visual Comparison Diff {hasBothImages && '(Image & Text Diff Active)'}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-1.5">
                  <span className="inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-emerald-800 font-semibold">
                    Green = Match
                  </span>
                  <span>•</span>
                  <span className="inline-block rounded bg-rose-200 px-1.5 py-0.5 text-rose-950 font-bold border border-rose-400">
                    Red = Discrepancy / Alteration in Composite
                  </span>
                  <span>•</span>
                  <span className="inline-block rounded bg-rose-100 px-1.5 py-0.5 text-rose-800 line-through border border-dashed border-rose-300 font-semibold">
                    Red Pill = Missing from Staging
                  </span>
                  <span>•</span>
                  <span className="inline-block rounded bg-purple-100 px-1.5 py-0.5 text-purple-800 border border-purple-300 font-semibold">
                    Purple = Bold / Italic Style Mismatch
                  </span>
                </p>
              </div>

              {/* View toggles */}
              <div className="flex flex-wrap items-center rounded-xl border border-slate-200 bg-slate-50 p-1 gap-1">
                {/* Dual-Slide Side-by-Side View Toggle */}
                <button
                  onClick={() => setDiffView('slides')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    diffView === 'slides'
                      ? 'bg-indigo-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Columns className="h-3.5 w-3.5" />
                  Dual Slides (Side-by-Side)
                </button>

                {/* Proofread View Toggle */}
                <button
                  onClick={() => setDiffView('proofread')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    diffView === 'proofread'
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Unified Stream (Green/Red)
                </button>

                {(hasBothImages || hasVisualDocuments) && (
                  <>
                    <button
                      onClick={() => setDiffView('slider')}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        diffView === 'slider'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      <Sliders className="h-3.5 w-3.5" />
                      Image Slider
                    </button>
                    <button
                      onClick={() => setDiffView('images')}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                        diffView === 'images'
                          ? 'bg-white text-indigo-700 shadow-sm'
                          : 'text-slate-500 hover:text-slate-900'
                      }`}
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      Images Side-by-Side
                    </button>
                  </>
                )}

                <button
                  onClick={() => setDiffView('inline')}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    diffView === 'inline'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Eye className="h-3.5 w-3.5" />
                  Standard Inline Diff
                </button>
              </div>
            </div>

            {/* VIEW 1: IMAGE SLIDER DIFF */}
            {diffView === 'slider' && (hasBothImages || hasVisualDocuments) && (
              hasBothImages ? (
                <div className="mt-5 space-y-3">
                  <div className="relative w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 select-none shadow-md">
                    <div className="relative aspect-[16/10] sm:aspect-[16/9] w-full max-h-[550px] flex items-center justify-center">
                      {/* Background Image: Image B (Revision) */}
                      <img
                        src={imageB}
                        alt={docBName || 'Document B'}
                        className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                      />

                      {/* Foreground Image: Image A (Baseline) clipped */}
                      <div
                        className="absolute inset-0 overflow-hidden"
                        style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                      >
                        <img
                          src={imageA}
                          alt={docAName || 'Document A'}
                          className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                        />
                      </div>

                      {/* Divider Handle */}
                      <div
                        className="absolute top-0 bottom-0 w-1 bg-white shadow-[0_0_10px_rgba(0,0,0,0.8)] z-20 flex items-center justify-center pointer-events-none"
                        style={{ left: `${sliderPos}%` }}
                      >
                        <div className="h-9 w-9 -ml-[16px] rounded-full bg-indigo-600 text-white shadow-2xl flex items-center justify-center border-2 border-white text-xs font-bold pointer-events-none">
                          ⇄
                        </div>
                      </div>

                      {/* Drag Input Overlay */}
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={sliderPos}
                        onChange={(e) => setSliderPos(Number(e.target.value))}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-ew-resize z-30"
                      />

                      {/* Labels */}
                      <div className="absolute top-3 left-3 z-10 rounded-md bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm border border-slate-700">
                        Original (A): {docAName || 'Image A'}
                      </div>
                      <div className="absolute top-3 right-3 z-10 rounded-md bg-indigo-600/90 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm border border-indigo-400">
                        Revision (B): {docBName || 'Image B'}
                      </div>
                    </div>
                    <div className="p-3 bg-slate-900 border-t border-slate-800 text-center text-xs text-slate-300">
                      Drag the slider left and right to visually inspect pixel and content differences between both documents.
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-900 p-10 text-center text-white space-y-2">
                  <Sliders className="h-8 w-8 mx-auto text-indigo-400 animate-pulse" />
                  <h4 className="text-sm font-bold">Preparing Visual PDF Slider</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Document slides are being rendered. Switch to the "Dual Slides" tab to see the authentic documents side-by-side!
                  </p>
                </div>
              )
            )}

            {/* VIEW 2: SIDE-BY-SIDE IMAGES */}
            {diffView === 'images' && (hasBothImages || hasVisualDocuments) && (
              hasBothImages ? (
                <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                      <span className="text-xs font-bold uppercase text-slate-700">
                        Document A: {docAName || 'Original'}
                      </span>
                    </div>
                    <div className="aspect-[4/3] w-full rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200">
                      <img
                        src={imageA}
                        alt={docAName || 'Document A'}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-2 mb-3">
                      <span className="text-xs font-bold uppercase text-indigo-700">
                        Document B: {docBName || 'Revision'}
                      </span>
                    </div>
                    <div className="aspect-[4/3] w-full rounded-lg bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200">
                      <img
                        src={imageB}
                        alt={docBName || 'Document B'}
                        className="h-full w-full object-contain"
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-900 p-10 text-center text-white space-y-2">
                  <ImageIcon className="h-8 w-8 mx-auto text-indigo-400 animate-pulse" />
                  <h4 className="text-sm font-bold">Rendering Visual Document Slides</h4>
                  <p className="text-xs text-slate-400 max-w-md mx-auto">
                    Switch to the "Dual Slides" tab to view the live PDF pages with photos and colors.
                  </p>
                </div>
              )
            )}

            {/* VIEW 0: PROOFREADING VERIFICATION (Green Matches / Red Errors) */}
            {diffView === 'proofread' && (
              <div className="mt-5 space-y-4">
                {similarity === 100 && proofreadingErrors.length === 0 ? (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 flex items-center gap-3">
                    <CheckCircle2 className="h-6 w-6 text-emerald-600 shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-emerald-900">100% Verified Match — Zero Errors Found</h4>
                      <p className="text-xs text-emerald-700 mt-0.5">
                        All words, capitalization, spacing, punctuation, numbers, and symbols match 100% between Document A and Document B.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-xl border border-indigo-200 bg-indigo-50/70 p-3.5 flex flex-wrap items-center justify-between gap-2 text-xs text-indigo-900">
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
                      <span>
                        <strong>Word-by-Word Inspection:</strong> <span className="inline-block bg-emerald-100 text-emerald-900 px-1.5 py-0.5 rounded font-bold border border-emerald-300">Green</span> = 100% Verified Match • <span className="inline-block bg-rose-100 text-rose-900 line-through px-1.5 py-0.5 rounded font-bold border border-rose-300">Red Strikethrough</span> = Omitted from A • <span className="inline-block bg-rose-200 text-rose-950 px-1.5 py-0.5 rounded font-bold border border-rose-400">Red Highlight</span> = Discrepancy in B.
                      </span>
                    </div>
                    <span className="font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded-md border border-rose-200">
                      {proofreadingErrors.length} errors found
                    </span>
                  </div>
                )}

                <div className="max-h-[550px] overflow-y-auto rounded-xl border border-slate-200 bg-white p-6 font-sans text-sm leading-loose select-text whitespace-pre-wrap shadow-inner">
                  {diffParts && diffParts.length > 0 ? (
                    diffParts.map((part, index) => {
                      if (part.type === 'unchanged') {
                        return (
                          <span
                            key={index}
                            className="bg-emerald-50 text-emerald-950 border border-emerald-200/80 rounded px-1.5 py-0.5 mx-0.5 font-medium inline transition hover:bg-emerald-100/90"
                            title="✓ Verified 100% Match"
                          >
                            {part.value}
                          </span>
                        );
                      }
                      if (part.type === 'removed') {
                        return (
                          <del
                            key={index}
                            className="bg-rose-100 text-rose-900 line-through rounded px-1.5 py-0.5 mx-0.5 border border-rose-400 font-bold inline shadow-sm"
                            title="Omitted from Baseline (Document A)"
                          >
                            {part.value}
                          </del>
                        );
                      }
                      if (part.type === 'added') {
                        return (
                          <ins
                            key={index}
                            className="bg-rose-200 text-rose-950 font-bold rounded px-1.5 py-0.5 mx-0.5 no-underline border-2 border-rose-500 inline shadow-sm"
                            title="Discrepancy / Alteration in Revision (Document B)"
                          >
                            {part.value}
                          </ins>
                        );
                      }
                      return null;
                    })
                  ) : (
                    <div className="text-slate-400 italic py-6 text-center">
                      No text to compare.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* VIEW 3: INLINE TEXT DIFF */}
            {diffView === 'inline' && (
              <div className="mt-5 max-h-[550px] overflow-y-auto rounded-xl border border-slate-200 bg-slate-50/70 p-5 font-mono text-xs sm:text-sm leading-loose whitespace-pre-wrap select-text">
                {diffParts && diffParts.length > 0 ? (
                  diffParts.map((part, index) => {
                    if (part.type === 'added') {
                      return (
                        <ins
                          key={index}
                          className="bg-emerald-100/90 text-emerald-900 font-medium rounded px-1.5 py-0.5 mx-0.5 no-underline border border-emerald-300 inline"
                        >
                          {part.value}
                        </ins>
                      );
                    }
                    if (part.type === 'removed') {
                      return (
                        <del
                          key={index}
                          className="bg-rose-100/90 text-rose-900 line-through rounded px-1.5 py-0.5 mx-0.5 border border-rose-300 inline"
                        >
                          {part.value}
                        </del>
                      );
                    }
                    return (
                      <span key={index} className="text-slate-800">
                        {part.value}
                      </span>
                    );
                  })
                ) : (
                  <div className="text-slate-400 italic py-6 text-center">
                    Both documents are identical or no textual differences were detected.
                  </div>
                )}
              </div>
            )}

            {/* VIEW 4: DUAL-SLIDE SIDE-BY-SIDE VIEW (Left & Right Slides with Sync Scroll & Comments) */}
            {diffView === 'slides' && (
              <div className="mt-5 space-y-4">
                {/* Slide Controls Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
                  <div className="flex flex-wrap items-center gap-2 sm:gap-3">
                    {/* View Mode Switcher: 🖼 Visual PDF (Default) vs 📝 Text Redline */}
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
                      <button
                        onClick={() => setSlideDisplayMode('visual')}
                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition flex items-center gap-1.5 ${
                          slideDisplayMode === 'visual'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Display authentic visual document with original colors, banners, photos, and typography"
                      >
                        <FileText className="h-3.5 w-3.5" />
                        🖼 Visual PDF & Photos
                      </button>
                      <button
                        onClick={() => setSlideDisplayMode('redline')}
                        className={`rounded-md px-2.5 py-1 text-xs font-bold transition flex items-center gap-1.5 ${
                          slideDisplayMode === 'redline'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title="Display word-by-word extracted text redline"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        📝 Text Redline
                      </button>
                    </div>

                    {/* Sync Scroll Toggle */}
                    <button
                      onClick={() => setSyncScroll(!syncScroll)}
                      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition border ${
                        syncScroll
                          ? 'bg-indigo-50 border-indigo-200 text-indigo-700 shadow-xs'
                          : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                      }`}
                      title="Synchronize scrolling between Left and Right slides"
                    >
                      {syncScroll ? <Lock className="h-3.5 w-3.5 text-indigo-600" /> : <Unlock className="h-3.5 w-3.5 text-slate-500" />}
                      Sync: {syncScroll ? 'ON' : 'OFF'}
                    </button>

                    {/* Zoom Controls (When in Visual Mode) */}
                    {slideDisplayMode === 'visual' && (
                      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs font-bold text-slate-700">
                        <button
                          onClick={() => setPdfZoom((z) => Math.max(0.6, Math.round((z - 0.15) * 100) / 100))}
                          className="p-1 hover:text-indigo-600 rounded hover:bg-slate-200"
                          title="Zoom Out"
                        >
                          <ZoomOut className="h-3.5 w-3.5" />
                        </button>
                        <span className="px-1.5 text-[11px] font-mono min-w-[38px] text-center">
                          {Math.round(pdfZoom * 100)}%
                        </span>
                        <button
                          onClick={() => setPdfZoom((z) => Math.min(2.5, Math.round((z + 0.15) * 100) / 100))}
                          className="p-1 hover:text-indigo-600 rounded hover:bg-slate-200"
                          title="Zoom In"
                        >
                          <ZoomIn className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setPdfZoom(1.0)}
                          className="px-1.5 py-0.5 text-[10px] text-slate-500 hover:text-slate-900 border-l border-slate-300 ml-0.5"
                          title="Reset to 100%"
                        >
                          100%
                        </button>
                      </div>
                    )}

                    {/* Slide Split Width Ratio Controls */}
                    <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 text-xs font-bold text-slate-700">
                      <span className="text-[10px] text-slate-400 uppercase font-black px-1">
                        Split:
                      </span>
                      <button
                        onClick={() => setSplitRatio(50)}
                        className={`px-2 py-0.5 rounded text-xs transition ${
                          splitRatio === 50
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'hover:bg-slate-200 text-slate-700'
                        }`}
                        title="Equal 50/50 split"
                      >
                        50:50
                      </button>
                      <button
                        onClick={() => setSplitRatio(30)}
                        className={`px-2 py-0.5 rounded text-xs transition ${
                          splitRatio === 30
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'hover:bg-slate-200 text-slate-700'
                        }`}
                        title="Expand Composite Target (Slide B: 70%, Slide A: 30%)"
                      >
                        30:70 Focus Target
                      </button>
                      <button
                        onClick={() => setSplitRatio(70)}
                        className={`px-2 py-0.5 rounded text-xs transition ${
                          splitRatio === 70
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'hover:bg-slate-200 text-slate-700'
                        }`}
                        title="Expand Staging Reference (Slide A: 70%, Slide B: 30%)"
                      >
                        70:30 Focus Staging
                      </button>
                    </div>

                    {/* Highlight Target Selector (When in Redline Mode) */}
                    {slideDisplayMode === 'redline' && (
                      <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1">
                        <span className="text-[11px] font-bold text-slate-500 px-1.5 uppercase tracking-wide">
                          Highlight:
                        </span>
                        <button
                          onClick={() => setHighlightTarget('composite')}
                          className={`rounded-md px-2 py-0.5 text-xs font-bold transition flex items-center gap-1 ${
                            highlightTarget === 'composite'
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                          title="Highlight all errors ONLY on Slide B (Composite), keeping Slide A (Staging) clean and error-free"
                        >
                          🎯 Composite Only
                        </button>
                        <button
                          onClick={() => setHighlightTarget('both')}
                          className={`rounded-md px-2 py-0.5 text-xs font-bold transition flex items-center gap-1 ${
                            highlightTarget === 'both'
                              ? 'bg-indigo-600 text-white shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                          title="Highlight differences on both Slide A and Slide B"
                        >
                          👥 Both
                        </button>
                      </div>
                    )}

                    {/* Legend (When in Redline Mode) */}
                    {slideDisplayMode === 'redline' && (
                      <div className="hidden sm:flex items-center gap-3 text-xs text-slate-600">
                        <span className="inline-flex items-center gap-1.5 font-medium text-emerald-800">
                          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span> Match
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-medium text-rose-800">
                          <span className="h-2.5 w-2.5 rounded-full bg-rose-500"></span> Red = Error
                        </span>
                        <span className="inline-flex items-center gap-1.5 font-medium text-purple-800">
                          <span className="h-2.5 w-2.5 rounded-full bg-purple-500"></span> Purple = Style
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Quick Add Comment button */}
                    <button
                      onClick={() => {
                        setActiveCommentTarget({ target: 'both', snippet: '', errorId: null });
                        setNewCommentModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 text-xs font-bold transition shadow-xs"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Slide Note / Comment
                    </button>

                    {/* Toggle Slide Notes Panel */}
                    <button
                      onClick={() => setShowCommentsPanel(!showCommentsPanel)}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold transition border ${
                        showCommentsPanel
                          ? 'bg-slate-900 border-slate-900 text-white'
                          : 'bg-slate-100 border-slate-200 text-slate-700 hover:bg-slate-200'
                      }`}
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      Notes ({comments.length})
                    </button>
                  </div>
                </div>

                {/* DUAL SLIDE VIEW: VISUAL PDF (Default) vs REDLINE with Draggable Split Adjuster */}
                {slideDisplayMode === 'visual' ? (
                  <div
                    ref={splitContainerRef}
                    className="relative flex flex-col lg:flex-row w-full gap-3 lg:gap-0 select-none overflow-hidden rounded-2xl"
                  >
                    {/* SLIDE A: Staging Master (Error-Free Reference Standard) */}
                    <div
                      className="w-full min-w-0"
                      style={{
                        flex: isDesktop ? `0 0 ${splitRatio}%` : '1 1 100%',
                        width: isDesktop ? `${splitRatio}%` : '100%',
                        maxWidth: isDesktop ? `${splitRatio}%` : '100%',
                      }}
                    >
                      <PdfVisualViewer
                        file={fileA}
                        pdfUrl={pdfUrlA || pdfA}
                        imageSrc={initialImageA}
                        title={docAName || 'Document A (Staging Reference Standard)'}
                        badge="Slide A"
                        subtitle="✓ Staging Master (Error-Free Reference)"
                        isAuditTarget={false}
                        scale={pdfZoom}
                        pageNumber={pdfPage}
                        onPageChange={setPdfPage}
                        onTotalPagesChange={setPdfTotalPages}
                        scrollRef={leftSlideRef}
                        onScroll={handleLeftScroll}
                        discrepancies={EMPTY_DISCREPANCIES}
                        canvasRefCallback={(node) => {
                          stagingCanvasRef.current = node;
                        }}
                        onRenderSuccess={({ dataUrl }) => {
                          if (!renderedImageA) setRenderedImageA(dataUrl);
                        }}
                      />
                    </div>

                    {/* DRAGGABLE DIVIDER HANDLE (Adjust Left vs Right Slide Width) */}
                    <div
                      onMouseDown={handleMouseDownSplit}
                      className={`hidden lg:flex items-center justify-center w-5 cursor-col-resize hover:bg-indigo-500/20 active:bg-indigo-600/30 transition group z-30 select-none -mx-2.5 ${
                        isDraggingSplit ? 'bg-indigo-500/30' : ''
                      }`}
                      title="Click and drag left or right to adjust slide widths"
                    >
                      <div className="flex flex-col items-center justify-center gap-1 py-4 px-1.5 rounded-full bg-white shadow-md border-2 border-slate-300 group-hover:border-indigo-500 group-hover:bg-indigo-600 group-hover:text-white transition">
                        <div className="w-1 h-2 rounded-full bg-slate-400 group-hover:bg-white" />
                        <span className="text-[9px] font-black leading-none">⇄</span>
                        <div className="w-1 h-2 rounded-full bg-slate-400 group-hover:bg-white" />
                      </div>
                    </div>

                    {/* SLIDE B: Composite Audit Target (With Discrepancies) */}
                    <div
                      className="w-full min-w-0"
                      style={{
                        flex: isDesktop ? `0 0 ${100 - splitRatio}%` : '1 1 100%',
                        width: isDesktop ? `${100 - splitRatio}%` : '100%',
                        maxWidth: isDesktop ? `${100 - splitRatio}%` : '100%',
                      }}
                    >
                      <PdfVisualViewer
                        file={fileB}
                        pdfUrl={pdfUrlB || pdfB}
                        imageSrc={initialImageB}
                        title={docBName || 'Document B (Composite Audit Target)'}
                        badge="Slide B"
                        subtitle="⚠ Composite Audit Target"
                        isAuditTarget={true}
                        scale={pdfZoom}
                        pageNumber={pdfPage}
                        onPageChange={setPdfPage}
                        onTotalPagesChange={setPdfTotalPages}
                        scrollRef={rightSlideRef}
                        onScroll={handleRightScroll}
                        discrepancies={proofreadingErrors}
                        baselineCanvasRef={stagingCanvasRef}
                        onOpenComment={(err) => {
                          setActiveCommentTarget({
                            target: 'slideB',
                            snippet: err.found || err.details,
                            errorId: err.id,
                          });
                          setNewCommentModalOpen(true);
                        }}
                        onRenderSuccess={({ dataUrl }) => {
                          if (!renderedImageB) setRenderedImageB(dataUrl);
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  /* Dual Slide Redline Text Streams with Resizable Split Slider */
                  <div
                    ref={splitContainerRef}
                    className="relative flex flex-col lg:flex-row w-full gap-3 lg:gap-0 select-none overflow-hidden rounded-2xl"
                  >
                    {/* LEFT SLIDE: DOCUMENT A (Baseline / Reference) */}
                    <div
                      className="w-full min-w-0"
                      style={{
                        flex: isDesktop ? `0 0 ${splitRatio}%` : '1 1 100%',
                        width: isDesktop ? `${splitRatio}%` : '100%',
                        maxWidth: isDesktop ? `${splitRatio}%` : '100%',
                      }}
                    >
                      <div className="flex flex-col h-full rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden">
                        {/* Slide Header */}
                        <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white px-4 py-3 flex items-center justify-between border-b border-slate-700">
                          <div className="flex items-center gap-2.5 overflow-hidden">
                            <span className="rounded-md bg-indigo-500/30 text-indigo-200 border border-indigo-400/40 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                              Slide A
                            </span>
                            <span className="font-semibold text-sm truncate" title={docAName || 'Document A'}>
                              {docAName || 'Document A (Staging Reference Standard)'}
                            </span>
                          </div>
                          <span className="text-[11px] text-emerald-300 font-mono shrink-0 bg-emerald-950/70 px-2.5 py-0.5 rounded border border-emerald-500/40 font-bold">
                            ✓ Staging (Error-Free Reference)
                          </span>
                        </div>

                      {/* Slide Sub-toolbar */}
                      {highlightTarget === 'composite' ? (
                        <div className="px-4 py-2 bg-emerald-50/80 border-b border-emerald-100 flex items-center justify-between text-[11px] text-emerald-900 font-medium">
                          <span>✓ <strong>Staging Reference View</strong>: Clean, pristine approved text (No red markup clutter)</span>
                          <span className="font-semibold text-emerald-700">Error-Free Master</span>
                        </div>
                      ) : (
                        <div className="px-4 py-2 bg-slate-100/70 border-b border-slate-200 flex items-center justify-between text-[11px] text-slate-500">
                          <span>Click any <strong className="text-rose-700">red removed text</strong> to comment</span>
                          <span>Dual Slide Markup Active</span>
                        </div>
                      )}

                      {/* Slide Scrollable Text Content */}
                      <div
                        ref={leftSlideRef}
                        onScroll={handleLeftScroll}
                        className="h-[520px] overflow-y-auto p-5 font-sans text-sm leading-loose text-slate-800 whitespace-pre-wrap select-text bg-white"
                      >
                        {leftParts && leftParts.length > 0 ? (
                          leftParts.map((part, index) => {
                            const boldClass = part.isBold ? 'font-bold' : '';
                            const italicClass = part.isItalic ? 'italic' : '';

                            // In 'composite' only mode: Slide A is 100% clean and pristine!
                            if (highlightTarget === 'composite') {
                              return (
                                <span key={index} className={`${boldClass} ${italicClass} text-slate-900`}>
                                  {part.value}
                                </span>
                              );
                            }

                            // In 'both' slides mode: show removed items as strikethrough
                            if (part.type === 'match') {
                              return (
                                <span
                                  key={index}
                                  className={`bg-emerald-50 text-emerald-950 border border-emerald-200/80 rounded px-1 py-0.5 mx-0.5 font-medium inline transition hover:bg-emerald-100 ${boldClass} ${italicClass}`}
                                  title="✓ Verified Match with Document B"
                                >
                                  {part.value}
                                </span>
                              );
                            }
                            if (part.type === 'removed') {
                              return (
                                <del
                                  key={index}
                                  className={`bg-rose-100 text-rose-900 line-through rounded px-1.5 py-0.5 mx-0.5 border border-rose-400 font-bold inline shadow-xs cursor-pointer hover:bg-rose-200 transition ${boldClass} ${italicClass}`}
                                  title="Omitted / Changed in Revision — Click to add reviewer note"
                                  onClick={() => {
                                    setActiveCommentTarget({
                                      target: 'slideA',
                                      snippet: part.value,
                                      errorId: null,
                                    });
                                    setNewCommentModalOpen(true);
                                  }}
                                >
                                  {part.value}
                                </del>
                              );
                            }
                            return <span key={index} className={`${boldClass} ${italicClass}`}>{part.value}</span>;
                          })
                        ) : (
                          <div className="text-slate-400 italic py-12 text-center">
                            No content extracted for Document A.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                    {/* DRAGGABLE DIVIDER HANDLE (Adjust Left vs Right Slide Width) */}
                    <div
                      onMouseDown={handleMouseDownSplit}
                      className={`hidden lg:flex items-center justify-center w-5 cursor-col-resize hover:bg-indigo-500/20 active:bg-indigo-600/30 transition group z-30 select-none -mx-2.5 ${
                        isDraggingSplit ? 'bg-indigo-500/30' : ''
                      }`}
                      title="Click and drag left or right to adjust slide widths"
                    >
                      <div className="flex flex-col items-center justify-center gap-1 py-4 px-1.5 rounded-full bg-white shadow-md border-2 border-slate-300 group-hover:border-indigo-500 group-hover:bg-indigo-600 group-hover:text-white transition">
                        <div className="w-1 h-2 rounded-full bg-slate-400 group-hover:bg-white" />
                        <span className="text-[9px] font-black leading-none">⇄</span>
                        <div className="w-1 h-2 rounded-full bg-slate-400 group-hover:bg-white" />
                      </div>
                    </div>

                    {/* RIGHT SLIDE: DOCUMENT B (Revision / Composite Target) */}
                    <div
                      className="w-full min-w-0"
                      style={{
                        flex: isDesktop ? `0 0 ${100 - splitRatio}%` : '1 1 100%',
                        width: isDesktop ? `${100 - splitRatio}%` : '100%',
                        maxWidth: isDesktop ? `${100 - splitRatio}%` : '100%',
                      }}
                    >
                      <div className="flex flex-col h-full rounded-2xl border-2 border-indigo-200 bg-white shadow-sm overflow-hidden">
                        {/* Slide Header */}
                        <div className="bg-gradient-to-r from-indigo-900 to-indigo-800 text-white px-4 py-3 flex items-center justify-between border-b border-indigo-700">
                        <div className="flex items-center gap-2.5 overflow-hidden">
                          <span className="rounded-md bg-purple-500/30 text-purple-200 border border-purple-400/40 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                            Slide B
                          </span>
                          <span className="font-semibold text-sm truncate" title={docBName || 'Document B'}>
                            {docBName || 'Document B (Composite Audit Target)'}
                          </span>
                        </div>
                        <span className="text-[11px] text-rose-200 font-mono shrink-0 bg-rose-950/70 px-2.5 py-0.5 rounded border border-rose-500/40 font-bold">
                          ⚠ Composite (Audit Target)
                        </span>
                      </div>

                      {/* Slide Sub-toolbar */}
                      <div className="px-4 py-2 bg-rose-50/70 border-b border-rose-100 flex items-center justify-between text-[11px] text-rose-800 font-medium">
                        <span>⚠ <strong>Composite Audit</strong>: Red Alterations, Missing Staging Pills, and Style Discrepancies</span>
                        <span className="font-semibold text-rose-700">Audit Active</span>
                      </div>

                      {/* Slide Scrollable Text Content */}
                      <div
                        ref={rightSlideRef}
                        onScroll={handleRightScroll}
                        className="h-[520px] overflow-y-auto p-5 font-sans text-sm leading-loose text-slate-800 whitespace-pre-wrap select-text bg-white"
                      >
                        {rightParts && rightParts.length > 0 ? (
                          rightParts.map((part, index) => {
                            const boldClass = part.isBold ? 'font-bold' : '';
                            const italicClass = part.isItalic ? 'italic' : '';

                            // 1. Matched text
                            if (part.type === 'match') {
                              return (
                                <span
                                  key={index}
                                  className={`${boldClass} ${italicClass} ${
                                    highlightTarget === 'composite'
                                      ? 'text-slate-800'
                                      : 'bg-emerald-50 text-emerald-950 border border-emerald-200/80 rounded px-1 py-0.5 mx-0.5 font-medium inline transition hover:bg-emerald-100'
                                  }`}
                                  title="✓ Verified Match with Staging"
                                >
                                  {part.value}
                                </span>
                              );
                            }

                            // 2. Added / Altered text in Composite
                            if (part.type === 'added') {
                              return (
                                <ins
                                  key={index}
                                  className={`bg-rose-200 text-rose-950 font-bold rounded px-1.5 py-0.5 mx-0.5 no-underline border-2 border-rose-500 inline shadow-xs cursor-pointer hover:bg-rose-300 transition ${boldClass} ${italicClass}`}
                                  title="Discrepancy / Alteration in Composite — Click to add reviewer note"
                                  onClick={() => {
                                    setActiveCommentTarget({
                                      target: 'slideB',
                                      snippet: part.value,
                                      errorId: null,
                                    });
                                    setNewCommentModalOpen(true);
                                  }}
                                >
                                  {part.value}
                                </ins>
                              );
                            }

                            // 3. Omitted text (Missing from Staging)
                            if (part.type === 'omitted') {
                              return (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 bg-rose-100 text-rose-950 border-2 border-dashed border-rose-400 rounded-md px-1.5 py-0.5 mx-1 text-xs cursor-pointer shadow-xs hover:bg-rose-200 transition select-none"
                                  title="Missing in Composite (Present in Staging Reference) — Click to add reviewer note"
                                  onClick={() => {
                                    setActiveCommentTarget({
                                      target: 'slideB',
                                      snippet: `Missing from Staging: ${part.value}`,
                                      errorId: null,
                                    });
                                    setNewCommentModalOpen(true);
                                  }}
                                >
                                  <span className="line-through text-rose-900 font-bold">
                                    {part.value}
                                  </span>
                                  <span className="text-[9px] bg-rose-600 text-white px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                                    Missing
                                  </span>
                                </span>
                              );
                            }

                            // 4. Formatting discrepancy (Bold/Italic difference)
                            if (part.type === 'format_mismatch') {
                              return (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 bg-purple-100 text-purple-950 border-2 border-purple-400 rounded-md px-1.5 py-0.5 mx-1 text-xs cursor-pointer shadow-xs hover:bg-purple-200 transition select-none"
                                  title="Formatting Discrepancy — Click to add reviewer note"
                                  onClick={() => {
                                    setActiveCommentTarget({
                                      target: 'slideB',
                                      snippet: `Style mismatch: ${part.value}`,
                                      errorId: null,
                                    });
                                    setNewCommentModalOpen(true);
                                  }}
                                >
                                  <span className={`${boldClass} ${italicClass}`}>{part.value}</span>
                                  <span className="text-[9px] bg-purple-600 text-white px-1.5 py-0.2 rounded font-bold uppercase tracking-wider">
                                    {part.expectedBold ? 'Expected Bold' : part.expectedItalic ? 'Expected Italic' : 'Style Mismatch'}
                                  </span>
                                </span>
                              );
                            }

                            return <span key={index} className={`${boldClass} ${italicClass}`}>{part.value}</span>;
                          })
                        ) : (
                          <div className="text-slate-400 italic py-12 text-center">
                            No content extracted for Document B.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

                {/* REVIEWER SLIDE NOTES & COMMENTS PANEL */}
                {showCommentsPanel && (
                  <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-indigo-600" />
                        <h4 className="font-bold text-slate-900 text-sm">
                          Reviewer Slide Notes & Marked Comments ({comments.length})
                        </h4>
                        <span className="text-xs text-slate-500 hidden sm:inline">
                          — Annotate, track changes, and export review notes.
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => {
                            setActiveCommentTarget({ target: 'both', snippet: '', errorId: null });
                            setNewCommentModalOpen(true);
                          }}
                          className="flex items-center gap-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 text-xs font-bold transition"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add Note
                        </button>
                        {comments.length > 0 && (
                          <button
                            onClick={handleCopyAllComments}
                            className="flex items-center gap-1 text-xs font-bold text-slate-700 hover:text-slate-900 transition bg-slate-100 border border-slate-200 px-3 py-1.5 rounded-lg"
                          >
                            {commentCopied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                            {commentCopied ? 'Copied to Clipboard' : 'Export Notes'}
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Comment cards list */}
                    {comments.length === 0 ? (
                      <div className="py-6 text-center text-xs text-slate-400 italic bg-slate-50/70 rounded-xl border border-dashed border-slate-200">
                        No comments marked on the slides yet. Click any red discrepancy on either slide or the "Add Note" button above.
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {comments.map((comm) => (
                          <div
                            key={comm.id}
                            className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 flex flex-col justify-between text-xs space-y-2 relative group hover:border-indigo-300 hover:bg-white transition shadow-2xs"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wider ${
                                    comm.tag === 'Issue'
                                      ? 'bg-rose-100 text-rose-800 border border-rose-300'
                                      : comm.tag === 'Question'
                                      ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                      : comm.tag === 'Approved'
                                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                      : 'bg-blue-100 text-blue-800 border border-blue-300'
                                  }`}
                                >
                                  {comm.tag}
                                </span>
                                <span className="text-[10px] font-semibold text-slate-500">
                                  {comm.target === 'slideA'
                                    ? 'Slide A'
                                    : comm.target === 'slideB'
                                    ? 'Slide B'
                                    : 'Both Slides'}
                                </span>
                              </div>
                              <button
                                onClick={() => handleDeleteComment(comm.id)}
                                className="text-slate-400 hover:text-rose-600 transition p-1"
                                title="Delete comment"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            {comm.snippet && (
                              <div className="bg-slate-200/60 text-slate-800 px-2 py-1 rounded font-mono text-[11px] truncate border border-slate-300/50">
                                Ref: "{comm.snippet}"
                              </div>
                            )}

                            <p className="text-slate-900 font-medium text-xs leading-relaxed">{comm.text}</p>

                            <div className="text-[10px] text-slate-400 text-right font-mono">{comm.createdAt}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          ANALYZE MODE: Show Image Preview Card if uploaded
         ───────────────────────────────────────────────────────────── */}
      {mode === 'analyze' && imagePreview && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2 mb-3">
            <ImageIcon className="h-4 w-4 text-indigo-600" />
            Uploaded Image Preview
          </h3>
          <div className="max-h-[400px] w-full rounded-xl bg-slate-100 flex items-center justify-center overflow-hidden border border-slate-200">
            <img
              src={imagePreview}
              alt="Analyzed Document"
              className="max-h-[400px] w-auto object-contain"
            />
          </div>
        </div>
      )}

      {/* Score gauge card */}
      <ScoreCard
        score={overallScore}
        criticalCount={criticalCount}
        highCount={highCount}
        mediumCount={mediumCount}
        lowCount={lowCount}
        verdict={verdict}
      />

      {/* Executive Summary */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <h3 className="font-display text-base font-bold text-slate-900 flex items-center gap-2">
            <FileText className="h-4 w-4 text-indigo-600" />
            Executive Forensic Summary
          </h3>
          <button
            onClick={handleCopySummary}
            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-indigo-600 transition"
          >
            {copiedSummary ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copiedSummary ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-700 whitespace-pre-line">{summary}</p>
      </div>

      {/* Navigation tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 pb-2">
        {mode === 'compare' && (
          <>
            <button
              onClick={() => setActiveTab('proofreading')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                activeTab === 'proofreading'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <CheckCircle2 className="h-4 w-4" />
              Proofreading Errors ({errorSummary.total})
            </button>
            <button
              onClick={() => setActiveTab('changes')}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
                activeTab === 'changes'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              <Layers className="h-4 w-4" />
              Detected Changes ({changes.length})
            </button>
          </>
        )}

        <button
          onClick={() => setActiveTab('findings')}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
            activeTab === 'findings'
              ? 'bg-indigo-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          <ShieldAlert className="h-4 w-4" />
          Findings & Risks ({findings.length})
        </button>

        {complianceGaps.length > 0 && (
          <button
            onClick={() => setActiveTab('compliance')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === 'compliance'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <Scale className="h-4 w-4" />
            Compliance Checklist ({complianceGaps.length})
          </button>
        )}

        {obligations.length > 0 && (
          <button
            onClick={() => setActiveTab('obligations')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === 'obligations'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <ListOrdered className="h-4 w-4" />
            Obligations ({obligations.length})
          </button>
        )}

        {extractedFields && (
          <button
            onClick={() => setActiveTab('facts')}
            className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition ${
              activeTab === 'facts'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            <FileText className="h-4 w-4" />
            Deterministic Facts
          </button>
        )}
      </div>

      {/* TAB: Proofreading Errors */}
      {activeTab === 'proofreading' && mode === 'compare' && (
        <div className="space-y-4">
          {/* Category Filter Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Filter category:</span>
            {[
              { id: 'all', label: `All Discrepancies (${errorSummary.total})` },
              { id: 'Capitalization', label: `🔤 Case (${errorSummary.capitalization})` },
              { id: 'Spacing', label: `␣ Spacing (${errorSummary.spacing})` },
              { id: 'Punctuation', label: `⸲ Punctuation (${errorSummary.punctuation})` },
              { id: 'Numbers & Units', label: `🔢 Numbers (${errorSummary.numbers})` },
              { id: 'Symbols & Trademarks', label: `🔣 Symbols (${errorSummary.symbols})` },
              { id: 'Formatting (Bold / Italic)', label: `🔠 Formatting (${errorSummary.formatting || 0})` },
              { id: 'Word Mismatch', label: `📝 Content (${errorSummary.words})` },
            ].map((cat) => (
              <button
                key={cat.id}
                onClick={() => setProofCategoryFilter(cat.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  proofCategoryFilter === cat.id
                    ? 'bg-emerald-700 text-white shadow-sm'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* List of discrepancies */}
          {proofreadingErrors.filter((e) => proofCategoryFilter === 'all' || e.category === proofCategoryFilter).length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
              <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
              <p className="font-bold text-slate-800">No discrepancies found under this filter.</p>
              <p className="text-xs text-slate-500 mt-1">All inspected items match the reference baseline.</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {proofreadingErrors
                .filter((e) => proofCategoryFilter === 'all' || e.category === proofCategoryFilter)
                .map((err, idx) => (
                  <div
                    key={err.id || idx}
                    className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm hover:border-slate-300 transition"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-md px-2.5 py-0.5 text-xs font-bold ${
                            err.category === 'Capitalization'
                              ? 'bg-amber-100 text-amber-800'
                              : err.category === 'Spacing'
                              ? 'bg-sky-100 text-sky-800'
                              : err.category === 'Punctuation'
                              ? 'bg-pink-100 text-pink-800'
                              : err.category === 'Numbers & Units'
                              ? 'bg-rose-100 text-rose-800'
                              : err.category === 'Symbols & Trademarks'
                              ? 'bg-emerald-100 text-emerald-800'
                              : err.category === 'Formatting (Bold / Italic)'
                              ? 'bg-purple-100 text-purple-800 border border-purple-300'
                              : 'bg-indigo-100 text-indigo-800'
                          }`}
                        >
                          {err.category}
                        </span>
                        <h4 className="text-sm font-bold text-slate-900">{err.details}</h4>
                      </div>

                      <div className="flex items-center gap-2">
                        {getSeverityBadge(err.severity)}
                        <button
                          onClick={() => {
                            setActiveCommentTarget({
                              target: 'slideB',
                              snippet: `${err.expected} ➔ ${err.found}`,
                              errorId: err.id,
                            });
                            setNewCommentModalOpen(true);
                          }}
                          className="flex items-center gap-1 rounded-md bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-600 px-2 py-0.5 text-xs font-semibold transition border border-slate-200"
                          title="Add comment for this discrepancy"
                        >
                          <MessageSquare className="h-3 w-3 text-indigo-600" />
                          Add Note
                        </button>
                      </div>
                    </div>

                    {/* Comparison boxes */}
                    <div className="mt-3.5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {/* Document A Expected */}
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                          <span>Document A (Baseline Expected):</span>
                        </div>
                        <p className="mt-1 font-mono text-xs font-semibold text-emerald-950 bg-white/80 p-2 rounded border border-emerald-200">
                          {err.expected}
                        </p>
                      </div>

                      {/* Document B Found */}
                      <div className="rounded-xl border border-rose-200 bg-rose-50/50 p-3">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800">
                          <AlertCircle className="h-3.5 w-3.5 text-rose-600" />
                          <span>Document B (Revision Found):</span>
                        </div>
                        <p className="mt-1 font-mono text-xs font-semibold text-rose-950 bg-white/80 p-2 rounded border border-rose-200">
                          {err.found}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: Changes (for Compare) */}
      {activeTab === 'changes' && mode === 'compare' && (
        <div className="space-y-4">
          <div className="grid gap-3">
            {changes.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
                No high-level substantive changes were flagged beyond text formatting.
              </div>
            ) : (
              changes.map((c, i) => (
                <div
                  key={c.id || i}
                  className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                          c.type === 'addition'
                            ? 'bg-emerald-100 text-emerald-800'
                            : c.type === 'deletion'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-indigo-100 text-indigo-800'
                        }`}
                      >
                        {c.type?.toUpperCase()}
                      </span>
                      <h4 className="text-sm font-bold text-slate-900">{c.title}</h4>
                    </div>
                    {getSeverityBadge(c.severity)}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-slate-700">{c.details}</p>
                  {c.impact && (
                    <p className="mt-2 text-[11px] font-semibold text-slate-500">
                      Commercial Impact: <span className="text-slate-800">{c.impact}</span>
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB: Findings */}
      {activeTab === 'findings' && (
        <div className="space-y-4">
          {/* Severity filter chips */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Filter severity:</span>
            {['all', 'critical', 'high', 'medium', 'low'].map((sev) => (
              <button
                key={sev}
                onClick={() => setSeverityFilter(sev)}
                className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition ${
                  severityFilter === sev
                    ? 'bg-slate-900 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {sev}
              </button>
            ))}
          </div>

          {filteredFindings.length === 0 ? (
            <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-slate-500">
              No findings matched the selected severity filter.
            </div>
          ) : (
            <div className="grid gap-4">
              {filteredFindings.map((f, i) => (
                <div
                  key={f.id || i}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      {getSeverityBadge(f.severity)}
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {f.category || 'Clause Risk'}
                      </span>
                      <h4 className="font-display text-base font-bold text-slate-900">{f.title}</h4>
                    </div>
                  </div>

                  <p className="mt-2.5 text-sm leading-relaxed text-slate-700">{f.description}</p>

                  {f.clause && (
                    <div className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                        Relevant Clause / Excerpt
                      </span>
                      <p className="mt-1 font-mono text-xs text-slate-700 leading-relaxed italic">
                        "{f.clause}"
                      </p>
                    </div>
                  )}

                  {f.recommendation && (
                    <div className="mt-3 flex items-start gap-2 text-xs text-indigo-900 bg-indigo-50/70 p-3 rounded-xl border border-indigo-100">
                      <ChevronRight className="h-4 w-4 text-indigo-600 shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold">Advisory Recommendation: </span>
                        <span>{f.recommendation}</span>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* TAB: Compliance Checklist */}
      {activeTab === 'compliance' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase">
                <th className="pb-3">Standard / Requirement</th>
                <th className="pb-3">Audit Status</th>
                <th className="pb-3">Compliance Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {complianceGaps.map((g, i) => (
                <tr key={i} className="hover:bg-slate-50/50">
                  <td className="py-3 font-semibold text-slate-900">{g.requirement}</td>
                  <td className="py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 font-bold uppercase text-[10px] ${
                        g.status === 'pass'
                          ? 'bg-emerald-100 text-emerald-800'
                          : g.status === 'flag'
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-rose-100 text-rose-800'
                      }`}
                    >
                      {g.status}
                    </span>
                  </td>
                  <td className="py-3 text-slate-600">{g.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB: Obligations */}
      {activeTab === 'obligations' && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 font-semibold uppercase">
                <th className="pb-3">Obligated Party</th>
                <th className="pb-3">Duty / Covenant</th>
                <th className="pb-3">Deadline / Trigger</th>
                <th className="pb-3">Risk Tier</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {obligations.map((o, i) => (
                <tr key={i} className="hover:bg-slate-50/50">
                  <td className="py-3 font-semibold text-slate-900">{o.party}</td>
                  <td className="py-3 text-slate-700">{o.duty}</td>
                  <td className="py-3 text-slate-500 font-mono">{o.deadline}</td>
                  <td className="py-3">{getSeverityBadge(o.riskLevel)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB: Deterministic Facts */}
      {activeTab === 'facts' && extractedFields && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-bold text-sm text-slate-900 mb-3">Detected Monetary Figures</h4>
            <div className="flex flex-wrap gap-1.5">
              {(extractedFields.amounts || []).length === 0 ? (
                <span className="text-xs text-slate-400">None detected</span>
              ) : (
                extractedFields.amounts.map((a, i) => (
                  <span key={i} className="rounded-md bg-emerald-50 px-2 py-1 text-xs font-mono font-semibold text-emerald-800 border border-emerald-200">
                    {a}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-bold text-sm text-slate-900 mb-3">Detected Dates & Timelines</h4>
            <div className="flex flex-wrap gap-1.5">
              {(extractedFields.dates || []).length === 0 ? (
                <span className="text-xs text-slate-400">None detected</span>
              ) : (
                extractedFields.dates.map((d, i) => (
                  <span key={i} className="rounded-md bg-blue-50 px-2 py-1 text-xs font-mono font-semibold text-blue-800 border border-blue-200">
                    {d}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-bold text-sm text-slate-900 mb-3">Identified Statutory Clauses</h4>
            <div className="flex flex-wrap gap-1.5">
              {(extractedFields.clauses || []).length === 0 ? (
                <span className="text-xs text-slate-400">None detected</span>
              ) : (
                extractedFields.clauses.map((c, i) => (
                  <span key={i} className="rounded-md bg-indigo-50 px-2 py-1 text-xs font-semibold text-indigo-800 border border-indigo-200">
                    {c.replace('_', ' ')}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h4 className="font-bold text-sm text-slate-900 mb-3">Email & Party Identifiers</h4>
            <div className="flex flex-wrap gap-1.5">
              {(extractedFields.emails || []).length === 0 ? (
                <span className="text-xs text-slate-400">None detected</span>
              ) : (
                extractedFields.emails.map((e, i) => (
                  <span key={i} className="rounded-md bg-slate-100 px-2 py-1 text-xs font-mono text-slate-700">
                    {e}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* ADD REVIEWER COMMENT MODAL */}
      {newCommentModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 space-y-4 animate-in fade-in zoom-in duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-indigo-600" />
                <h3 className="font-bold text-slate-900 text-base">Add Reviewer Note</h3>
              </div>
              <button
                onClick={() => setNewCommentModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            {activeCommentTarget.snippet && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-700">
                <span className="font-semibold text-slate-500 block mb-1">Referenced Text / Discrepancy:</span>
                <code className="font-mono text-slate-900 font-bold bg-white px-2 py-1 rounded border border-slate-200 block truncate">
                  {activeCommentTarget.snippet}
                </code>
              </div>
            )}

            {/* Target slide selector */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">Target Document</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'slideA', label: 'Slide A (Original)' },
                  { id: 'slideB', label: 'Slide B (Revision)' },
                  { id: 'both', label: 'Both Slides' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setActiveCommentTarget((prev) => ({ ...prev, target: t.id }))}
                    className={`rounded-lg py-1.5 text-xs font-semibold border transition ${
                      activeCommentTarget.target === t.id
                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-xs'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Tag selector */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">Category Tag</label>
              <div className="grid grid-cols-4 gap-2">
                {[
                  { id: 'Issue', color: 'bg-rose-600 border-rose-600 text-white' },
                  { id: 'Question', color: 'bg-amber-600 border-amber-600 text-white' },
                  { id: 'Todo', color: 'bg-blue-600 border-blue-600 text-white' },
                  { id: 'Approved', color: 'bg-emerald-600 border-emerald-600 text-white' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setCommentTag(t.id)}
                    className={`rounded-lg py-1.5 text-xs font-bold border transition ${
                      commentTag === t.id
                        ? t.color
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {t.id}
                  </button>
                ))}
              </div>
            </div>

            {/* Comment text */}
            <div>
              <label className="block text-xs font-bold uppercase text-slate-600 mb-1.5">Reviewer Comment / Note</label>
              <textarea
                rows={3}
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder="e.g. Verify dosage with formulation team, or formatting typo..."
                className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                autoFocus
              />
            </div>

            {/* Actions */}
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setNewCommentModalOpen(false)}
                className="rounded-lg px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddComment}
                disabled={!commentText.trim()}
                className="rounded-lg bg-indigo-600 hover:bg-indigo-700 px-4 py-2 text-xs font-bold text-white shadow-xs transition disabled:opacity-50"
              >
                Save Note
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
