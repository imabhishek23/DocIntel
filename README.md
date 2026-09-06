# DocIntel — AI Smart Document Reviewer

An optimal, standalone AI document forensic reviewer and version comparison engine. Built with a clean Node.js Express backend and a modern React (Vite) frontend.

---

## ⚡ Quick Start

### 1. Run Backend and Frontend Concurrently (Recommended)
From the `smart-reviewer` folder:

```bash
cd smart-reviewer
npm run dev
```

- **Frontend (Vite dev)**: `http://localhost:3000`
- **Backend (Express)**: `http://localhost:5000`

### 2. Standalone Single-Port Mode
You can also run just the backend, which automatically serves the pre-built frontend:

```bash
cd smart-reviewer/server
npm start
```
Then open: **`http://localhost:5000`**

---

## 🚀 Key Features

1. **Single Document Deep Analysis (`/analyze`)**:
   - Upload any `.pdf`, `.docx`, `.txt`, or `.md` file (or paste text directly).
   - Zero-hallucination deterministic extraction of currency amounts, deadlines, emails, and statutory clauses.
   - Forensic risk scoring (0-100 Quality Index), executive summary, critical/high/medium/low severity breakdowns, compliance gap checklist, and obligation matrix.

2. **Two-Document Forensic Comparison (`/compare`)**:
   - Compare Document A (original baseline) against Document B (counterparty mark-up).
   - Spots shifted liabilities, deleted protections, polarity flips (*"shall"* vs *"shall not"*), numeric alterations, and produces a definitive advisory verdict (*Safe to Approve* / *Requires Negotiation* / *High Risk*).

3. **Interactive Document Q&A (`/qa`)**:
   - Chat assistant grounded in the document context and review findings.
   - Ask clarifying questions about liabilities, termination conditions, or payment schedules with direct clause citations.

4. **Fail-Safe Dual Storage**:
   - Automatically connects to MongoDB Atlas using `MONGODB_URI`.
   - If Atlas is down, unreachable, or blocked by network access, it **seamlessly and transparently falls back to local disk persistence** (`server/data/reviews.json`). The app **never** crashes or returns 503 database errors.

5. **Report Export**:
   - Export full forensic audit reports directly as Markdown or JSON.

---

## 📁 Project Structure

```
smart-reviewer/
├── package.json              # Root orchestration scripts (dev, build, start)
├── server/
│   ├── .env                  # MongoDB URI, OpenRouter API key, PORT
│   ├── index.js              # Express API & static client server
│   ├── extractors.js         # PDF, DOCX, TXT parsers
│   ├── deterministic.js      # Zero-hallucination rules engine & diff
│   ├── aiEngine.js           # Multi-model OpenRouter client + heuristic fallback
│   ├── storage.js            # MongoDB Atlas with seamless local JSON fallback
│   └── data/                 # Local fail-safe storage folder
└── client/
    ├── index.html            # Modern HTML5 shell with Inter/Outfit fonts
    ├── vite.config.js        # Vite config with /api proxy to port 5000
    ├── src/
    │   ├── App.jsx           # Main UI & view routing
    │   ├── api.js            # Frontend API client
    │   ├── index.css         # Tailwind & custom tokens
    │   └── components/
    │       ├── Navbar.jsx
    │       ├── AnalyzeView.jsx
    │       ├── CompareView.jsx
    │       ├── ResultsDisplay.jsx
    │       ├── ScoreCard.jsx
    │       ├── UploadZone.jsx
    │       ├── HistoryDrawer.jsx
    │       └── QAModal.jsx
```
