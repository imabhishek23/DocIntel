import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import AnalyzeView from './components/AnalyzeView';
import CompareView from './components/CompareView';
import HistoryDrawer from './components/HistoryDrawer';
import QAModal from './components/QAModal';
import ResultsDisplay from './components/ResultsDisplay';
import { checkHealth } from './api';
import {
  FileSearch,
  GitCompare,
  ShieldCheck,
  Zap,
  Sparkles,
  ArrowRight,
  Database,
  Lock,
} from 'lucide-react';

export default function App() {
  const [currentTab, setCurrentTab] = useState('home');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [qaReview, setQaReview] = useState(null);
  const [loadedReview, setLoadedReview] = useState(null);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    checkHealth().then(setHealth).catch(console.error);
  }, []);

  const handleSelectReviewFromHistory = (review) => {
    const normalized = review?.result && typeof review.result === 'object'
      ? { ...review, ...review.result }
      : review;
    setLoadedReview(normalized);
    setCurrentTab(review.mode === 'compare' ? 'compare' : 'analyze');
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar
        currentTab={currentTab}
        setTab={(tab) => {
          setLoadedReview(null);
          setCurrentTab(tab);
        }}
        onOpenHistory={() => setHistoryOpen(true)}
        health={health}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* TAB: Home Overview */}
        {currentTab === 'home' && (
          <div className="space-y-12 pb-12">
            {/* Hero */}
            <section className="text-center pt-10 pb-6 max-w-3xl mx-auto">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-1.5 text-xs font-semibold text-indigo-700 shadow-sm">
                <Sparkles className="h-3.5 w-3.5 text-indigo-600" />
                Next-Generation AI Smart Document Reviewer
              </span>

              <h1 className="mt-6 font-display text-4xl sm:text-6xl font-extrabold tracking-tight text-slate-900 leading-tight">
                Review documents with <span className="text-indigo-600">forensic precision</span>.
              </h1>

              <p className="mt-5 text-base sm:text-lg leading-relaxed text-slate-600">
                DocIntel merges a zero-hallucination deterministic rules engine with an advanced AI
                reasoning layer. Deep-review contracts, identify shifted liabilities, and diff
                document versions down to a single clause alteration.
              </p>

              <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
                <button
                  id="home-start-analyze"
                  onClick={() => setCurrentTab('analyze')}
                  className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-200 hover:bg-indigo-700 hover:shadow-indigo-300 transition"
                >
                  <FileSearch className="h-4 w-4" />
                  Analyze Single Document
                </button>

                <button
                  id="home-start-compare"
                  onClick={() => setCurrentTab('compare')}
                  className="flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition"
                >
                  <GitCompare className="h-4 w-4" />
                  Compare Two Versions
                </button>
              </div>
            </section>

            {/* Feature Mode Cards */}
            <section className="grid gap-6 md:grid-cols-2">
              <div
                onClick={() => setCurrentTab('analyze')}
                className="group cursor-pointer rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:border-indigo-300 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 group-hover:scale-110 group-hover:bg-indigo-600 group-hover:text-white transition">
                  <FileSearch className="h-6 w-6" />
                </div>
                <h2 className="mt-5 font-display text-xl font-bold text-slate-900">
                  Single Document Deep Analysis
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Audit any commercial agreement, NDA, or policy. Surfaces high-risk clauses, missing
                  liability caps, aggressive indemnities, compliance gaps, and provides an advisory score.
                </p>
                <div className="mt-5 flex items-center gap-1 text-sm font-bold text-indigo-600 group-hover:translate-x-1 transition">
                  <span>Start document audit</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>

              <div
                onClick={() => setCurrentTab('compare')}
                className="group cursor-pointer rounded-3xl border border-slate-200 bg-white p-8 shadow-sm hover:border-indigo-300 hover:shadow-xl transition-all duration-300 hover:-translate-y-1"
              >
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-800 group-hover:scale-110 group-hover:bg-slate-900 group-hover:text-white transition">
                  <GitCompare className="h-6 w-6" />
                </div>
                <h2 className="mt-5 font-display text-xl font-bold text-slate-900">
                  Forensic Document Comparison
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Diff two document drafts with redline analysis. Detects added or removed clauses,
                  polarity inversions ("shall" vs "shall not"), numeric alterations, and risk changes.
                </p>
                <div className="mt-5 flex items-center gap-1 text-sm font-bold text-slate-800 group-hover:translate-x-1 transition">
                  <span>Start comparative review</span>
                  <ArrowRight className="h-4 w-4" />
                </div>
              </div>
            </section>

            {/* Architecture Highlights */}
            <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
              <div className="border-b border-slate-100 pb-4">
                <span className="text-xs font-bold uppercase tracking-wider text-indigo-600">
                  Engine Architecture
                </span>
                <h3 className="mt-1 font-display text-xl font-bold text-slate-900">
                  Dual-Engine Verification & Resilient Persistence
                </h3>
              </div>

              <div className="mt-6 grid gap-6 sm:grid-cols-3">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm">
                    <Zap className="h-4 w-4" />
                    <span>01. Deterministic Extraction</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Zero-hallucination regex engine extracts factual figures, monetary caps,
                    deadlines, emails, and statutory clauses directly from the text.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm">
                    <ShieldCheck className="h-4 w-4" />
                    <span>02. Multi-Model AI Layer</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Evaluates commercial reasonableness, legal liabilities, risk exposure, and
                    adverse clauses with auto-fallback and heuristic safety nets.
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm">
                    <Database className="h-4 w-4" />
                    <span>03. Fail-Safe Storage</span>
                  </div>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    Stores reviews in MongoDB Atlas when online, with automatic local persistence
                    fallback so reviews are never lost and the app never crashes.
                  </p>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB: Analyze */}
        {currentTab === 'analyze' && (
          loadedReview ? (
            <ResultsDisplay
              result={loadedReview}
              mode={loadedReview.mode || 'analyze'}
              onReset={() => setLoadedReview(null)}
              onOpenQA={(r) => setQaReview(r)}
            />
          ) : (
            <AnalyzeView onOpenQA={(r) => setQaReview(r)} />
          )
        )}

        {/* TAB: Compare */}
        {currentTab === 'compare' && (
          loadedReview ? (
            <ResultsDisplay
              result={loadedReview}
              mode={loadedReview.mode || 'compare'}
              onReset={() => setLoadedReview(null)}
              onOpenQA={(r) => setQaReview(r)}
            />
          ) : (
            <CompareView onOpenQA={(r) => setQaReview(r)} />
          )
        )}
      </main>

      {/* History Slide-out Drawer */}
      <HistoryDrawer
        isOpen={historyOpen}
        onClose={() => setHistoryOpen(false)}
        onSelectReview={handleSelectReviewFromHistory}
      />

      {/* Interactive Q&A Modal */}
      {qaReview && (
        <QAModal
          isOpen={!!qaReview}
          onClose={() => setQaReview(null)}
          review={qaReview}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-3">
          <p>© {new Date().getFullYear()} DocIntel AI Smart Reviewer. Advisory & Forensic Document Intelligence.</p>
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <Lock className="h-3 w-3 text-slate-400" />
              In-memory buffer extraction
            </span>
            <span>•</span>
            <span>Fail-safe persistence</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
