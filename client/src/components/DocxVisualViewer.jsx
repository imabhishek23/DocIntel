import React, { useState } from 'react';
import { FileText, Copy, Check, Search, ShieldCheck, Sparkles, BookOpen } from 'lucide-react';

export default function DocxVisualViewer({
  title = 'Approved Word Document (Master Reference)',
  badge = 'Slide A',
  subtitle = '✓ Approved Reference Standard (.docx)',
  docxHtml = '',
  text = '',
  scrollRef,
  onScroll,
  highlightClause = '',
}) {
  const [copied, setCopied] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const handleCopy = () => {
    const raw = text || (docxHtml ? docxHtml.replace(/<[^>]+>/g, ' ') : '');
    navigator.clipboard.writeText(raw);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const wordCount = (text || docxHtml).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;

  return (
    <div className="flex flex-col h-full rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-slate-200 bg-slate-50/80 px-4 py-2.5 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="rounded-md bg-emerald-600 px-2 py-0.5 text-[11px] font-black tracking-wide text-white uppercase shadow-xs flex items-center gap-1">
            <ShieldCheck className="h-3 w-3" />
            {badge}
          </span>
          <div className="min-w-0">
            <h3 className="text-xs font-bold text-slate-900 truncate flex items-center gap-1.5" title={title}>
              <FileText className="h-3.5 w-3.5 text-indigo-600 shrink-0" />
              <span className="truncate">{title}</span>
            </h3>
            <p className="text-[11px] font-semibold text-emerald-700 flex items-center gap-1">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative hidden sm:block">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
            <input
              type="text"
              placeholder="Find in document..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-6 pr-2 py-1 text-[11px] rounded-lg border border-slate-200 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-32"
            />
          </div>
          <span className="text-[11px] font-mono text-slate-500 bg-slate-200/60 px-2 py-0.5 rounded">
            {wordCount} words
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition shadow-2xs"
            title="Copy full document text"
          >
            {copied ? <Check className="h-3 w-3 text-emerald-600" /> : <Copy className="h-3 w-3" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Main Document Body (Styled Paper View) */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100/70"
        style={{ minHeight: '620px', maxHeight: '820px' }}
      >
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6 sm:p-10 shadow-sm border border-slate-200/80 prose prose-slate prose-sm max-w-none">
          {/* Document Watermark / Header Ribbon */}
          <div className="mb-6 pb-4 border-b border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span className="flex items-center gap-1.5 font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full">
              <BookOpen className="h-3.5 w-3.5 text-emerald-600" />
              Master Approved Copy (Source of Truth)
            </span>
            <span className="text-[11px] italic text-slate-400">Formatted from .docx</span>
          </div>

          {/* Render Mammoth HTML if available, otherwise formatted text */}
          {docxHtml ? (
            <div
              className="docx-rendered-content space-y-3 text-slate-800 leading-relaxed font-sans text-[13px]"
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          ) : text ? (
            <div className="space-y-3 text-slate-800 leading-relaxed font-sans text-[13px] whitespace-pre-wrap">
              {text}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-400 italic">
              No document text content available.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
