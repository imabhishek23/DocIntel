import * as pdfjsLib from 'pdfjs-dist';
import { buildPdfFromJpegs } from './pdfBuilder';

/**
 * Compresses an image-heavy PDF by rendering pages to canvas at a target max width,
 * converting them to optimized JPEGs, and rebuilding an ultra-lightweight PDF.
 * If file is <= maxSizeBytes (default 3.2MB), returns original file untouched.
 */
export async function compressPdfIfNeeded(file, maxSizeBytes = 3.2 * 1024 * 1024, onProgress = null) {
  if (!file) return file;
  if (file.type !== 'application/pdf' && !file.name?.toLowerCase().endsWith('.pdf')) {
    return file;
  }
  if (file.size <= maxSizeBytes) {
    return file;
  }

  try {
    if (onProgress) onProgress('Optimizing large PDF for fast upload...');
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;

    const jpegItems = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onProgress) onProgress(`Optimizing page ${pageNum} of ${numPages}...`);
      const page = await pdf.getPage(pageNum);
      const origViewport = page.getViewport({ scale: 1.0 });

      // Target max width 1100px: plenty of resolution for text OCR, while keeping JPEG size tiny
      const targetMaxWidth = 1100;
      const scale = origViewport.width > targetMaxWidth
        ? targetMaxWidth / origViewport.width
        : 1.0;

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const jpegBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', 0.72);
      });

      if (!jpegBlob) {
        throw new Error(`Failed to compress page ${pageNum}`);
      }

      const jpegBuffer = new Uint8Array(await jpegBlob.arrayBuffer());
      jpegItems.push({
        width: origViewport.width,
        height: origViewport.height,
        data: jpegBuffer,
      });

      // Cleanup canvas memory
      canvas.width = 0;
      canvas.height = 0;
    }

    const compressedBlob = buildPdfFromJpegs(jpegItems);
    console.log(
      `[PDF Compressor] Original: ${(file.size / 1024 / 1024).toFixed(2)} MB -> Compressed: ${(compressedBlob.size / 1024 / 1024).toFixed(2)} MB`
    );

    if (compressedBlob.size < file.size) {
      return new File([compressedBlob], file.name, { type: 'application/pdf' });
    }
    return file;
  } catch (err) {
    console.warn('[PDF Compressor] Compression fallback to original:', err);
    return file;
  }
}
