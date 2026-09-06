import React from 'react';
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';

export default function ScoreCard({ score = 75, criticalCount = 0, highCount = 0, mediumCount = 0, lowCount = 0, verdict }) {
  // Score color tiers
  const getScoreTheme = (s) => {
    if (s >= 80) {
      return {
        text: 'text-emerald-700',
        bg: 'bg-emerald-50',
        border: 'border-emerald-200',
        ring: '#10b981',
        label: verdict || 'Low Risk / Advisory Approved',
      };
    }
    if (s >= 60) {
      return {
        text: 'text-amber-700',
        bg: 'bg-amber-50',
        border: 'border-amber-200',
        ring: '#f59e0b',
        label: verdict || 'Moderate Risk / Review Clauses',
      };
    }
    return {
      text: 'text-rose-700',
      bg: 'bg-rose-50',
      border: 'border-rose-200',
      ring: '#f43f5e',
      label: verdict || 'High Risk / Material Concerns',
    };
  };

  const theme = getScoreTheme(score);
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (score / 100) * circumference;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
        {/* Score gauge */}
        <div className="flex items-center gap-5">
          <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
            <svg className="h-full w-full -rotate-90 transform" viewBox="0 0 100 100">
              <circle
                cx="50"
                cy="50"
                r="40"
                className="stroke-slate-100"
                strokeWidth="10"
                fill="transparent"
              />
              <circle
                cx="50"
                cy="50"
                r="40"
                stroke={theme.ring}
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute flex flex-col items-center justify-center text-center">
              <span className="font-display text-2xl font-extrabold text-slate-900">{score}</span>
              <span className="text-[10px] font-semibold uppercase text-slate-400">Score</span>
            </div>
          </div>

          <div>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${theme.bg} ${theme.text} ${theme.border}`}
            >
              {theme.label}
            </span>
            <h3 className="mt-2 text-base font-bold text-slate-900">Forensic Quality Index</h3>
            <p className="text-xs text-slate-500">
              Composite index synthesized from deterministic rules and AI clause inspection.
            </p>
          </div>
        </div>

        {/* Severity counters */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <div className="rounded-xl border border-rose-100 bg-rose-50/60 p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-rose-600">
              <AlertCircle className="h-4 w-4" />
              <span className="text-xs font-semibold">Critical</span>
            </div>
            <p className="mt-1 font-display text-2xl font-bold text-rose-700">{criticalCount}</p>
          </div>

          <div className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-amber-600">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-xs font-semibold">High</span>
            </div>
            <p className="mt-1 font-display text-2xl font-bold text-amber-700">{highCount}</p>
          </div>

          <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-blue-600">
              <Info className="h-4 w-4" />
              <span className="text-xs font-semibold">Medium</span>
            </div>
            <p className="mt-1 font-display text-2xl font-bold text-blue-700">{mediumCount}</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
            <div className="flex items-center justify-center gap-1 text-slate-600">
              <CheckCircle2 className="h-4 w-4" />
              <span className="text-xs font-semibold">Low</span>
            </div>
            <p className="mt-1 font-display text-2xl font-bold text-slate-700">{lowCount}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
