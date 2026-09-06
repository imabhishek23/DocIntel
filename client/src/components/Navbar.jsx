import React from 'react';
import { ShieldAlert, FileSearch, GitCompare, History, CheckCircle, Database } from 'lucide-react';

export default function Navbar({ currentTab, setTab, onOpenHistory, health }) {
  const isDbOk = health?.status === 'ok';
  const isMongo = health?.mongoConnected;

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        {/* Brand */}
        <div className="flex items-center gap-3">
          <div
            onClick={() => setTab('home')}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 text-white shadow-md shadow-indigo-200 transition hover:scale-105"
          >
            <ShieldAlert className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span
                onClick={() => setTab('home')}
                className="cursor-pointer font-display text-xl font-bold tracking-tight text-slate-900 hover:text-indigo-600"
              >
                DocIntel
              </span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700 border border-indigo-200">
                AI Smart Reviewer
              </span>
            </div>
            <p className="text-[11px] text-slate-500 hidden sm:block">
              Advisory-grade forensic legal & document audit
            </p>
          </div>
        </div>

        {/* Navigation buttons */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <button
            id="nav-home"
            onClick={() => setTab('home')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              currentTab === 'home'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            Overview
          </button>

          <button
            id="nav-analyze"
            onClick={() => setTab('analyze')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              currentTab === 'analyze'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <FileSearch className="h-4 w-4" />
            Analyze
          </button>

          <button
            id="nav-compare"
            onClick={() => setTab('compare')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
              currentTab === 'compare'
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            }`}
          >
            <GitCompare className="h-4 w-4" />
            Compare
          </button>

          <div className="h-5 w-px bg-slate-200 mx-1" />

          <button
            id="nav-history"
            onClick={onOpenHistory}
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 hover:text-slate-900 transition"
          >
            <History className="h-4 w-4 text-slate-500" />
            <span className="hidden sm:inline">History</span>
          </button>

          {/* Database indicator */}
          <div
            title={
              isMongo
                ? 'Connected to MongoDB Atlas'
                : 'Operating on fail-safe local storage'
            }
            className="hidden md:flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 ml-2"
          >
            <Database className={`h-3 w-3 ${isMongo ? 'text-emerald-500' : 'text-blue-500'}`} />
            <span>{isMongo ? 'MongoDB Atlas' : 'Local Storage'}</span>
            <span className={`h-1.5 w-1.5 rounded-full ${isMongo ? 'bg-emerald-500' : 'bg-blue-500'}`} />
          </div>
        </nav>
      </div>
    </header>
  );
}
