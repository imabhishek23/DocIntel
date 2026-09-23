import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import 'pdfjs-dist/legacy/build/pdf.worker.js';
import pdfParse from 'pdf-parse';
import mammoth from 'mammoth';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

let ocrWorkerInstance = null;

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
          .replace(/<ins>/gi, '<u>')
          .replace(/<\/ins>/gi, '</u>')
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<li\b[^>]*>/gi, '• ')
          .replace(/<\/(?:p|h[1-6]|div|tr|li|blockquote)>/gi, '\n\n')
          .replace(/<(?!\/?(?:b|i|u|font)\b)[^>]+>/g, '')
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&nbsp;/g, ' ')
          .replace(/\n{3,}/g, '\n\n');
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
 * Classifies RGB color into high-level categories (black, red, blue, green, gray)
 */
function getColorCategory(color) {
  if (!color || !Array.isArray(color) || color.length < 3) return 'black';
  const [r, g, b] = color;

  // 1. Black / dark neutral: low intensity and low channel spread
  if (r < 65 && g < 65 && b < 65 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25) {
    return 'black';
  }

  // 1b. Dark navy / deep slate blue (e.g. r: 18, g: 49, b: 72)
  if (r < 60 && g < 80 && b > 40 && b > r * 1.5 && b > g * 1.1) {
    return 'navy';
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

      // If gap is significant (> 1 pt) and neither previous ended with space nor current starts with space
      if (gap > 1 && !prev.str.endsWith(' ') && !cur.str.startsWith(' ')) {
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
      if (cur.isUnderline) {
        t = `<u>${t}</u>`;
      }
      if (cur.colorCategory && cur.colorCategory !== 'black') {
        t = `<font color="rgb(${cur.color.join(',')})" data-cat="${cur.colorCategory}">${t}</font>`;
      }
      lineStr += t;
    }
  }

  return lineStr
    .replace(/<\/b>(\s*)<b>/g, '$1')
    .replace(/<\/i>(\s*)<i>/g, '$1')
    .replace(/<\/u>(\s*)<u>/g, '$1')
    .replace(/<\/i><\/b>(\s*)<b><i>/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function createBmpBufferDownsampled(origW, origH, rgbData, scale = 2.5) {
  const newW = Math.floor(origW / scale);
  const newH = Math.floor(origH / scale);
  const rowStride = newW * 3;
  const padding = (4 - (rowStride % 4)) % 4;
  const pixelDataSize = (rowStride + padding) * newH;
  const fileSize = 54 + pixelDataSize;

  const buf = Buffer.alloc(fileSize);
  buf.write('BM', 0);
  buf.writeUInt32LE(fileSize, 2);
  buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14);
  buf.writeInt32LE(newW, 18);
  buf.writeInt32LE(newH, 22);
  buf.writeUInt16LE(1, 26);
  buf.writeUInt16LE(24, 28);
  buf.writeUInt32LE(pixelDataSize, 34);

  const origRowStride = origW * 3;
  let offset = 54;
  for (let y = newH - 1; y >= 0; y--) {
    const srcOffset = Math.floor(y * scale) * origRowStride;
    for (let x = 0; x < newW; x++) {
      const pSrc = srcOffset + Math.floor(x * scale) * 3;
      buf[offset++] = rgbData[pSrc + 2];
      buf[offset++] = rgbData[pSrc + 1];
      buf[offset++] = rgbData[pSrc];
    }
    for (let p = 0; p < padding; p++) buf[offset++] = 0;
  }
  return { buf, width: newW, height: newH };
}

function sampleColorFromImage(imgObj, imgX, imgY) {
  const width = imgObj.width;
  const height = imgObj.height;
  const data = imgObj.data;
  let minLum = 999;
  let bestRgb = [0, 0, 0];

  const startX = Math.max(0, imgX - 6);
  const endX = Math.min(width - 1, imgX + 6);
  const startY = Math.max(0, imgY - 6);
  const endY = Math.min(height - 1, imgY + 6);

  for (let y = startY; y <= endY; y++) {
    const rowOffset = y * width * 3;
    for (let x = startX; x <= endX; x++) {
      const p = rowOffset + x * 3;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      if (r > 225 && g > 225 && b > 225) continue;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      if (lum < minLum) {
        minLum = lum;
        bestRgb = [r, g, b];
      }
    }
  }
  return bestRgb;
}

/**
 * Extracts structured text from PDF using modern pdfjs-dist engine.
 * Groups items into lines by baseline Y coordinate, preserving superscripts,
 * subscripts, lists, bold/italic font styling, and layout order with accurate line breaking and spacing.
 * If the PDF has no embedded text layer (scanned/image-only), falls back to OCR.
 */
async function extractPdfText(buffer) {
  let fullText = '';

  // Attempt 1: Advanced layout and styling extraction with pdfjs-dist
  try {
    const uint8 = new Uint8Array(buffer);
    const doc = await pdfjs.getDocument({
      data: uint8,
      verbosity: 0,
      cMapUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/',
      cMapPacked: true,
      standardFontDataUrl: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/',
    }).promise;

    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      // Extract text show ops and their fill colors from operator list
      const opList = await page.getOperatorList();
      let currentFill = [0, 0, 0];
      const colorStack = [];
      const textOps = [];
      let currentTransform = null;
      let largeImgObj = null;
      let imgTransform = null;

      // Track transformation matrix and horizontal stroke lines for vector underlines
      let ctm = [1, 0, 0, 1, 0, 0];
      const ctmStack = [];
      const underlineSegments = [];

      function multiplyMatrix(m1, m2) {
        return [
          m1[0] * m2[0] + m1[1] * m2[2],
          m1[0] * m2[1] + m1[1] * m2[3],
          m1[2] * m2[0] + m1[3] * m2[2],
          m1[2] * m2[1] + m1[3] * m2[3],
          m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
          m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
        ];
      }

      function applyTransform(x, y, m) {
        return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
      }

      for (let i = 0; i < opList.fnArray.length; i++) {
        const fn = opList.fnArray[i];
        const args = opList.argsArray[i];

        if (fn === pdfjs.OPS.transform) {
          currentTransform = args;
          ctm = multiplyMatrix(ctm, args);
        } else if (fn === pdfjs.OPS.paintImageXObject) {
          const name = args[0];
          const img = page.objs.get(name);
          if (img && img.width >= 500 && img.height >= 500) {
            largeImgObj = img;
            imgTransform = currentTransform;
          }
        } else if (fn === pdfjs.OPS.save) {
          colorStack.push([...currentFill]);
          ctmStack.push([...ctm]);
        } else if (fn === pdfjs.OPS.restore) {
          if (colorStack.length > 0) currentFill = colorStack.pop();
          if (ctmStack.length > 0) ctm = ctmStack.pop();
        } else if (fn === pdfjs.OPS.setFillRGBColor || fn === pdfjs.OPS.setStrokeRGBColor) {
          let [r, g, b] = args;
          if (r <= 1 && g <= 1 && b <= 1 && (r > 0 || g > 0 || b > 0)) {
            r = Math.round(r * 255);
            g = Math.round(g * 255);
            b = Math.round(b * 255);
          }
          currentFill = [Math.round(r), Math.round(g), Math.round(b)];
        } else if (fn === pdfjs.OPS.setFillGray || fn === pdfjs.OPS.setStrokeGray) {
          let gray = args[0];
          if (gray <= 1 && gray > 0) gray = Math.round(gray * 255);
          const gVal = Math.round(gray);
          currentFill = [gVal, gVal, gVal];
        } else if (fn === pdfjs.OPS.setFillCMYKColor || fn === pdfjs.OPS.setStrokeCMYKColor) {
          let [c, m, y, k] = args;
          if (c > 1 || m > 1 || y > 1 || k > 1) {
            c = c / 100; m = m / 100; y = y / 100; k = k / 100;
          }
          const r = Math.round(255 * (1 - c) * (1 - k));
          const g = Math.round(255 * (1 - m) * (1 - k));
          const b = Math.round(255 * (1 - y) * (1 - k));
          currentFill = [Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b))];
        } else if (fn === pdfjs.OPS.constructPath) {
          const [pathOps, pathArgs] = args || [];
          if (Array.isArray(pathOps) && Array.isArray(pathArgs)) {
            let pIdx = 0;
            let lastX = 0, lastY = 0;
            for (let j = 0; j < pathOps.length; j++) {
              const op = pathOps[j];
              if (op === 13) {
                lastX = pathArgs[pIdx++];
                lastY = pathArgs[pIdx++];
              } else if (op === 14) {
                const curX = pathArgs[pIdx++];
                const curY = pathArgs[pIdx++];
                const p1 = applyTransform(lastX, lastY, ctm);
                const p2 = applyTransform(curX, curY, ctm);
                if (Math.abs(p1[1] - p2[1]) <= 3.5 && Math.abs(p1[0] - p2[0]) >= 8) {
                  underlineSegments.push({
                    x1: Math.min(p1[0], p2[0]),
                    x2: Math.max(p1[0], p2[0]),
                    y: (p1[1] + p2[1]) / 2,
                  });
                }
                lastX = curX;
                lastY = curY;
              } else if (op === 42) {
                const rx = pathArgs[pIdx++];
                const ry = pathArgs[pIdx++];
                const rw = pathArgs[pIdx++];
                const rh = pathArgs[pIdx++];
                const p1 = applyTransform(rx, ry, ctm);
                const p2 = applyTransform(rx + rw, ry + rh, ctm);
                const h = Math.abs(p2[1] - p1[1]);
                const w = Math.abs(p2[0] - p1[0]);
                if (h <= 3.5 && w >= 8) {
                  underlineSegments.push({
                    x1: Math.min(p1[0], p2[0]),
                    x2: Math.max(p1[0], p2[0]),
                    y: (p1[1] + p2[1]) / 2,
                  });
                }
              }
            }
          }
        } else if (fn === pdfjs.OPS.rectangle) {
          const [rx, ry, rw, rh] = args || [];
          if (rx !== undefined && ry !== undefined && rw !== undefined && rh !== undefined) {
            const p1 = applyTransform(rx, ry, ctm);
            const p2 = applyTransform(rx + rw, ry + rh, ctm);
            const h = Math.abs(p2[1] - p1[1]);
            const w = Math.abs(p2[0] - p1[0]);
            if (h <= 3.5 && w >= 8) {
              underlineSegments.push({
                x1: Math.min(p1[0], p2[0]),
                x2: Math.max(p1[0], p2[0]),
                y: (p1[1] + p2[1]) / 2,
              });
            }
          }
        } else if (fn === pdfjs.OPS.showText || fn === pdfjs.OPS.showSpacedText) {
          const glyphs = args[0];
          let str = '';
          if (fn === pdfjs.OPS.showText) {
            str = glyphs.map((g) => (g && g.unicode !== undefined ? g.unicode : typeof g === 'string' ? g : '')).join('');
          } else {
            str = glyphs
              .filter((x) => typeof x === 'object' && x && x.unicode !== undefined)
              .map((x) => x.unicode)
              .join('');
          }
          if (str.trim().length > 0) {
            textOps.push({ str: str.trim(), color: [...currentFill] });
          }
        }
      }

      const textContent = await page.getTextContent();
      const items = textContent.items;

      // Check if page is image-based or scanned (fewer than 50 vector text items but has large image)
      if ((!items || items.length < 50) && largeImgObj) {
        console.log(`[PDF] Page ${pageNum} is image-based (${largeImgObj.width}x${largeImgObj.height}, vector items=${items ? items.length : 0}). Running OCR...`);
        try {
          if (!ocrWorkerInstance) {
            const cachePath = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) ? '/tmp' : undefined;
            ocrWorkerInstance = await createWorker('eng', 1, {
              langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
              cachePath,
            });
          }
          const scale = 2.5;
          const { buf: bmpBuf } = createBmpBufferDownsampled(largeImgObj.width, largeImgObj.height, largeImgObj.data, scale);
          const ocrPromise = ocrWorkerInstance.recognize(bmpBuf, {}, { text: true, blocks: true });
          const maxTimeoutMs = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) ? 3500 : 60000;
          const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout on serverless')), maxTimeoutMs));
          const ret = await Promise.race([ocrPromise, timeoutPromise]);

          const scaleX = imgTransform ? imgTransform[0] : page.view[2];
          const scaleY = imgTransform ? imgTransform[3] : page.view[3];
          const transX = imgTransform ? imgTransform[4] : 0;
          const transY = imgTransform ? imgTransform[5] : 0;

          const pageLines = [];
          ret?.data?.blocks?.forEach((b) => {
            b.paragraphs?.forEach((p) => {
              p.lines?.forEach((l) => {
                const lineText = l.text.trim();
                if (!lineText) return;

                const x0 = l.bbox.x0 * scale;
                const y0 = l.bbox.y0 * scale;
                const x1 = l.bbox.x1 * scale;
                const y1 = l.bbox.y1 * scale;

                const pdfX = Math.round(transX + (x0 / largeImgObj.width) * scaleX);
                const pdfY = Math.round(transY + ((largeImgObj.height - y1) / largeImgObj.height) * scaleY);
                const pdfW = Math.round(((x1 - x0) / largeImgObj.width) * scaleX);
                const pdfH = Math.round(((y1 - y0) / largeImgObj.height) * scaleY);

                const cx = Math.floor((x0 + x1) / 2);
                const cy = Math.floor((y0 + y1) / 2);
                const sampled = sampleColorFromImage(largeImgObj, cx, cy);
                const cat = getColorCategory(sampled);

                let taggedText = lineText;
                if (cat !== 'black') {
                  taggedText = `<font color="rgb(${sampled.join(',')})" data-cat="${cat}">${lineText}</font>`;
                }
                taggedText += ` <!-- BOX:{"x":${pdfX},"y":${pdfY},"w":${pdfW},"h":${pdfH},"page":${pageNum}} -->`;
                pageLines.push(taggedText);
              });
            });
          });

          const pageText = pageLines.join('\n').trim();
          if (pageText) {
            fullText += `<!-- PAGE ${pageNum} -->\n` + pageText + '\n\n';
          }
        } catch (ocrErr) {
          console.warn(`[PDF OCR] Page ${pageNum} OCR bypassed:`, ocrErr.message);
        }
        continue;
      }

      // 1. Gather all non-empty text items with font styling & colors
      let opCursor = 0;
      const itemObjects = [];
      for (const item of items) {
        if (!item.str && item.str !== ' ') continue;

        let isBold = false;
        let isItalic = false;
        let isUnderline = false;
        if (item.fontName && page.commonObjs.has(item.fontName)) {
          const font = page.commonObjs.get(item.fontName);
          if (font) {
            isBold = !!font.bold || (typeof font.name === 'string' && /bold|black|heavy/i.test(font.name));
            isItalic = !!font.italic || (typeof font.name === 'string' && /italic|oblique/i.test(font.name));
            isUnderline = !!font.underline || (typeof font.name === 'string' && /underline/i.test(font.name));
          }
        }
        if (item.fontName) {
          if (/bold/i.test(item.fontName)) isBold = true;
          if (/italic|oblique/i.test(item.fontName)) isItalic = true;
          if (/underline/i.test(item.fontName)) isUnderline = true;
        }

        const s = (item.str || '').trim();
        let matchedColor = [0, 0, 0];
        if (s.length > 0 && textOps.length > 0) {
          let matchedOpIdx = -1;
          // 1. Exact match near opCursor
          for (let k = opCursor; k < Math.min(textOps.length, opCursor + 8); k++) {
            if (textOps[k].str === s) {
              matchedOpIdx = k;
              break;
            }
          }
          // 2. Exact match anywhere ahead of opCursor
          if (matchedOpIdx === -1) {
            for (let k = opCursor; k < textOps.length; k++) {
              if (textOps[k].str === s) {
                matchedOpIdx = k;
                break;
              }
            }
          }
          // 3. Exact match anywhere in page
          if (matchedOpIdx === -1) {
            for (let k = 0; k < textOps.length; k++) {
              if (textOps[k].str === s) {
                matchedOpIdx = k;
                break;
              }
            }
          }
          // 4. Prefix match (where s starts with op.str or op.str starts with s)
          if (matchedOpIdx === -1) {
            for (let k = opCursor; k < Math.min(textOps.length, opCursor + 8); k++) {
              const op = textOps[k];
              if ((op.str.length >= 5 && s.startsWith(op.str)) || (s.length >= 5 && op.str.startsWith(s))) {
                matchedOpIdx = k;
                break;
              }
            }
          }
          if (matchedOpIdx === -1) {
            for (let k = 0; k < textOps.length; k++) {
              const op = textOps[k];
              if ((op.str.length >= 5 && s.startsWith(op.str)) || (s.length >= 5 && op.str.startsWith(s))) {
                matchedOpIdx = k;
                break;
              }
            }
          }
          // 5. Substring match
          if (matchedOpIdx === -1) {
            for (let k = 0; k < textOps.length; k++) {
              const op = textOps[k];
              if (op.str.includes(s) || (s.includes(op.str) && op.str.length >= s.length * 0.75)) {
                matchedOpIdx = k;
                break;
              }
            }
          }
          if (matchedOpIdx !== -1) {
            matchedColor = textOps[matchedOpIdx].color;
            opCursor = matchedOpIdx + 1;
          }
        }

        const itemX = item.transform[4];
        const itemY = item.transform[5];
        const itemW = item.width || 0;
        const matchingUnderline = underlineSegments.find(
          (u) => Math.abs(u.y - itemY) <= 4.5 && u.x1 <= itemX + 5 && u.x2 >= itemX + 10
        );
        if (matchingUnderline) {
          if (matchingUnderline.x2 >= itemX + itemW - 6) {
            isUnderline = true;
          } else if (matchingUnderline.x2 < itemX + itemW - 12) {
            const targetW = matchingUnderline.x2 - itemX;
            let splitIdx = -1;
            const matchingOp = textOps.find(
              (op) => op.str && op.str.length >= 3 && item.str.startsWith(op.str)
            );
            if (matchingOp) {
              splitIdx = matchingOp.str.length;
            } else {
              const approxIdx = Math.round(item.str.length * (targetW / (itemW || 1)));
              const searchSlice = item.str.slice(0, Math.min(item.str.length, approxIdx + 6));
              const lastPeriod = searchSlice.lastIndexOf('.');
              if (lastPeriod !== -1 && Math.abs(lastPeriod - approxIdx) < 8) {
                splitIdx = lastPeriod + 1;
              } else {
                const lastSpace = searchSlice.lastIndexOf(' ');
                splitIdx = (lastSpace !== -1 && Math.abs(lastSpace - approxIdx) < 8) ? lastSpace : approxIdx;
              }
            }
            if (splitIdx > 0 && splitIdx < item.str.length) {
              const strUnderlined = item.str.slice(0, splitIdx);
              const strRemaining = item.str.slice(splitIdx);
              itemObjects.push({
                str: strUnderlined,
                x: itemX,
                y: itemY,
                width: targetW,
                height: item.height || 10,
                isBold,
                isItalic,
                isUnderline: true,
                color: matchedColor,
                colorCategory: getColorCategory(matchedColor),
              });
              itemObjects.push({
                str: strRemaining,
                x: itemX + targetW,
                y: itemY,
                width: Math.max(0, itemW - targetW),
                height: item.height || 10,
                isBold,
                isItalic,
                isUnderline: false,
                color: matchedColor,
                colorCategory: getColorCategory(matchedColor),
              });
              continue;
            } else {
              isUnderline = true;
            }
          }
        }

        itemObjects.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0,
          height: item.height || 10,
          isBold,
          isItalic,
          isUnderline,
          color: matchedColor,
          colorCategory: getColorCategory(matchedColor),
        });
      }

      // 2. Sort items spatially: Y descending (top of page first), X ascending (left to right)
      // Items within 4pt vertically are on the same line
      itemObjects.sort((a, b) => {
        if (Math.abs(a.y - b.y) <= 4) {
          return a.x - b.x;
        }
        return b.y - a.y;
      });

      // 3. Cluster items into visual lines
      const pageLines = [];
      let currentLine = [];
      let currentBaselineY = null;
      let prevBaselineY = null;
      let avgItemHeight = 12;

      for (const item of itemObjects) {
        const y = item.y;
        const height = item.height || 12;
        avgItemHeight = height;
        const threshold = Math.max(4, Math.min(6, height * 0.5));

        if (currentBaselineY === null || Math.abs(y - currentBaselineY) > threshold) {
          if (currentLine.length > 0) {
            const assembled = assembleLineItems(currentLine);
            if (assembled) {
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
          currentLine = [item];
          currentBaselineY = y;
        } else {
          currentLine.push(item);
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
        fullText += `<!-- PAGE ${pageNum} -->\n` + pageText + '\n\n';
      }
    }
  } catch (pdfjsErr) {
    console.warn('[PDF] pdfjs extraction encountered an issue, trying pdf-parse fallback:', pdfjsErr.message);
  }

  // Attempt 2: If pdfjs failed or returned no text, fall back to pure Node pdf-parse
  if (!fullText || fullText.trim().length === 0) {
    try {
      console.log('[PDF] Running robust pdf-parse engine...');
      const parseResult = await pdfParse(buffer);
      if (parseResult && parseResult.text && parseResult.text.trim().length > 0) {
        fullText = parseResult.text.trim();
        console.log(`[PDF] pdf-parse successfully extracted ${fullText.length} characters.`);
      }
    } catch (parseErr) {
      console.warn('[PDF] pdf-parse fallback error:', parseErr.message);
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

export async function extractImageText(buffer) {
  try {
    if (!ocrWorkerInstance) {
      const cachePath = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) ? '/tmp' : undefined;
      ocrWorkerInstance = await createWorker('eng', 1, {
        langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
        cachePath,
        errorHandler: (err) => console.warn('[OCR Worker Warning]:', err),
      });
    }
    const maxTimeoutMs = (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) ? 3500 : 8000;
    const ocrPromise = ocrWorkerInstance.recognize(buffer);
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('OCR timeout')), maxTimeoutMs));
    const ret = await Promise.race([ocrPromise, timeoutPromise]);
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

/**
 * Converts a .docx buffer to clean HTML suitable for rendering in the Word document viewer.
 */
export async function extractDocxHtml(buffer) {
  try {
    if (!buffer || buffer.length === 0) return '';
    const result = await mammoth.convertToHtml({ buffer });
    return result.value || '';
  } catch (err) {
    console.warn('[DOCX HTML] Extraction warning:', err.message);
    return '';
  }
}

