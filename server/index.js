import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { initStorage, saveReview, listReviews, getReviewById, clearReviews, getStorageStatus } from './storage.js';
import { extractDocumentText, extractDocxHtml } from './extractors.js';
import { extractDeterministicFields, diffDeterministic, computeVisualWordDiff } from './deterministic.js';
import { analyzeDocument, compareDocuments, answerReviewQuestion } from './aiEngine.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env
dotenv.config({ path: path.join(__dirname, '.env') });

// Guard against unhandled rejections from external parser libraries
process.on('unhandledRejection', (reason) => {
  console.warn('[SERVER] Caught unhandled rejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('[SERVER] Caught uncaught exception:', err.message);
});

const app = express();
const PORT = process.env.PORT || 5000;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';

// Configure middleware
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

// Normalize URL for serverless environments (handles /api prefix variations)
app.use((req, res, next) => {
  if (
    !req.url.startsWith('/api') &&
    (req.url === '/health' ||
      req.url.startsWith('/analyze') ||
      req.url.startsWith('/compare') ||
      req.url.startsWith('/history') ||
      req.url.startsWith('/qa') ||
      req.url.startsWith('/export'))
  ) {
    req.url = '/api' + req.url;
  }
  next();
});

// Multer memory storage for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB limit
});

// Initialize database / storage
await initStorage();

/* ────────────────────────── API Endpoints ─────────────────────────── */

// Health check
app.get('/api/health', (req, res) => {
  const storageStatus = getStorageStatus();
  res.json({
    status: 'ok',
    app: 'DocIntel Smart Reviewer',
    storage: storageStatus.mode,
    mongoConnected: storageStatus.isMongoConnected,
    hasApiKey: !!OPENROUTER_KEY,
    timestamp: new Date().toISOString(),
  });
});

// 1. Single Document Deep Review
app.post('/api/analyze', upload.single('file'), async (req, res) => {
  try {
    let documentText = '';
    let documentName = 'Pasted Text Document';

    if (req.file) {
      documentName = req.file.originalname;
      documentText = await extractDocumentText(documentName, req.file.buffer);
    } else if (req.body.text) {
      documentText = req.body.text.trim();
      documentName = req.body.title || 'Document Text';
    } else {
      return res.status(400).json({ error: 'No document file or text provided.' });
    }

    let imagePreview = null;
    let pdfData = null;
    if (req.file) {
      if (req.file.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(documentName)) {
        imagePreview = `data:${req.file.mimetype || 'image/png'};base64,${req.file.buffer.toString('base64')}`;
      }
      if (req.file.mimetype === 'application/pdf' || /\.pdf$/i.test(documentName)) {
        pdfData = `data:application/pdf;base64,${req.file.buffer.toString('base64')}`;
      }
    }

    if (!documentText) {
      return res.status(400).json({ error: 'Document contains no extractable text.' });
    }

    // Step 1: Deterministic rules extraction
    const deterministicData = extractDeterministicFields(documentText);

    // Step 2: AI / Forensic Reasoning Layer
    const result = await analyzeDocument(documentText, deterministicData, OPENROUTER_KEY);

    // Step 3: Save to storage
    const saved = await saveReview({
      mode: 'analyze',
      title: documentName,
      docAName: documentName,
      overallScore: result.overallScore,
      criticalCount: result.criticalCount,
      highCount: result.highCount,
      summary: result.summary,
      documentText,
      result: {
        ...result,
        imagePreview,
        pdfData,
      },
      modelUsed: result.modelUsed,
    });

    res.json({
      reviewId: saved.id,
      storageEngine: saved.storage,
      documentName,
      imagePreview,
      pdfData,
      extractedFields: deterministicData,
      ...result,
    });
  } catch (err) {
    console.error('[API /analyze] Error:', err);
    res.status(500).json({
      error: err.message || 'Analysis could not be completed.',
      code: 'ANALYZE_ERROR',
    });
  }
});

// 2. Two-Document Forensic Comparison
app.post(
  '/api/compare',
  upload.any(),
  async (req, res) => {
    console.log('[API /compare] Received comparison request...');
    try {
      let textA = '';
      let textB = '';
      let nameA = 'Document A';
      let nameB = 'Document B';
      let imageA = null;
      let imageB = null;
      let pdfA = null;
      let pdfB = null;

      const fileList = Array.isArray(req.files) ? req.files : [];
      const fileA = fileList.find((f) => f.fieldname === 'documentA' || f.fieldname === 'fileA' || f.fieldname === 'file') || fileList[0];
      const fileB = fileList.find((f) => f.fieldname === 'documentB' || f.fieldname === 'fileB') || (fileList.length > 1 && fileList[1] !== fileA ? fileList[1] : null);

      let docxHtmlA = null;
      let docxHtmlB = null;

      if (fileA) {
        nameA = fileA.originalname;
        if (fileA.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(nameA)) {
          imageA = `data:${fileA.mimetype || 'image/png'};base64,${fileA.buffer.toString('base64')}`;
        }
        if (fileA.mimetype === 'application/pdf' || /\.pdf$/i.test(nameA)) {
          pdfA = `data:application/pdf;base64,${fileA.buffer.toString('base64')}`;
        }
        if (/\.docx$/i.test(nameA)) {
          docxHtmlA = await extractDocxHtml(fileA.buffer);
        }
        textA = await extractDocumentText(nameA, fileA.buffer);
      } else if (req.body.textA) {
        textA = req.body.textA.trim();
        nameA = req.body.nameA || 'Document A';
      }

      if (fileB) {
        nameB = fileB.originalname;
        if (fileB.mimetype?.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(nameB)) {
          imageB = `data:${fileB.mimetype || 'image/png'};base64,${fileB.buffer.toString('base64')}`;
        }
        if (fileB.mimetype === 'application/pdf' || /\.pdf$/i.test(nameB)) {
          pdfB = `data:application/pdf;base64,${fileB.buffer.toString('base64')}`;
        }
        if (/\.docx$/i.test(nameB)) {
          docxHtmlB = await extractDocxHtml(fileB.buffer);
        }
        textB = await extractDocumentText(nameB, fileB.buffer);
      } else if (req.body.textB) {
        textB = req.body.textB.trim();
        nameB = req.body.nameB || 'Document B';
      }

      if (!textA || !textB) {
        return res.status(400).json({ error: 'Both Document A and Document B are required for comparison.' });
      }

      // Step 1: Word-by-word visual diff & statistics
      const isDocxA = !!(docxHtmlA || (/\.docx?$/i.test(nameA)));
      const isPdfB = !!(pdfB || (/\.pdf$/i.test(nameB)) || fileB?.mimetype === 'application/pdf');
      const isWordToPdf = isDocxA && isPdfB;

      console.log(`[API /compare] Computing visual & deterministic diff (isWordToPdf: ${isWordToPdf})...`);
      const visualDiff = computeVisualWordDiff(textA, textB, { isWordToPdf, docAName: nameA, docBName: nameB });

      // Step 2: Deterministic extraction & factual diff
      const detA = extractDeterministicFields(textA);
      const detB = extractDeterministicFields(textB);
      const deterministicDiffs = diffDeterministic(detA, detB, textA, textB);
      console.log(`[API /compare] Deterministic diff complete: ${visualDiff.proofreadingErrors?.length || 0} proofreading errors found.`);

      // Step 3: AI / Forensic Comparison
      console.log('[API /compare] Starting AI semantic comparison...');
      const result = await compareDocuments(textA, textB, detA, detB, deterministicDiffs, OPENROUTER_KEY);
      console.log('[API /compare] AI semantic comparison complete.');

      // Step 4: Save to storage
      const saved = await saveReview({
        mode: 'compare',
        title: `${nameA} vs ${nameB}`,
        docAName: nameA,
        docBName: nameB,
        overallScore: result.overallScore,
        criticalCount: result.criticalCount,
        highCount: result.highCount,
        summary: result.summary,
        documentText: `=== Document A: ${nameA} ===\n${textA}\n\n=== Document B: ${nameB} ===\n${textB}`,
        result: {
          ...result,
          similarity: visualDiff.similarity,
          wordsAdded: visualDiff.wordsAdded,
          wordsRemoved: visualDiff.wordsRemoved,
          diffParts: visualDiff.diffParts,
          proofreadingParts: visualDiff.proofreadingParts,
          leftParts: visualDiff.leftParts,
          rightParts: visualDiff.rightParts,
          sideBySide: visualDiff.sideBySide,
          proofreadingErrors: visualDiff.proofreadingErrors,
          matchingTokens: visualDiff.matchingTokens || [],
          isiAudit: visualDiff.isiAudit || null,
          mismatchReport: visualDiff.mismatchReport || [],
          isWordToPdf,
          isIsiComparison: visualDiff.isIsiComparison || false,
          isiComplianceScore: visualDiff.isiComplianceScore ?? visualDiff.similarity,
          isiDetectedBlocks: visualDiff.isiDetectedBlocks || [],
          errorSummary: visualDiff.errorSummary,
          textA,
          textB,
          imageA,
          imageB,
          pdfA,
          pdfB,
          docxHtmlA,
          docxHtmlB,
        },
        modelUsed: result.modelUsed,
      });

      res.json({
        reviewId: saved.id,
        storageEngine: saved.storage,
        docAName: nameA,
        docBName: nameB,
        similarity: visualDiff.similarity,
        wordsAdded: visualDiff.wordsAdded,
        wordsRemoved: visualDiff.wordsRemoved,
        diffParts: visualDiff.diffParts,
        proofreadingParts: visualDiff.proofreadingParts,
        leftParts: visualDiff.leftParts,
        rightParts: visualDiff.rightParts,
        sideBySide: visualDiff.sideBySide,
        proofreadingErrors: visualDiff.proofreadingErrors,
        matchingTokens: visualDiff.matchingTokens || [],
        isiAudit: visualDiff.isiAudit || null,
        mismatchReport: visualDiff.mismatchReport || [],
        isWordToPdf,
        isIsiComparison: visualDiff.isIsiComparison || false,
        isiComplianceScore: visualDiff.isiComplianceScore ?? visualDiff.similarity,
        isiDetectedBlocks: visualDiff.isiDetectedBlocks || [],
        errorSummary: visualDiff.errorSummary,
        textA,
        textB,
        imageA,
        imageB,
        pdfA,
        pdfB,
        docxHtmlA,
        docxHtmlB,
        hasPdf: !!(pdfA || pdfB),
        hasImages: !!(imageA || imageB),
        deterministicDiffs,
        ...result,
      });
    } catch (err) {
      console.error('[API /compare] Error:', err);
      res.status(500).json({
        error: err.message || 'Comparison could not be completed.',
        code: 'COMPARE_ERROR',
      });
    }
  }
);

// 3. List Review History
app.get('/api/history', async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;
    const history = await listReviews({ page, limit });
    res.json(history);
  } catch (err) {
    console.error('[API /history] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve history.', code: 'HISTORY_ERROR' });
  }
});

// 4. Get Specific Review
app.get('/api/history/:id', async (req, res) => {
  try {
    const review = await getReviewById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Review not found.', code: 'NOT_FOUND' });
    }
    res.json(review);
  } catch (err) {
    console.error('[API /history/:id] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve review.', code: 'REVIEW_ERROR' });
  }
});

// 5. Clear Review History
app.delete('/api/history', async (req, res) => {
  try {
    const count = await clearReviews();
    res.json({ success: true, deletedCount: count });
  } catch (err) {
    console.error('[API DELETE /history] Error:', err);
    res.status(500).json({ error: 'Failed to clear history.' });
  }
});

// 6. Interactive Document Q&A
app.post('/api/qa/:id', async (req, res) => {
  try {
    const { question } = req.body;
    if (!question) {
      return res.status(400).json({ error: 'Question is required.' });
    }

    const review = await getReviewById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    const answer = await answerReviewQuestion(
      review.documentText,
      review.result || {},
      question,
      OPENROUTER_KEY
    );

    res.json({ answer, reviewId: req.params.id });
  } catch (err) {
    console.error('[API /qa] Error:', err);
    res.status(500).json({ error: 'Failed to generate answer.' });
  }
});

// 7. Export Review (Markdown or JSON)
app.get('/api/export/:id', async (req, res) => {
  try {
    const review = await getReviewById(req.params.id);
    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    const format = req.query.format || 'markdown';
    if (format === 'json') {
      res.setHeader('Content-Disposition', `attachment; filename="review_${review._id}.json"`);
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(review, null, 2));
    }

    // Generate Markdown report
    const md = [
      `# DocIntel Forensic Review: ${review.title}`,
      `**Date**: ${new Date(review.createdAt).toLocaleDateString()}`,
      `**Mode**: ${review.mode.toUpperCase()}`,
      `**Overall Score**: ${review.overallScore}/100`,
      `**Critical Issues**: ${review.criticalCount} | **High Issues**: ${review.highCount}`,
      ``,
      `## Executive Summary`,
      review.summary,
      ``,
      review.result?.changes
        ? `## Detected Changes (${review.result.changes.length})\n` +
          review.result.changes
            .map((c) => `- **[${c.severity?.toUpperCase() || 'MOD'}] ${c.title}**: ${c.details}`)
            .join('\n')
        : '',
      ``,
      `## Key Findings (${review.result?.findings?.length || 0})`,
      ...(review.result?.findings || []).map(
        (f) => `### [${f.severity?.toUpperCase()}] ${f.title}\n- **Category**: ${f.category}\n- **Detail**: ${f.description}\n- **Clause**: ${f.clause || 'N/A'}\n- **Recommendation**: ${f.recommendation}`
      ),
    ].filter(Boolean).join('\n\n');

    res.setHeader('Content-Disposition', `attachment; filename="review_${review._id}.md"`);
    res.setHeader('Content-Type', 'text/markdown');
    res.send(md);
  } catch (err) {
    console.error('[API /export] Error:', err);
    res.status(500).json({ error: 'Failed to export review.' });
  }
});

// Serve built client if available
const clientDist = path.join(__dirname, '../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

// Global JSON Error Handler (catches multer, parsing, or unexpected errors)
app.use((err, req, res, next) => {
  console.error('[API ERROR]', err);
  res.status(err.status || 500).json({
    error: err.message || 'An unexpected error occurred during processing.',
  });
});

// Start listening with port fallback (when not running as serverless function)
let server;
if (process.env.VERCEL !== '1') {
  server = app.listen(PORT, () => {
    console.log(`=========================================`);
    console.log(`🚀 DocIntel Smart Reviewer Server`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`=========================================`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      const nextPort = Number(PORT) + 1;
      console.warn(`[SERVER] Port ${PORT} is in use, retrying on port ${nextPort}...`);
      app.listen(nextPort, () => {
        console.log(`=========================================`);
        console.log(`🚀 DocIntel Smart Reviewer Server`);
        console.log(`📡 URL: http://localhost:${nextPort}`);
        console.log(`=========================================`);
      });
    } else {
      console.error('[SERVER] Server listen error:', err);
    }
  });
}

export default app;
