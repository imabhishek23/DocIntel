import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import mammoth from 'mammoth';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

/**
 * Extracts clean textual content from uploaded file buffers.
 * Supported formats: .pdf, .docx, .txt, .md, .csv, .json, images
 */
export async function extractDocumentText(filename, buffer) {
  if (!buffer || buffer.length === 0) {
    throw new Error('Uploaded document is empty.');
  }

  const ext = path.extname(filename).toLowerCase();

  switch (ext) {
    case '.pdf': {
      try {
        const text = await extractPdfText(buffer);
        if (text && text.trim().length > 0) {
          return normalizeText(text);
        }

        console.warn(`[PDF] No text layer found in '${filename}'. PDF may be scanned or image-only.`);
        throw new Error('Could not extract readable text from PDF (it may be scanned, image-only, or encrypted).');
      } catch (err) {
        if (err.message?.includes('password') || err.message?.includes('encrypted')) {
          throw new Error('PDF is password-protected. Please provide an unlocked document.');
        }
        throw new Error(`PDF extraction failed: ${err.message}`);
      }
    }

    case '.docx': {
      try {
        const result = await mammoth.convertToHtml({ buffer });
        let html = (result.value || '').trim();
        if (!html) {
          const raw = await mammoth.extractRawText({ buffer });
          const text = (raw.value || '').trim();
          if (!text) throw new Error('Could not extract readable text from DOCX.');
          return normalizeText(text);
        }
        let text = html
          .replace(/<strong>/gi, '<b>')
          .replace(/<\/strong>/gi, '</b>')
          .replace(/<em>/gi, '<i>')
          .replace(/<\/em>/gi, '</i>')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ');
        return normalizeText(text);
      } catch (err) {
        throw new Error(`DOCX extraction failed: ${err.message}`);
      }
    }

    case '.txt':
    case '.md':
    case '.csv':
    case '.json': {
      const text = buffer.toString('utf-8').trim();
      if (!text) {
        throw new Error('Text document is empty.');
      }
      return normalizeText(text);
    }

    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.webp':
    case '.bmp':
    case '.tiff':
    case '.tif': {
      try {
        console.log(`[OCR] Processing image '${filename}' with Tesseract OCR...`);
        const text = await extractImageText(buffer);
        if (text && text.trim().length > 0) {
          console.log(`[OCR] Extracted ${text.split(/\s+/).length} words from image '${filename}'.`);
          return normalizeText(text);
        }
        return `[Image: ${filename} - Visual comparison processed]`;
      } catch (err) {
        console.warn(`[OCR] Extraction warning for '${filename}':`, err.message);
        return `[Image: ${filename} - OCR could not recognize printed text]`;
      }
    }

    default:
      throw new Error(`Unsupported file type '${ext}'. Please upload a PDF, DOCX, TXT, or Image (PNG/JPG/WEBP).`);
  }
}

/**
 * Extracts structured text from PDF using modern pdfjs-dist engine.
 * Groups items into lines by baseline Y coordinate, preserving superscripts,
 * subscripts, lists, and layout order.
 */
/**
 * Assembles text items on the same baseline into a clean line string,
 * detecting horizontal gaps between characters/words to preserve spacing.
 */
function assembleLineItems(lineItems) {
  if (!lineItems || lineItems.length === 0) return '';
  const sorted = lineItems.slice().sort((a, b) => a.x - b.x);
  let lineStr = '';

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];
    if (i > 0) {
      const prev = sorted[i - 1];
      const prevEnd = prev.x + (prev.width || 0);
      const gap = cur.x - prevEnd;

      // If there is a visible gap (> 2 pt) and neither previous ended with space nor current starts with space
      if (gap > 2 && !prev.str.endsWith(' ') && !cur.str.startsWith(' ')) {
        lineStr += ' ';
      }
    }

    if (cur.str.trim().length === 0) {
      lineStr += cur.str;
    } else {
      let t = cur.str;
      if (cur.isBold && cur.isItalic) {
        t = `<b><i>${t}</i></b>`;
      } else if (cur.isBold) {
        t = `<b>${t}</b>`;
      } else if (cur.isItalic) {
        t = `<i>${t}</i>`;
      }
      lineStr += t;
    }
  }

  return lineStr
    .replace(/<\/b>(\s*)<b>/g, '$1')
    .replace(/<\/i>(\s*)<i>/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Extracts structured text from PDF using modern pdfjs-dist engine.
 * Groups items into lines by baseline Y coordinate, preserving superscripts,
 * subscripts, lists, bold/italic font styling, and layout order with accurate line breaking and spacing.
 * If the PDF has no embedded text layer (scanned/image-only), falls back to OCR.
 */
async function extractPdfText(buffer) {
  const uint8 = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({ data: uint8, verbosity: 0 }).promise;
  let fullText = '';

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    // Populate font objects in page.commonObjs
    await page.getOperatorList();
    const textContent = await page.getTextContent();
    const items = textContent.items;

    if (!items || items.length === 0) continue;

    const pageLines = [];
    let currentLine = [];
    let currentBaselineY = null;
    let prevBaselineY = null;
    let avgItemHeight = 12;

    for (const item of items) {
      if (!item.str && item.str !== ' ') continue;
      const y = item.transform[5];
      const height = item.height || 12;
      avgItemHeight = height;
      const threshold = item.height ? Math.max(7, item.height * 0.7) : 7;

      // Extract bold & italic font styling from page.commonObjs
      let isBold = false;
      let isItalic = false;
      if (item.fontName && page.commonObjs.has(item.fontName)) {
        const font = page.commonObjs.get(item.fontName);
        if (font) {
          isBold = !!font.bold || (typeof font.name === 'string' && /bold|black|heavy/i.test(font.name));
          isItalic = !!font.italic || (typeof font.name === 'string' && /italic|oblique/i.test(font.name));
        }
      }

      const itemData = {
        str: item.str,
        x: item.transform[4],
        width: item.width || 0,
        isBold,
        isItalic,
      };

      if (currentBaselineY === null || Math.abs(y - currentBaselineY) > threshold) {
        if (currentLine.length > 0) {
          const assembled = assembleLineItems(currentLine);
          if (assembled) {
            // Check vertical gap to determine if this is a paragraph break
            if (prevBaselineY !== null) {
              const deltaY = Math.abs(prevBaselineY - currentBaselineY);
              if (deltaY > Math.max(18, avgItemHeight * 1.5)) {
                pageLines.push(''); // Empty line for paragraph separation
              }
            }
            pageLines.push(assembled);
            prevBaselineY = currentBaselineY;
          }
        }
        currentLine = [itemData];
        currentBaselineY = y;
      } else {
        currentLine.push(itemData);
      }
    }

    if (currentLine.length > 0) {
      const assembled = assembleLineItems(currentLine);
      if (assembled) {
        pageLines.push(assembled);
      }
    }

    const pageText = pageLines.join('\n').trim();
    if (pageText) {
      fullText += pageText + '\n\n';
    }
  }

  // Fallback: If no text was extracted from any page, check if pages are scanned images
  if (!fullText || fullText.trim().length === 0) {
    console.log(`[PDF] No text layer found across ${doc.numPages} pages. Checking for scanned page images / OCR fallback...`);
    let ocrText = '';

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      try {
        const page = await doc.getPage(pageNum);
        const ops = await page.getOperatorList();

        for (let i = 0; i < ops.fnArray.length; i++) {
          const fn = ops.fnArray[i];
          if (fn === pdfjs.OPS.paintImageXObject || fn === pdfjs.OPS.paintInlineImageXObject) {
            const imgName = ops.argsArray[i][0];
            try {
              const imgObj = await new Promise((resolve) => {
                page.objs.get(imgName, (obj) => resolve(obj));
              });

              if (imgObj && imgObj.data && imgObj.width && imgObj.height) {
                if (!ocrWorkerInstance) {
                  ocrWorkerInstance = await createWorker('eng', 1, {
                    errorHandler: (err) => console.warn('[OCR Worker Warning]:', err),
                  });
                }
                const ocrRes = await ocrWorkerInstance.recognize({
                  data: imgObj.data,
                  width: imgObj.width,
                  height: imgObj.height,
                });
                if (ocrRes?.data?.text?.trim()) {
                  ocrText += ocrRes.data.text.trim() + '\n\n';
                }
              }
            } catch (imgErr) {
              console.warn(`[OCR] Image extraction failed for ${imgName}:`, imgErr.message);
            }
          }
        }
      } catch (pageErr) {
        console.warn(`[OCR] Page ${pageNum} processing error:`, pageErr.message);
      }
    }

    if (ocrText.trim().length > 0) {
      return ocrText.trim();
    }
  }

  return fullText.trim();
}

function normalizeText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

let ocrWorkerInstance = null;

export async function extractImageText(buffer) {
  try {
    if (!ocrWorkerInstance) {
      ocrWorkerInstance = await createWorker('eng', 1, {
        errorHandler: (err) => console.warn('[OCR Worker Warning]:', err),
      });
    }
    const ret = await ocrWorkerInstance.recognize(buffer);
    return (ret.data?.text || '').trim();
  } catch (err) {
    console.warn('[OCR] Extraction error:', err.message || err);
    try {
      if (ocrWorkerInstance) {
        await ocrWorkerInstance.terminate();
      }
    } catch {}
    ocrWorkerInstance = null;
    return '';
  }
}
