import React, { useState } from 'react';
import UploadZone from './UploadZone';
import ResultsDisplay from './ResultsDisplay';
import ErrorBoundary from './ErrorBoundary';
import { analyzeDocument } from '../api';
import { Sparkles, Loader2, AlertCircle, FileCode } from 'lucide-react';

const SAMPLE_CONTRACT = `MASTER SERVICES AGREEMENT

This Master Services Agreement ("Agreement") is made and entered into as of January 15, 2025, by and between Alpha Corp ("Customer") and Beta Solutions LLC ("Vendor").

1. SERVICES & COMPENSATION
Customer agrees to pay Vendor an aggregate fee of $150,000 within 15 days of invoice receipt. A late penalty fee of 5% per month will apply to all overdue balances.

2. TERM AND TERMINATION
This Agreement shall commence on February 1, 2025. Either party may terminate this Agreement without cause upon 60 days prior written notice. If Customer terminates for convenience, Customer shall immediately pay Vendor a cancellation charge equal to 50% of the remaining contract balance.

3. INDEMNIFICATION
Customer shall fully defend, indemnify, and hold harmless Vendor, its officers, employees, and affiliates from and against any and all claims, liabilities, losses, damages, and legal costs arising from any third-party claim, whether direct or indirect.

4. LIMITATION OF LIABILITY
VENDOR MAKES NO WARRANTIES, EXPRESS OR IMPLIED. UNDER NO CIRCUMSTANCES SHALL VENDOR'S TOTAL AGGREGATE LIABILITY EXCEED $500, REGARDLESS OF THE NATURE OF THE CLAIM. CUSTOMER WAIVES ALL CONSEQUENTIAL, INDIRECT, AND PUNITIVE DAMAGES.

5. GOVERNING LAW & JURISDICTION
This Agreement shall be governed by the laws of the State of Delaware, without regard to conflict of laws principles. Any legal action must be brought exclusively in the courts located in New Castle County, Delaware. Notice email: legal@betasolutions.io.`;

export default function AnalyzeView({ onOpenQA }) {
  const [file, setFile] = useState(null);
  const [text, setText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const stages = [
    'Extracting document content',
    'Running deterministic factual extraction',
    'AI forensic legal & risk evaluation',
    'Compiling advisory report',
  ];

  const handleStartAnalysis = async () => {
    if (!file && !text.trim()) {
      setError('Please upload a document file (PDF, DOCX, TXT) or paste text to analyze.');
      return;
    }

    setError(null);
    setIsLoading(true);
    setCurrentStage(0);

    // Simulate stage progress
    const timer1 = setTimeout(() => setCurrentStage(1), 700);
    const timer2 = setTimeout(() => setCurrentStage(2), 1600);
    const timer3 = setTimeout(() => setCurrentStage(3), 3200);

    try {
      const isPdf = file && (file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf'));
      const pdfUrl = isPdf ? URL.createObjectURL(file) : null;

      const data = await analyzeDocument({
        file,
        text: file ? null : text,
        title: file ? file.name : 'Analyzed Agreement',
      });
      setResult({
        ...data,
        file,
        pdfUrl: pdfUrl || data.pdfData,
      });
    } catch (err) {
      setError(err.message || 'Analysis could not be completed.');
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setIsLoading(false);
    }
  };

  const handleLoadSample = () => {
    setFile(null);
    setText(SAMPLE_CONTRACT);
    setError(null);
  };

  const handleReset = () => {
    setResult(null);
    setFile(null);
    setText('');
    setError(null);
  };

  if (result) {
    return (
      <ErrorBoundary onReset={handleReset} title="Analysis Result Notice">
        <ResultsDisplay
          result={result}
          mode="analyze"
          onReset={handleReset}
          onOpenQA={onOpenQA}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="space-y-6">
      {/* View header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="max-w-2xl">
          <span className="inline-block rounded-full border border-indigo-200 bg-indigo-50 px-3 py-0.5 text-xs font-semibold text-indigo-700">
            Single Document Review
          </span>
          <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-slate-900">
            Forensic Document Analysis
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Upload any contract, NDA, commercial agreement, or company policy. DocIntel extracts
            material covenants, flags adverse liabilities, checks compliance gaps, and scores
            contract health.
          </p>
        </div>
      </div>

      {/* Upload card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <UploadZone
          label="Select Document or Image to Review"
          sublabel="Upload PDF, DOCX, TXT, or Image (PNG, JPG, WEBP)"
          file={file}
          setFile={setFile}
          text={text}
          setText={setText}
          id="analyze-dropzone"
        />

        {/* Quick sample prompt */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-100">
          <button
            type="button"
            onClick={handleLoadSample}
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition"
          >
            <FileCode className="h-3.5 w-3.5" />
            Load Sample Master Services Agreement (Quick Demo)
          </button>
          <span className="text-xs text-slate-400">Zero-hallucination factual extraction</span>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-bold">Analysis Notice</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Progress Stepper during loading */}
        {isLoading && (
          <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-indigo-900">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              <span>Running DocIntel Forensic Pipeline...</span>
            </div>
            <div className="mt-4 space-y-2">
              {stages.map((stage, idx) => (
                <div key={idx} className="flex items-center gap-2.5 text-xs">
                  <div
                    className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                      idx < currentStage
                        ? 'bg-emerald-500 text-white'
                        : idx === currentStage
                        ? 'bg-indigo-600 text-white animate-pulse'
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {idx < currentStage ? '✓' : idx + 1}
                  </div>
                  <span
                    className={`${
                      idx === currentStage
                        ? 'font-bold text-indigo-900'
                        : idx < currentStage
                        ? 'text-slate-700'
                        : 'text-slate-400'
                    }`}
                  >
                    {stage}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Submit button */}
        <div className="mt-6 flex justify-end">
          <button
            id="analyze-submit-btn"
            disabled={isLoading || (!file && !text.trim())}
            onClick={handleStartAnalysis}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Analyzing Document...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Run Forensic Analysis
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
