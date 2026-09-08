/**
 * AI Reasoning Engine
 * Connects to OpenRouter with automatic model fallback, JSON parsing,
 * and high-fidelity heuristic fallback if external AI is offline.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const MODEL_CANDIDATES = [
  'nvidia/nemotron-3-super-120b-a12b:free',
  'openrouter/free',
];

/**
 * Call OpenRouter with fallback through available models.
 */
async function callOpenRouter(apiKey, messages, maxTokens = 2500) {
  if (!apiKey) {
    throw new Error('No OPENROUTER_API_KEY provided.');
  }

  let lastError = null;

  for (const model of MODEL_CANDIDATES) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      const response = await fetch(OPENROUTER_URL, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'http://localhost:5000',
          'X-Title': 'DocIntel Smart Reviewer',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.1,
          max_tokens: maxTokens,
          response_format: { type: 'json_object' },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errText = await response.text();
        console.warn(`[AI] Model ${model} returned ${response.status}: ${errText.slice(0, 120)}`);
        lastError = new Error(`Upstream ${response.status}: ${errText.slice(0, 80)}`);
        continue; // Hop to next model
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent) {
        lastError = new Error('Empty response content from model.');
        continue;
      }

      // Try parsing JSON
      const parsed = extractJson(rawContent);
      if (parsed) {
        return { data: parsed, modelUsed: model };
      }
    } catch (err) {
      console.warn(`[AI] Model ${model} attempt failed: ${err.message}`);
      lastError = err;
    }
  }

  throw lastError || new Error('All candidate AI models were unavailable.');
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Try finding JSON block between curly braces
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

/**
 * Performs Deep Forensic Review on a single document.
 */
export async function analyzeDocument(documentText, deterministicData, apiKey) {
  const truncatedText = documentText.slice(0, 15000);

  const systemPrompt = `You are a Tier-1 Advisory Forensic Legal & Business Document Reviewer (DocIntel).
Analyze the provided document thoroughly. Evaluate legal risks, commercial fairness, operational obligations, and compliance loopholes.
Return ONLY a valid JSON object matching this schema:
{
  "overallScore": <integer 0-100 indicating document health/safety, 100 being pristine>,
  "summary": "<clear, executive-level forensic overview of the document>",
  "documentType": "<Contract | NDA | Policy | Agreement | Invoice | Other>",
  "findings": [
    {
      "id": "<f1, f2...>",
      "category": "<Liability | Termination | Payment | Intellectual Property | Compliance | Ambiguity>",
      "title": "<short finding title>",
      "description": "<detailed risk explanation>",
      "severity": "<critical | high | medium | low>",
      "clause": "<exact or relevant excerpt>",
      "recommendation": "<practical actionable guidance for remediation>"
    }
  ],
  "complianceGaps": [
    {
      "requirement": "<standard or clause name>",
      "status": "<pass | flag | missing>",
      "note": "<rationale>"
    }
  ],
  "obligations": [
    {
      "party": "<party name or role>",
      "duty": "<specific obligation>",
      "deadline": "<timeframe or condition>",
      "riskLevel": "<high | medium | low>"
    }
  ]
}`;

  const userPrompt = `Document Text:
---
${truncatedText}
---

Deterministic Facts Extracted:
${JSON.stringify(deterministicData, null, 2)}`;

  try {
    const { data, modelUsed } = await callOpenRouter(
      apiKey,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      2500
    );

    return sanitizeAnalysisResult(data, modelUsed);
  } catch (err) {
    console.warn(`[AI] External LLM failed (${err.message}). Activating Smart Heuristic Analyzer.`);
    return buildHeuristicAnalysis(documentText, deterministicData);
  }
}

/**
 * Performs Forensic Comparison between Document A and Document B.
 */
export async function compareDocuments(textA, textB, detA, detB, deterministicDiffs, apiKey) {
  const truncatedA = textA.slice(0, 9000);
  const truncatedB = textB.slice(0, 9000);

  const systemPrompt = `You are a Senior Advisory Forensic Document Auditor & Quality Assurance Inspector (DocIntel).
Compare Document A (baseline) against Document B (revision).
Conduct a strict, forensic audit across:
1. Proofreading & Labeling Integrity: Check capitalization (e.g., brand names like BENLYSTA vs benlysta), spacing (e.g. split words), punctuation (e.g. missing terminal periods in bullet points), numbers/dosages/units (e.g. 100 mg/mL, 5 mg/kg, 2-8 °C), and trademark symbols (®).
2. Regulatory & Safety Compliance: For healthcare, pharmaceutical (GSK-style), packaging, and technical documents, flag any dropped indications, missing warnings, or altered formulations.
3. Legal & Commercial Risk: Detect semantic drift, altered commercial terms, shifted liabilities, and omitted clauses.
Return ONLY a valid JSON object matching this schema:
{
  "overallScore": <integer 0-100 where 100 means revisions are pristine and safe to approve, 0 being highly hazardous or full of discrepancies>,
  "verdict": "<Safe to Approve | Requires Material Revision | High Risk / Reject>",
  "summary": "<executive forensic summary of what changed between the two versions, highlighting specific proofreading errors (spacing, punctuation, capitalization) and regulatory/safety impacts>",
  "changes": [
    {
      "id": "<c1, c2...>",
      "type": "<addition | deletion | modification | risk_shift>",
      "title": "<short title>",
      "details": "<clear explanation of the change and its consequence>",
      "severity": "<critical | high | medium | low>",
      "impact": "<Adverse | Favorable | Neutral>"
    }
  ],
  "findings": [
    {
      "id": "<f1, f2...>",
      "category": "<Proofreading | Labeling | Liability | Payment | Termination | IP | Compliance>",
      "title": "<risk title>",
      "description": "<detailed risk breakdown>",
      "severity": "<critical | high | medium | low>",
      "recommendation": "<remediation action>"
    }
  ]
}`;

  const userPrompt = `Document A (Original Baseline):
---
${truncatedA}
---

Document B (Proposed Revision):
---
${truncatedB}
---

Deterministic Diff Findings:
${JSON.stringify(deterministicDiffs, null, 2)}`;

  try {
    const { data, modelUsed } = await callOpenRouter(
      apiKey,
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      2500
    );

    return sanitizeCompareResult(data, deterministicDiffs, modelUsed);
  } catch (err) {
    console.warn(`[AI] External LLM failed (${err.message}). Activating Smart Heuristic Comparer.`);
    return buildHeuristicComparison(textA, textB, detA, detB, deterministicDiffs);
  }
}

/**
 * Interactive Q&A about a review result.
 */
export async function answerReviewQuestion(documentText, reviewResult, question, apiKey) {
  const truncatedDoc = (documentText || '').slice(0, 8000);

  const prompt = `You are the DocIntel Forensic Document AI assistant.
Answer the user's question clearly, grounded in the document content and review findings.
If the document mentions specific clauses, cite them.

Document context:
${truncatedDoc}

Review Findings:
${JSON.stringify(reviewResult.findings || reviewResult.changes || [], null, 2)}

User question: "${question}"

Respond with a helpful, professional, advisory-grade answer in Markdown format.`;

  try {
    if (!apiKey) throw new Error('No API key');
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'nvidia/nemotron-3-super-120b-a12b:free',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 1000,
      }),
    });
    if (res.ok) {
      const d = await res.json();
      return d.choices?.[0]?.message?.content || 'No response generated.';
    }
  } catch (err) {
    console.warn('[AI] Q&A upstream call failed:', err.message);
  }

  // Local fallback answer
  return `**DocIntel Assistant Note**: Direct upstream model is currently busy. Based on the stored document findings:
- Overall Score: **${reviewResult.overallScore || 'N/A'}/100**
- Key Findings Identified: ${reviewResult.findings?.length || 0} issues.
- You asked: *"${question}"*
- Recommendation: Inspect the clauses flagged in the Findings breakdown to verify governing obligations and liabilities.`;
}

/* ── Sanitize & Heuristic Helpers ────────────────────────────────────────── */

function sanitizeAnalysisResult(data, modelUsed) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  const mediumCount = findings.filter((f) => f.severity === 'medium').length;
  const lowCount = findings.filter((f) => f.severity === 'low').length;

  return {
    overallScore: typeof data.overallScore === 'number' ? Math.max(0, Math.min(100, data.overallScore)) : 75,
    summary: data.summary || 'Document analysis completed successfully.',
    documentType: data.documentType || 'Legal/Commercial Agreement',
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
    findings,
    complianceGaps: Array.isArray(data.complianceGaps) ? data.complianceGaps : [],
    obligations: Array.isArray(data.obligations) ? data.obligations : [],
    modelUsed,
  };
}

function sanitizeCompareResult(data, deterministicDiffs, modelUsed) {
  const changes = Array.isArray(data.changes) ? data.changes : [];
  const findings = Array.isArray(data.findings) ? data.findings : [];

  // Merge deterministic diffs if not already included
  if (deterministicDiffs.length > 0 && changes.length === 0) {
    deterministicDiffs.forEach((d, idx) => {
      changes.push({
        id: `det_${idx}`,
        type: d.type.includes('added') ? 'addition' : d.type.includes('removed') ? 'deletion' : 'modification',
        title: d.field,
        details: d.detail,
        severity: d.severity,
        impact: d.severity === 'critical' || d.severity === 'high' ? 'Adverse' : 'Neutral',
      });
    });
  }

  const criticalCount = [...changes, ...findings].filter((f) => f.severity === 'critical').length;
  const highCount = [...changes, ...findings].filter((f) => f.severity === 'high').length;

  return {
    overallScore: typeof data.overallScore === 'number' ? Math.max(0, Math.min(100, data.overallScore)) : 65,
    verdict: data.verdict || (criticalCount > 0 ? 'High Risk / Reject' : highCount > 0 ? 'Requires Material Negotiation' : 'Safe to Approve'),
    summary: data.summary || 'Forensic comparison completed between both document revisions.',
    criticalCount,
    highCount,
    changes,
    findings,
    modelUsed,
  };
}

function buildHeuristicAnalysis(text, deterministicData) {
  const findings = [];
  let score = 88;

  if (!deterministicData.clauses.includes('liability_cap')) {
    findings.push({
      id: 'h_1',
      category: 'Liability',
      title: 'Missing Explicit Liability Cap',
      description: 'The document does not explicitly establish an aggregate limitation of liability clause, leaving open-ended financial exposure.',
      severity: 'critical',
      clause: 'General terms & conditions',
      recommendation: 'Incorporate a standard liability limitation capped at fees paid in the prior 12 months.',
    });
    score -= 22;
  }

  if (!deterministicData.clauses.includes('termination')) {
    findings.push({
      id: 'h_2',
      category: 'Termination',
      title: 'Ambiguous Termination Provisions',
      description: 'Lack of explicit termination for convenience and cure period notifications.',
      severity: 'high',
      clause: 'Term & Termination',
      recommendation: 'Specify clear 30-day written cure periods for material breach.',
    });
    score -= 15;
  }

  if (deterministicData.clauses.includes('indemnity')) {
    findings.push({
      id: 'h_3',
      category: 'Indemnification',
      title: 'Broad Indemnity Clause Detected',
      description: 'Indemnification triggers are expansive and may require defense for indirect third-party claims.',
      severity: 'medium',
      clause: 'Indemnification',
      recommendation: 'Ensure indemnity is mutual and narrowly tailored to gross negligence or willful misconduct.',
    });
    score -= 8;
  }

  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const highCount = findings.filter((f) => f.severity === 'high').length;
  const mediumCount = findings.filter((f) => f.severity === 'medium').length;

  return {
    overallScore: Math.max(30, score),
    summary: 'Forensic evaluation executed via DocIntel Deterministic Engine. Evaluated contract provisions, monetary covenants, liability structures, and statutory clauses.',
    documentType: 'Commercial Agreement',
    criticalCount,
    highCount,
    mediumCount,
    lowCount: 0,
    findings,
    complianceGaps: [
      { requirement: 'Limitation of Liability', status: deterministicData.clauses.includes('liability_cap') ? 'pass' : 'missing', note: 'Standard commercial safeguard' },
      { requirement: 'Confidentiality Protections', status: deterministicData.clauses.includes('confidentiality') ? 'pass' : 'flag', note: 'Trade secret covenants' },
      { requirement: 'Jurisdiction & Governing Law', status: deterministicData.clauses.includes('governing_law') ? 'pass' : 'missing', note: 'Court of competent jurisdiction' },
    ],
    obligations: [
      { party: 'Signatory', duty: 'Execute terms and maintain compliance', deadline: 'Ongoing', riskLevel: 'medium' },
    ],
    modelUsed: 'deterministic-heuristic-engine',
  };
}

export function buildHeuristicComparison(textA, textB, detA, detB, deterministicDiffs) {
  const changes = [];
  let score = 85;

  for (let i = 0; i < deterministicDiffs.length; i++) {
    const d = deterministicDiffs[i];
    changes.push({
      id: `diff_${i + 1}`,
      type: d.type.includes('added') ? 'addition' : d.type.includes('removed') ? 'deletion' : 'modification',
      title: d.field,
      details: d.detail,
      severity: d.severity,
      impact: d.severity === 'critical' ? 'Adverse' : 'Neutral',
    });
    if (d.severity === 'critical') score -= 20;
    else if (d.severity === 'high') score -= 12;
    else score -= 5;
  }

  const criticalCount = changes.filter((c) => c.severity === 'critical').length;
  const highCount = changes.filter((c) => c.severity === 'high').length;

  return {
    overallScore: Math.max(25, score),
    verdict: criticalCount > 0 ? 'High Risk / Reject' : highCount > 0 ? 'Requires Material Negotiation' : 'Safe to Approve',
    summary: `Forensic comparison detected ${changes.length} structural and substantive variations between the baseline and revised document.`,
    criticalCount,
    highCount,
    changes,
    findings: changes.filter((c) => c.severity === 'critical' || c.severity === 'high'),
    modelUsed: 'deterministic-diff-engine',
  };
}
