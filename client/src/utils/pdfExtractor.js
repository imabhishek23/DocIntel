import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.js?url';

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
 * Classifies RGB color into high-level categories
 */
function getColorCategory(color) {
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
  if ((r > 50 && b > 60 && (r + b) > g * 2.2 && Math.abs(r - b) < 80) || (r > 70 && b > 70 && g < 60)) {
    return 'purple';
  }

  // 5. Red channel dominates (crimson/red headings)
  if (r > 120 && r > g * 1.5 && r > b * 1.5) {
    return 'red';
  }

  // 6. Blue channel dominates (hyperlink blue)
  if (b > 120 && b > r * 1.3 && b > g * 1.3) {
    return 'blue';
  }

  // 7. Green dominates
  if (g > 120 && g > r * 1.3 && g > b * 1.3) {
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
      if (cur.colorCategory && cur.colorCategory !== 'black') {
        t = `<font color="rgb(${cur.color.join(',')})" data-cat="${cur.colorCategory}">${t}</font>`;
      }
      lineStr += t;
    }
  }

  return lineStr
    .replace(/<\/b>(\s*)<b>/g, '$1')
    .replace(/<\/i>(\s*)<i>/g, '$1')
    .replace(/<\/i><\/b>(\s*)<b><i>/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

/**
 * Creates a configured Tesseract worker with CDN-hosted fast language models
 * to prevent 404 errors and memory leaks in the browser.
 */
export async function createBrowserWorker(onProgress = null) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0',
    langPath: 'https://tessdata.projectnaptha.com/4.0.0_fast',
    workerBlobURL: true,
    logger: (m) => {
      if (onProgress && m.status && m.progress) {
        const pct = Math.round(m.progress * 100);
        if (pct % 25 === 0) {
          onProgress(`Scanning scanned composite... (${pct}%)`);
        }
      }
    },
    errorHandler: (err) => console.warn('[Browser OCR Warning]:', err),
  });
  return worker;
}

/**
 * Extracts structured text with font styling and colors from a PDF File in browser
 * in under 100ms for vector PDFs, and via slice-based WebAssembly OCR for image composites.
 */
export async function extractPdfTextInBrowser(file, onProgress = null) {
  if (!file) return '';
  if (file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf')) {
    return '';
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const textContent = await page.getTextContent();
      const items = textContent.items || [];

      // If page has fewer than 35 vector text items, it is an image-based/scanned page or flattened composite
      if (items.length < 35) {
        try {
          if (onProgress) onProgress(`Scanning visual content on page ${pageNum} of ${pdf.numPages}...`);
          const origViewport = page.getViewport({ scale: 1.0 });
          const targetWidth = 850;
          let scale = targetWidth / Math.max(origViewport.width, 1);
          if (origViewport.height * scale > 8000) {
            scale = 8000 / origViewport.height;
          }
          const viewport = page.getViewport({ scale });
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(viewport.width);
          canvas.height = Math.round(viewport.height);
          const ctx = canvas.getContext('2d', { willReadFrequently: true });
          await page.render({ canvasContext: ctx, viewport }).promise;

          const worker = await createBrowserWorker(onProgress);

          const scaleBackX = origViewport.width / canvas.width;
          const scaleBackY = origViewport.height / canvas.height;
          const pageLines = [];

          const totalH = canvas.height;
          if (totalH > 2000) {
            const sliceH = 1500;
            const overlap = 80;
            const numSlices = Math.ceil(totalH / (sliceH - overlap));
            let lastY1 = -999;
            let lastText = '';

            for (let sIdx = 0; sIdx < numSlices; sIdx++) {
              const startY = sIdx * (sliceH - overlap);
              const curH = Math.min(sliceH, totalH - startY);
              if (curH <= 0) break;

              if (onProgress) {
                onProgress(`Scanning page ${pageNum}: section ${sIdx + 1} of ${numSlices}...`);
              }

              const sliceCanvas = document.createElement('canvas');
              sliceCanvas.width = canvas.width;
              sliceCanvas.height = curH;
              const sCtx = sliceCanvas.getContext('2d');
              sCtx.drawImage(canvas, 0, startY, canvas.width, curH, 0, 0, canvas.width, curH);

              const ret = await worker.recognize(sliceCanvas, {}, { blocks: true, text: true });
              const rawBlocks = ret?.data?.blocks || [];

              rawBlocks.forEach((b) => {
                b.paragraphs?.forEach((p) => {
                  p.lines?.forEach((l) => {
                    const lineText = (l.text || '').trim();
                    if (!lineText) return;

                    const globalY0 = l.bbox.y0 + startY;
                    const globalY1 = l.bbox.y1 + startY;

                    if (Math.abs(globalY0 - lastY1) < 25 && lineText === lastText) {
                      return;
                    }
                    lastY1 = globalY1;
                    lastText = lineText;

                    const [pX0, pY0] = origViewport.convertToPdfPoint(l.bbox.x0 * scaleBackX, globalY0 * scaleBackY);
                    const [pX1, pY1] = origViewport.convertToPdfPoint(l.bbox.x1 * scaleBackX, globalY1 * scaleBackY);
                    const pdfX = Math.round(Math.min(pX0, pX1));
                    const pdfY = Math.round(Math.min(pY0, pY1));
                    const pdfW = Math.round(Math.abs(pX1 - pX0));
                    const pdfH = Math.round(Math.abs(pY1 - pY0));

                    // Sample font color from main canvas
                    const cx = Math.floor((l.bbox.x0 + l.bbox.x1) / 2);
                    const cy = Math.floor((globalY0 + globalY1) / 2);
                    let cat = 'black';
                    let sampled = [0, 0, 0];
                    try {
                      const p = ctx.getImageData(cx, cy, 1, 1).data;
                      sampled = [p[0], p[1], p[2]];
                      cat = getColorCategory(sampled);
                    } catch (_) {}

                    let taggedText = lineText;
                    if (cat !== 'black') {
                      taggedText = `<font color="rgb(${sampled.join(',')})" data-cat="${cat}">${lineText}</font>`;
                    }
                    taggedText += ` <!-- BOX:{"x":${pdfX},"y":${pdfY},"w":${pdfW},"h":${pdfH},"page":${pageNum}} -->`;
                    pageLines.push(taggedText);
                  });
                });
              });

              sliceCanvas.width = 0;
              sliceCanvas.height = 0;
            }
          } else {
            const ret = await worker.recognize(canvas, {}, { blocks: true, text: true });
            const rawBlocks = ret?.data?.blocks || [];

            rawBlocks.forEach((b) => {
              b.paragraphs?.forEach((p) => {
                p.lines?.forEach((l) => {
                  const lineText = (l.text || '').trim();
                  if (!lineText) return;

                  const [pX0, pY0] = origViewport.convertToPdfPoint(l.bbox.x0 * scaleBackX, l.bbox.y0 * scaleBackY);
                  const [pX1, pY1] = origViewport.convertToPdfPoint(l.bbox.x1 * scaleBackX, l.bbox.y1 * scaleBackY);
                  const pdfX = Math.round(Math.min(pX0, pX1));
                  const pdfY = Math.round(Math.min(pY0, pY1));
                  const pdfW = Math.round(Math.abs(pX1 - pX0));
                  const pdfH = Math.round(Math.abs(pY1 - pY0));

                  const cx = Math.floor((l.bbox.x0 + l.bbox.x1) / 2);
                  const cy = Math.floor((l.bbox.y0 + l.bbox.y1) / 2);
                  let cat = 'black';
                  let sampled = [0, 0, 0];
                  try {
                    const p = ctx.getImageData(cx, cy, 1, 1).data;
                    sampled = [p[0], p[1], p[2]];
                    cat = getColorCategory(sampled);
                  } catch (_) {}

                  let taggedText = lineText;
                  if (cat !== 'black') {
                    taggedText = `<font color="rgb(${sampled.join(',')})" data-cat="${cat}">${lineText}</font>`;
                  }
                  taggedText += ` <!-- BOX:{"x":${pdfX},"y":${pdfY},"w":${pdfW},"h":${pdfH},"page":${pageNum}} -->`;
                  pageLines.push(taggedText);
                });
              });
            });
          }

          await worker.terminate();
          canvas.width = 0;
          canvas.height = 0;

          const pageText = pageLines.join('\n').trim();
          if (pageText) {
            fullText += `<!-- PAGE ${pageNum} -->\n` + pageText + '\n\n';
          }
          continue;
        } catch (ocrErr) {
          console.error(`[extractPdfTextInBrowser] Page ${pageNum} OCR error:`, ocrErr);
        }
      }

      if (items.length === 0) continue;

      // Extract text show ops and colors from operator list
      let opList = null;
      try {
        opList = await page.getOperatorList();
      } catch (_) {}

      let currentFill = [0, 0, 0];
      const colorStack = [];
      const textOps = [];

      if (opList && opList.fnArray) {
        for (let i = 0; i < opList.fnArray.length; i++) {
          const fn = opList.fnArray[i];
          const args = opList.argsArray[i];
          if (fn === pdfjsLib.OPS.save) {
            colorStack.push([...currentFill]);
          } else if (fn === pdfjsLib.OPS.restore) {
            if (colorStack.length > 0) currentFill = colorStack.pop();
          } else if (fn === pdfjsLib.OPS.setFillRGBColor) {
            currentFill = [args[0], args[1], args[2]];
          } else if (fn === pdfjsLib.OPS.setFillGray) {
            currentFill = [args[0], args[0], args[0]];
          } else if (fn === pdfjsLib.OPS.showText || fn === pdfjsLib.OPS.showSpacedText) {
            const glyphs = args[0];
            let str = '';
            if (fn === pdfjsLib.OPS.showText) {
              str = Array.isArray(glyphs)
                ? glyphs.map((g) => (g && g.unicode !== undefined ? g.unicode : typeof g === 'string' ? g : '')).join('')
                : '';
            } else if (Array.isArray(glyphs)) {
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
      }

      let opCursor = 0;
      const itemObjects = [];
      for (const item of items) {
        if (!item.str && item.str !== ' ') continue;

        let isBold = false;
        let isItalic = false;
        if (item.fontName && page.commonObjs && page.commonObjs.has(item.fontName)) {
          const font = page.commonObjs.get(item.fontName);
          if (font) {
            isBold = !!font.bold || (typeof font.name === 'string' && /bold|black|heavy/i.test(font.name));
            isItalic = !!font.italic || (typeof font.name === 'string' && /italic|oblique/i.test(font.name));
          }
        }
        if (item.fontName) {
          if (/bold/i.test(item.fontName)) isBold = true;
          if (/italic|oblique/i.test(item.fontName)) isItalic = true;
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

        itemObjects.push({
          str: item.str,
          x: item.transform[4],
          y: item.transform[5],
          width: item.width || 0,
          height: item.height || 10,
          isBold,
          isItalic,
          color: matchedColor,
          colorCategory: getColorCategory(matchedColor),
        });
      }

      // Sort items spatially: Y descending, X ascending
      itemObjects.sort((a, b) => {
        if (Math.abs(a.y - b.y) <= 4) {
          return a.x - b.x;
        }
        return b.y - a.y;
      });

      // Cluster items into visual lines
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
                  pageLines.push('');
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

    return fullText.trim();
  } catch (err) {
    console.warn('[extractPdfTextInBrowser] Failed to extract text in browser:', err);
    return '';
  }
}

