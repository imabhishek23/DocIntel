import React, { useState } from 'react';
import { X, Send, Bot, User, Loader2, Sparkles } from 'lucide-react';
import { askDocumentQA } from '../api';

export default function QAModal({ isOpen, onClose, review }) {
  const [question, setQuestion] = useState('');
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      text: `Hello! I am your DocIntel Forensic Assistant. Ask me anything about the legal provisions, risks, or obligations in this document.`,
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);

  const sampleQuestions = [
    'What are the most critical risks identified?',
    'Explain the termination and penalty conditions.',
    'Is there an explicit liability cap clause?',
    'What are the payment terms and late fees?',
  ];

  const handleSend = async (customQ) => {
    const q = customQ || question;
    if (!q.trim() || !review?.reviewId) return;

    const userMsg = { role: 'user', text: q };
    setMessages((prev) => [...prev, userMsg]);
    setQuestion('');
    setIsLoading(true);

    try {
      const res = await askDocumentQA(review.reviewId, q);
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: res.answer || 'No response returned.' },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', text: `Failed to get response: ${err.message}` },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm transition-opacity"
      />

      <div className="relative flex h-[620px] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h3 className="font-display text-base font-bold text-slate-900">
                Interactive Document Q&A
              </h3>
              <p className="text-xs text-slate-500 truncate max-w-sm">
                Context: {review?.title || review?.documentName || 'Document Review'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Message stream */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}
            >
              <div
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-100 text-slate-700 border border-slate-200'
                }`}
              >
                {m.role === 'user' ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4 text-indigo-600" />}
              </div>

              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-relaxed max-w-[82%] whitespace-pre-line ${
                  m.role === 'user'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-50 border border-slate-200 text-slate-800'
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-slate-400 italic pl-11">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-600" />
              <span>Analyzing document context...</span>
            </div>
          )}
        </div>

        {/* Quick suggestions */}
        <div className="border-t border-slate-100 bg-slate-50/70 px-6 py-2 flex flex-wrap gap-1.5">
          {sampleQuestions.map((sq, i) => (
            <button
              key={i}
              onClick={() => handleSend(sq)}
              className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition"
            >
              {sq}
            </button>
          ))}
        </div>

        {/* Input box */}
        <div className="border-t border-slate-200 p-4 bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask a question about this document..."
              className="flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-100"
            />
            <button
              type="submit"
              disabled={isLoading || !question.trim()}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
