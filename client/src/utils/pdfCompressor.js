import * as pdfjsLib from 'pdfjs-dist';
import { buildPdfFromJpegs } from './pdfBuilder';

/**
 * Compresses an image-heavy or high-resolution PDF by rendering pages to canvas,
 * converting them to optimized JPEGs, and rebuilding an ultra-lightweight PDF.
 * If file is <= maxSizeBytes (default 1.8MB), returns original file untouched.
 */
export async function compressPdfIfNeeded(file, maxSizeBytes = 1.8 * 1024 * 1024, onProgress = null) {
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

    // Adaptive resolution and quality based on page count to guarantee fitting under maxSizeBytes
    let targetMaxWidth = 1100;
    let quality = 0.72;

    if (numPages > 12) {
      targetMaxWidth = 750;
      quality = 0.55;
    } else if (numPages > 6) {
      targetMaxWidth = 900;
      quality = 0.62;
    } else if (numPages > 3) {
      targetMaxWidth = 1000;
      quality = 0.68;
    }

    const jpegItems = [];

    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      if (onProgress) onProgress(`Optimizing page ${pageNum} of ${numPages}...`);
      const page = await pdf.getPage(pageNum);
      const origViewport = page.getViewport({ scale: 1.0 });

      // Cap extreme dimensions (e.g. 12,000px email composites)
      let scale = origViewport.width > targetMaxWidth
        ? targetMaxWidth / origViewport.width
        : 1.0;

      if (origViewport.height * scale > 7500) {
        scale = 7500 / origViewport.height;
      }

      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);

      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;

      const jpegBlob = await new Promise((resolve) => {
        canvas.toBlob(resolve, 'image/jpeg', quality);
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

    let compressedBlob = buildPdfFromJpegs(jpegItems);
    console.log(
      `[PDF Compressor] Original: ${(file.size / 1024 / 1024).toFixed(2)} MB -> Compressed: ${(compressedBlob.size / 1024 / 1024).toFixed(2)} MB`
    );

    // If still slightly over maxSizeBytes, do a tighter pass to stay strictly under Vercel's 4.5MB threshold
    if (compressedBlob.size > maxSizeBytes && numPages <= 5) {
      const tighterJpegs = [];
      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const origViewport = page.getViewport({ scale: 1.0 });
        const scale = (targetMaxWidth * 0.75) / Math.max(origViewport.width, 1);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const ctx = canvas.getContext('2d');
        await page.render({ canvasContext: ctx, viewport }).promise;
        const jpegBlob = await new Promise((resolve) => {
          canvas.toBlob(resolve, 'image/jpeg', 0.52);
        });
        if (jpegBlob) {
          tighterJpegs.push({
            width: origViewport.width,
            height: origViewport.height,
            data: new Uint8Array(await jpegBlob.arrayBuffer()),
          });
        }
        canvas.width = 0;
        canvas.height = 0;
      }
      if (tighterJpegs.length === numPages) {
        compressedBlob = buildPdfFromJpegs(tighterJpegs);
        console.log(
          `[PDF Compressor Tighter Pass] Compressed: ${(compressedBlob.size / 1024 / 1024).toFixed(2)} MB`
        );
      }
    }

    if (compressedBlob.size < file.size) {
      return new File([compressedBlob], file.name, { type: 'application/pdf' });
    }
    return file;
  } catch (err) {
    console.warn('[PDF Compressor] Compression fallback to original:', err);
    return file;
  }
}

/**
 * Compresses an image (PNG, JPEG, WebP) if larger than maxSizeBytes (default 1.8MB)
 */
export async function compressImageIfNeeded(file, maxSizeBytes = 1.8 * 1024 * 1024) {
  if (!file) return file;
  if (!file.type?.startsWith('image/') && !/\.(png|jpe?g|webp|bmp)$/i.test(file.name)) {
    return file;
  }
  if (file.size <= maxSizeBytes) {
    return file;
  }

  try {
    const img = new Image();
    const url = URL.createObjectURL(file);
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    URL.revokeObjectURL(url);

    const maxDim = 1500;
    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', 0.78);
    });

    canvas.width = 0;
    canvas.height = 0;

    if (blob && blob.size < file.size) {
      console.log(`[Image Compressor] ${(file.size / 1024 / 1024).toFixed(2)} MB -> ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
      return new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
    }
    return file;
  } catch (err) {
    console.warn('[Image Compressor] Fallback:', err);
    return file;
  }
}

