/**
 * API client for DocIntel Smart Reviewer backend.
 */

const API_BASE = '/api';

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
  } else if (text) {
    formData.append('text', text);
    if (title) formData.append('title', title);
  } else {
    throw new Error('Please select a file or paste document text.');
  }

  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Analysis failed (HTTP ${res.status})`);
  }
  return data;
}

export async function compareDocuments({ fileA, textA, nameA, fileB, textB, nameB }) {
  const formData = new FormData();

  if (fileA) {
    formData.append('documentA', fileA);
  } else if (textA) {
    formData.append('textA', textA);
    if (nameA) formData.append('nameA', nameA);
  }

  if (fileB) {
    formData.append('documentB', fileB);
  } else if (textB) {
    formData.append('textB', textB);
    if (nameB) formData.append('nameB', nameB);
  }

  const res = await fetch(`${API_BASE}/compare`, {
    method: 'POST',
    body: formData,
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `Comparison failed (HTTP ${res.status})`);
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
