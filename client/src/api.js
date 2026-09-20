/**
 * API client for DocIntel Smart Reviewer backend.
 */

const API_BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL.replace(/\/$/, '')}/api`
  : '/api';

export async function checkHealth() {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    return { status: 'error', error: err.message };
  }
}

export async function analyzeDocument({ file, text, title }) {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }
  if (text) {
    formData.append('text', text);
  }
  if (title) {
    formData.append('title', title);
  }
  if (!file && !text) {
    throw new Error('Please select a file or paste document text.');
  }

  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    body: formData,
  });

  if (res.status === 413) {
    throw new Error('Upload payload too large for serverless limit (max ~4.5MB). The document has been automatically optimized, but please try using fewer pages or a lower-resolution file.');
  }
  if (res.status === 504) {
    throw new Error('The serverless function timed out (504). Please try again with fewer pages.');
  }

  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error(`Server returned status ${res.status} (${res.statusText || 'Unknown error'})`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `Analysis failed (HTTP ${res.status})`);
  }
  return data;
}

export async function compareDocuments({ fileA, textA, nameA, fileB, textB, nameB }) {
  const formData = new FormData();

  if (fileA) {
    formData.append('documentA', fileA);
  }
  if (textA) {
    formData.append('textA', textA);
  }
  if (nameA) formData.append('nameA', nameA);

  if (fileB) {
    formData.append('documentB', fileB);
  }
  if (textB) {
    formData.append('textB', textB);
  }
  if (nameB) formData.append('nameB', nameB);

  const res = await fetch(`${API_BASE}/compare`, {
    method: 'POST',
    body: formData,
  });

  if (res.status === 413) {
    throw new Error('Upload payload too large for serverless limit (max ~4.5MB). The documents were automatically compressed, but please try using fewer pages or lower-resolution files.');
  }
  if (res.status === 504) {
    throw new Error('The serverless function timed out (504). Please try again with shorter documents.');
  }

  let data;
  try {
    data = await res.json();
  } catch (_) {
    throw new Error(`Server returned status ${res.status} (${res.statusText || 'Unknown error'})`);
  }

  if (!res.ok) {
    throw new Error(data?.error || `Comparison failed (HTTP ${res.status})`);
  }
  return data;
}

export async function fetchHistory(page = 1, limit = 20) {
  const res = await fetch(`${API_BASE}/history?page=${page}&limit=${limit}`);
  if (!res.ok) throw new Error('Failed to load history');
  return await res.json();
}

export async function fetchReview(id) {
  const res = await fetch(`${API_BASE}/history/${id}`);
  if (!res.ok) throw new Error('Failed to load review');
  return await res.json();
}

export async function clearHistory() {
  const res = await fetch(`${API_BASE}/history`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear history');
  return await res.json();
}

export async function askDocumentQA(reviewId, question) {
  const res = await fetch(`${API_BASE}/qa/${reviewId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Q&A failed');
  return data;
}

export function getExportUrl(reviewId, format = 'markdown') {
  return `${API_BASE}/export/${reviewId}?format=${format}`;
}
