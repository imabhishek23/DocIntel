import React, { useEffect, useState } from 'react';
import { X, History, Trash2, ChevronRight, FileText, GitCompare, Loader2 } from 'lucide-react';
import { fetchHistory, fetchReview, clearHistory } from '../api';

export default function HistoryDrawer({ isOpen, onClose, onSelectReview }) {
  const [items, setItems] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [storageType, setStorageType] = useState('local_json');

  const loadHistory = async () => {
    setIsLoading(true);
    try {
      const data = await fetchHistory(1, 30);
      setItems(data.items || []);
      setStorageType(data.storage || 'local_json');
    } catch (err) {
      console.error('Failed to load history:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const handleClear = async () => {
    if (window.confirm('Are you sure you want to clear all review history?')) {
      try {
        await clearHistory();
        setItems([]);
      } catch (err) {
        alert('Failed to clear history: ' + err.message);
      }
    }
  };

  const handleItemClick = async (id) => {
    try {
      const fullReview = await fetchReview(id);
      if (fullReview) {
        onSelectReview({
          ...fullReview.result,
          reviewId: fullReview._id,
          title: fullReview.title,
          documentName: fullReview.docAName,
          docAName: fullReview.docAName,
          docBName: fullReview.docBName,
          mode: fullReview.mode,
        });
        onClose();
      }
    } catch (err) {
      alert('Failed to open review: ' + err.message);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-md bg-white shadow-2xl flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
            <div className="flex items-center gap-2">
              <History className="h-5 w-5 text-indigo-600" />
              <h2 className="font-display text-lg font-bold text-slate-900">Review History</h2>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Subtitle / Storage pill */}
          <div className="bg-slate-50 px-6 py-2.5 border-b border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <span>{items.length} total saved reviews</span>
            <span className="font-medium text-slate-700">
              Store: {storageType === 'mongodb' ? 'MongoDB Atlas' : 'Local Persistence'}
            </span>
          </div>

          {/* Content list */}
          <div className="flex-1 overflow-y-auto p-6 space-y-3">
            {isLoading ? (
              <div className="flex h-40 items-center justify-center text-slate-400">
                <Loader2 className="h-6 w-6 animate-spin text-indigo-600 mr-2" />
                <span>Loading records...</span>
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center text-slate-400">
                <FileText className="h-10 w-10 text-slate-300 mb-2" />
                <p className="text-sm font-semibold">No reviews stored yet</p>
                <p className="text-xs mt-1">Run an analysis or comparison to see it here.</p>
              </div>
            ) : (
              items.map((item) => (
                <div
                  key={item._id}
                  onClick={() => handleItemClick(item._id)}
                  className="group cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-sm hover:border-indigo-300 hover:shadow-md transition"
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                        item.mode === 'compare'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-indigo-100 text-indigo-700'
                      }`}
                    >
                      {item.mode === 'compare' ? (
                        <GitCompare className="h-3 w-3" />
                      ) : (
                        <FileText className="h-3 w-3" />
                      )}
                      {item.mode}
                    </span>
                    <span className="font-display text-sm font-bold text-slate-900">
                      Score: {item.overallScore}/100
                    </span>
                  </div>

                  <h3 className="mt-2 text-sm font-semibold text-slate-900 line-clamp-1 group-hover:text-indigo-600 transition">
                    {item.title}
                  </h3>

                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                    <div className="flex items-center gap-1 text-indigo-600 font-medium opacity-0 group-hover:opacity-100 transition">
                      <span>Open review</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Footer actions */}
          {items.length > 0 && (
            <div className="border-t border-slate-200 p-4 bg-slate-50">
              <button
                onClick={handleClear}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-xs font-semibold text-rose-600 hover:bg-rose-50 transition"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear Review History
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
