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
  if (r < 65 && g < 65 && b < 65 && Math.abs(r - g) < 25 && Math.abs(g - b) < 25) {
    return 'black';
  }
  if (r > 70 && b > 85 && (r + b) > g * 2.2) {
    return 'purple';
  }
  if (r > 120 && r > g * 1.5 && r > b * 1.5) {
    return 'red';
  }
  if (b > 120 && b > r * 1.3) {
    return 'blue';
  }
  if (g > 120 && g > r * 1.3 && g > b * 1.3) {
    return 'green';
  }
  if (Math.abs(r - g) < 20 && Math.abs(g - b) < 20) {
    return 'gray';
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
 * Extracts structured text with font styling and colors from a PDF File in browser
 * in under 100ms, completely avoiding serverless OCR timeouts.
 */
export async function extractPdfTextInBrowser(file) {
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
          for (let k = opCursor; k < Math.min(textOps.length, opCursor + 6); k++) {
            const op = textOps[k];
            if (op.str === s || op.str.includes(s) || s.includes(op.str)) {
              matchedColor = op.color;
              matchedOpIdx = k;
              break;
            }
          }
          if (matchedOpIdx === -1) {
            for (let k = 0; k < textOps.length; k++) {
              const op = textOps[k];
              if (op.str === s || op.str.includes(s) || s.includes(op.str)) {
                matchedColor = op.color;
                matchedOpIdx = k;
                break;
              }
            }
          }
          if (matchedOpIdx !== -1) {
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

