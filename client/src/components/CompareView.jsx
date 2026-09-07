import React, { useState } from 'react';
import UploadZone from './UploadZone';
import ResultsDisplay from './ResultsDisplay';
import ErrorBoundary from './ErrorBoundary';
import { compareDocuments } from '../api';
import { GitCompare, Sparkles, Loader2, AlertCircle, FileCode } from 'lucide-react';

const SAMPLE_DOC_A = `NON-DISCLOSURE AGREEMENT (ORIGINAL DRAFT)

1. CONFIDENTIAL INFORMATION
Confidential Information refers to proprietary business data disclosed by Alpha Ltd to Beta Inc, explicitly marked as "Confidential".

2. OBLIGATIONS & TERM
The Receiving Party agrees to maintain confidentiality for a period of two (2) years from disclosure. Standard of care shall be reasonable care.

3. EXCLUSIONS
Information shall not be considered confidential if publicly known without breach, or already known to Receiving Party.

4. REMEDIES & LIABILITY
Parties acknowledge monetary damages may be inadequate. Either party may seek equitable relief. Neither party shall be liable for indirect damages.`;

const SAMPLE_DOC_B = `NON-DISCLOSURE AGREEMENT (PROPOSED REVISION)

1. CONFIDENTIAL INFORMATION
Confidential Information refers to all business, technical, financial, or strategic data disclosed by Alpha Ltd to Beta Inc, whether marked as confidential or disclosed orally.

2. OBLIGATIONS & TERM
The Receiving Party agrees to maintain confidentiality in perpetuity (forever). Standard of care shall be strict and absolute care.

3. EXCLUSIONS
Information publicly known shall only be excluded if documented by third-party certification within 10 days.

4. REMEDIES & LIABILITY
Beta Inc agrees to unconditionally indemnify Alpha Ltd for all direct and consequential damages resulting from any inadvertent breach. Limitation of liability is explicitly waived.`;

const SAMPLE_ISI_DOC_A = `CLINICAL STUDY SUMMARY & PRESCRIBING INFORMATION (APPROVED WORD MASTER)

INDICATION & USAGE
Vandaprex® is indicated for the treatment of adult patients with moderate-to-severe plaque psoriasis who are candidates for systemic therapy or phototherapy.

IMPORTANT SAFETY INFORMATION
Contraindications:
Vandaprex is contraindicated in patients with a history of serious hypersensitivity reaction to vandaprex or to any of the excipients.

Warnings and Precautions:
Infections: Serious infections, including tuberculosis (TB) and bacterial sepsis, have been reported in patients receiving Vandaprex. Evaluate patients for TB infection prior to initiating treatment.
Malignancies: Malignancies were observed in clinical studies with Vandaprex.
Hypersensitivity: If a serious allergic reaction occurs, discontinue administration immediately and initiate appropriate therapy.

Adverse Reactions:
The most common adverse reactions (incidence ≥ 1%) are upper respiratory tract infections, headache, fatigue, diarrhea, and injection site reactions.

DOSING & ADMINISTRATION
The recommended dose is 100 mg administered by subcutaneous injection at Weeks 0 and 4, followed by 100 mg every 12 weeks thereafter. Store refrigerated at 2°C to 8°C (36°F to 46°F).`;

const SAMPLE_ISI_DOC_B = `PROMOTIONAL HCP EMAIL COMPOSITE (PDF PROMOTIONAL TARGET)

Vandaprex® — Sustained Clear Skin for Your Psoriasis Patients

SELECTED IMPORTANT SAFETY INFORMATION
Vandaprex is contraindicated in patients with a history of serious hypersensitivity reaction to vandaprex or to any of the excipients.
Serious infections, including tuberculosis (TB) and bacterial sepsis, have been reported in patients receiving Vandaprex. Evaluate patients for TB infection prior to initiating treatment.
The most common adverse reactions are upper respiratory tract infections, headache, fatigue, diarrhea, and injection site reactions.

PATIENT PROFILE SNAPSHOT: CLINICAL EFFICACY AT WEEK 16
Over 82% of patients achieved PASI 90 response at Week 16 with quarterly dosing.
Recommended dose is 100 mg administered by subcutaneous injection at Weeks 0 and 4, followed by 100 mg every 12 weeks thereafter. Store refrigerated at 2°C to 8°C (36°F to 46°F).

IMPORTANT SAFETY INFORMATION (CONT’D) & PRESCRIBING INFORMATION
Indication:
Vandaprex® is indicated for the treatment of adult patients with moderate-to-severe plaque psoriasis who are candidates for systemic therapy or phototherapy.

Contraindications:
Vandaprex is contraindicated in patients with a history of serious hypersensitivity reaction to vandaprex or to any of the excipients.

Warnings and Precautions:
Infections: Serious infections, including tuberculosis (TB) and bacterial sepsis, have been reported in patients receiving Vandaprex. Evaluate patients for TB infection prior to initiating treatment.
Malignancies: Malignancies were observed in clinical studies with Vandaprex.
Hypersensitivity: If a serious allergic reaction occurs, discontinue administration immediately and initiate appropriate therapy.

Adverse Reactions:
The most common adverse reactions (incidence ≥ 1%) are upper respiratory tract infections, headache, fatigue, diarrhea, and injection site reactions.`;

export default function CompareView({ onOpenQA }) {
  const [fileA, setFileA] = useState(null);
  const [textA, setTextA] = useState('');
  const [fileB, setFileB] = useState(null);
  const [textB, setTextB] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [currentStage, setCurrentStage] = useState(0);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const stages = [
    'Extracting both documents',
    'Running deterministic diff scan',
    'Analyzing semantic changes with AI',
    'Compiling comparative findings',
  ];

  const handleStartCompare = async () => {
    const hasA = fileA || textA.trim();
    const hasB = fileB || textB.trim();

    if (!hasA || !hasB) {
      setError('Please provide both Document A (Baseline) and Document B (Revision).');
      return;
    }

    setError(null);
    setIsLoading(true);
    setCurrentStage(0);

    const timer1 = setTimeout(() => setCurrentStage(1), 700);
    const timer2 = setTimeout(() => setCurrentStage(2), 1600);
    const timer3 = setTimeout(() => setCurrentStage(3), 3200);

    try {
      const isPdfA = fileA && (fileA.type === 'application/pdf' || fileA.name?.toLowerCase().endsWith('.pdf'));
      const isPdfB = fileB && (fileB.type === 'application/pdf' || fileB.name?.toLowerCase().endsWith('.pdf'));
      const pdfUrlA = isPdfA ? URL.createObjectURL(fileA) : null;
      const pdfUrlB = isPdfB ? URL.createObjectURL(fileB) : null;

      const isImgA = fileA && (fileA.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(fileA.name));
      const isImgB = fileB && (fileB.type?.startsWith('image/') || /\.(png|jpe?g|webp|bmp)$/i.test(fileB.name));
      const imgUrlA = isImgA ? URL.createObjectURL(fileA) : null;
      const imgUrlB = isImgB ? URL.createObjectURL(fileB) : null;

      const data = await compareDocuments({
        fileA,
        textA: fileA ? null : textA,
        nameA: fileA ? fileA.name : (textA.includes('Vandaprex') ? 'Approved Word Master' : 'Original Draft (A)'),
        fileB,
        textB: fileB ? null : textB,
        nameB: fileB ? fileB.name : (textB.includes('Vandaprex') ? 'Promotional PDF Target' : 'Revised Draft (B)'),
      });

      setResult({
        ...data,
        fileA,
        fileB,
        pdfUrlA: pdfUrlA || data.pdfA,
        pdfUrlB: pdfUrlB || data.pdfB,
        imageA: imgUrlA || data.imageA,
        imageB: imgUrlB || data.imageB,
        docxHtmlA: data.docxHtmlA || null,
        docxHtmlB: data.docxHtmlB || null,
        matchingTokens: data.matchingTokens || [],
        isiAudit: data.isiAudit || null,
      });
    } catch (err) {
      setError(err.message || 'Comparison failed.');
    } finally {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
      setIsLoading(false);
    }
  };

  const handleLoadSample = () => {
    setFileA(null);
    setTextA(SAMPLE_DOC_A);
    setFileB(null);
    setTextB(SAMPLE_DOC_B);
    setError(null);
  };

  const handleLoadIsiSample = () => {
    setFileA(null);
    setTextA(SAMPLE_ISI_DOC_A);
    setFileB(null);
    setTextB(SAMPLE_ISI_DOC_B);
    setError(null);
  };

  const handleReset = () => {
    setResult(null);
    setFileA(null);
    setTextA('');
    setFileB(null);
    setTextB('');
    setError(null);
  };

  if (result) {
    return (
      <ErrorBoundary onReset={handleReset} title="Comparison Result Notice">
        <ResultsDisplay
          result={result}
          mode="compare"
          onReset={handleReset}
          onOpenQA={onOpenQA}
        />
      </ErrorBoundary>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl border border-slate-200 bg-white p-7 shadow-sm">
        <div className="max-w-2xl">
          <span className="inline-block rounded-full border border-indigo-200 bg-indigo-50 px-3 py-0.5 text-xs font-semibold text-indigo-700">
            Forensic Version & Image Diff
          </span>
          <h1 className="mt-2 font-display text-2xl sm:text-3xl font-bold text-slate-900">
            Document & Image Comparison Audit
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Compare two documents or images (PDF, DOCX, TXT, PNG, JPG). DocIntel runs OCR extraction,
            computes redline text differences, and provides an interactive visual image slider.
          </p>
        </div>
      </div>

      {/* Two upload zones */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <UploadZone
            label="Document / Image A (Original Baseline)"
            sublabel="Upload PDF, DOCX, TXT, or Image (PNG, JPG, WEBP)"
            file={fileA}
            setFile={setFileA}
            text={textA}
            setText={setTextA}
            id="compare-dropzone-a"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <UploadZone
            label="Document / Image B (Proposed Revision)"
            sublabel="Upload PDF, DOCX, TXT, or Image (PNG, JPG, WEBP)"
            file={fileB}
            setFile={setFileB}
            text={textB}
            setText={setTextB}
            id="compare-dropzone-b"
          />
        </div>
      </div>

      {/* Action card */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <button
              type="button"
              onClick={handleLoadSample}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition cursor-pointer"
            >
              <FileCode className="h-3.5 w-3.5" />
              Load Sample NDA (Quick Demo)
            </button>
            <button
              type="button"
              onClick={handleLoadIsiSample}
              className="flex items-center gap-1.5 text-xs font-bold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-lg transition cursor-pointer shadow-2xs"
            >
              <Sparkles className="h-3.5 w-3.5 text-purple-600" />
              🛡 Load Sample ISI Audit (Word Approved Master vs Promo PDF)
            </button>
          </div>

          <button
            id="compare-submit-btn"
            disabled={isLoading || (!fileA && !textA.trim()) || (!fileB && !textB.trim())}
            onClick={handleStartCompare}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-md shadow-indigo-200 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            {isLoading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Comparing Versions...
              </>
            ) : (
              <>
                <GitCompare className="h-4 w-4" />
                Run Forensic Comparison
              </>
            )}
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-800">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600 mt-0.5" />
            <div>
              <p className="font-bold">Comparison Notice</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* Progress Stepper */}
        {isLoading && (
          <div className="mt-6 rounded-xl border border-indigo-100 bg-indigo-50/50 p-5">
            <div className="flex items-center gap-2 text-sm font-bold text-indigo-900">
              <Loader2 className="h-4 w-4 animate-spin text-indigo-600" />
              <span>Analyzing differences between Document A and Document B...</span>
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
      </div>
    </div>
  );
}
