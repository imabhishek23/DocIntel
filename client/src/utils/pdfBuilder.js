/**
 * Minimal standalone JPEG-to-PDF builder using standard Web APIs (Uint8Array, Blob, TextEncoder).
 * Zero external dependencies. Fully compatible with all browsers and Node.js.
 */
export function buildPdfFromJpegs(jpegItems) {
  // jpegItems: Array of { width, height, data: Uint8Array }
  const encoder = new TextEncoder();
  const chunks = [];
  let currentOffset = 0;

  function pushString(str) {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    currentOffset += bytes.length;
  }

  function pushBytes(bytes) {
    chunks.push(bytes);
    currentOffset += bytes.length;
  }

  pushString('%PDF-1.4\n');

  const offsets = [];
  let objId = 1;

  const catalogId = objId++;
  const pagesId = objId++;
  const pageSpecs = [];

  for (let i = 0; i < jpegItems.length; i++) {
    pageSpecs.push({
      pageId: objId++,
      imageId: objId++,
      contentId: objId++,
      width: Math.round(jpegItems[i].width),
      height: Math.round(jpegItems[i].height),
      data: jpegItems[i].data,
    });
  }

  // 1. Catalog
  offsets[catalogId] = currentOffset;
  pushString(`${catalogId} 0 obj\n<< /Type /Catalog /Pages ${pagesId} 0 R >>\nendobj\n`);

  // 2. Pages
  offsets[pagesId] = currentOffset;
  const kids = pageSpecs.map((p) => `${p.pageId} 0 R`).join(' ');
  pushString(`${pagesId} 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pageSpecs.length} >>\nendobj\n`);

  // 3. Page objects
  for (const p of pageSpecs) {
    // Page object
    offsets[p.pageId] = currentOffset;
    pushString(
      `${p.pageId} 0 obj\n<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${p.width} ${p.height}] /Resources << /XObject << /Im1 ${p.imageId} 0 R >> >> /Contents ${p.contentId} 0 R >>\nendobj\n`
    );

    // Image XObject with DCTDecode (standard JPEG)
    offsets[p.imageId] = currentOffset;
    pushString(
      `${p.imageId} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.data.length} >>\nstream\n`
    );
    pushBytes(p.data);
    pushString('\nendstream\nendobj\n');

    // Content stream to place the image
    const contentStr = `q ${p.width} 0 0 ${p.height} 0 0 cm /Im1 Do Q\n`;
    const contentBytes = encoder.encode(contentStr);
    offsets[p.contentId] = currentOffset;
    pushString(
      `${p.contentId} 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`
    );
    pushBytes(contentBytes);
    pushString('endstream\nendobj\n');
  }

  // Cross-reference table
  const xrefOffset = currentOffset;
  const totalObjs = objId;
  pushString(`xref\n0 ${totalObjs}\n0000000000 65535 f \n`);
  for (let i = 1; i < totalObjs; i++) {
    const off = String(offsets[i]).padStart(10, '0');
    pushString(`${off} 00000 n \n`);
  }

  // Trailer
  pushString(`trailer\n<< /Size ${totalObjs} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return new Blob(chunks, { type: 'application/pdf' });
}

