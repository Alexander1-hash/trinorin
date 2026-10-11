"use client";

import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Globe2, Search, ShieldCheck, CheckCircle2, XCircle } from "lucide-react";

type ScanResult = {
  submittedUrl: string; finalUrl?: string; title?: string; httpStatus?: number;
  matchedTerms?: string[]; matchCount?: number; confidence?: string;
  evidenceExcerpt?: string | null; error?: string; limitation?: string;
};
type WebResult = {
  title: string; url: string; description: string; age: string | null;
  source: string; matchedTerms: string[]; matchType: string; warning: string;
  findingId?: string; reviewStatus?: string; discoveredAt?: string;
};

export default function FootprintPage() {
  const [urlsText, setUrlsText] = useState("");
  const [termsText, setTermsText] = useState("");
  const [results, setResults] = useState<ScanResult[]>([]);
  const [webResults, setWebResults] = useState<WebResult[]>([]);
  const [boundary, setBoundary] = useState("");
  const [webBoundary, setWebBoundary] = useState("");
  const [error, setError] = useState("");
  const [webError, setWebError] = useState("");
  const [persistenceWarning, setPersistenceWarning] = useState("");
  const [busy, setBusy] = useState(false);
  const [webBusy, setWebBusy] = useState(false);
  const [reviewingId, setReviewingId] = useState("");
  const [reviewError, setReviewError] = useState("");
  const [requestExplanation, setRequestExplanation] = useState("");
  const [draftFinding, setDraftFinding] = useState<WebResult | null>(null);
  const [removalDraft, setRemovalDraft] = useState("");
  const [draftNotice, setDraftNotice] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [verificationBusyId, setVerificationBusyId] = useState("");
  const [verificationResults, setVerificationResults] = useState<Record<string, { status: string; detail: string; checkedAt?: string }>>({});
  const [verificationError, setVerificationError] = useState("");

  function terms() { return termsText.split("\n").map((value) => value.trim()).filter(Boolean); }

  useEffect(() => {
    let active = true;
    fetch("/api/privacy/findings")
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load saved findings.");
        if (!active) return;
        if (data.configured && Array.isArray(data.findings)) setWebResults(data.findings);
        else if (data.message) setPersistenceWarning(data.message);
      })
      .catch(() => { if (active) setPersistenceWarning("Saved finding history could not be loaded."); });
    return () => { active = false; };
  }, []);

  async function runScan(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(""); setResults([]);
    try {
      const response = await fetch("/api/privacy/discovery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: urlsText.split("\n").map((value) => value.trim()).filter(Boolean), terms: terms() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The scan could not run.");
      setResults(data.results ?? []); setBoundary(data.boundary ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The scan could not run."); }
    finally { setBusy(false); }
  }

  async function runWebSearch() {
    setWebBusy(true); setWebError(""); setWebResults([]); setWebBoundary(""); setPersistenceWarning(""); setReviewError("");
    try {
      const response = await fetch("/api/privacy/search-discovery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: terms() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Web discovery could not run.");
      setWebResults(data.results ?? []); setWebBoundary(data.boundary ?? "");
      setPersistenceWarning(data.persistenceWarning ?? "");
      if (data.searchErrors?.length) setWebError(data.searchErrors.map((item: {term:string;error:string}) => `${item.term}: ${item.error}`).join(" · "));
    } catch (cause) { setWebError(cause instanceof Error ? cause.message : "Web discovery could not run."); }
    finally { setWebBusy(false); }
  }

  async function reviewFinding(item: WebResult, status: "confirmed_relevant" | "not_relevant" | "removal_requested") {
    if (!item.findingId) { setReviewError("This result has no saved finding ID. Apply the footprint migration and run a new search."); return; }
    setReviewingId(item.findingId); setReviewError("");
    try {
      const response = await fetch(`/api/privacy/findings/${item.findingId}/review`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save this review.");
      setWebResults((current) => current.map((entry) => entry.findingId === item.findingId ? { ...entry, reviewStatus: data.finding.review_status } : entry));
    } catch (cause) { setReviewError(cause instanceof Error ? cause.message : "Could not save this review."); }
    finally { setReviewingId(""); }
  }


  async function verifyFinding(item: WebResult) {
    if (!item.findingId) { setVerificationError("Save this finding before checking it."); return; }
    setVerificationBusyId(item.findingId); setVerificationError("");
    try {
      const response = await fetch(`/api/privacy/findings/${item.findingId}/verify`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not verify this finding.");
      if (data.check) setVerificationResults((current) => ({ ...current, [item.findingId!]: { status: data.check.verification_status, detail: data.check.detail, checkedAt: data.check.checked_at } }));
      if (data.notice) setVerificationError(data.notice);
    } catch (cause) { setVerificationError(cause instanceof Error ? cause.message : "Could not verify this finding."); }
    finally { setVerificationBusyId(""); }
  }

  async function prepareRemovalDraft() {
    if (!draftFinding?.findingId) { setDraftError("Save this finding before preparing a request."); return; }
    setDraftBusy(true); setDraftError(""); setRemovalDraft(""); setDraftNotice("");
    try {
      const response = await fetch(`/api/privacy/findings/${draftFinding.findingId}/removal-request`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ explanation: requestExplanation }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not prepare the request.");
      setRemovalDraft(data.draft ?? ""); setDraftNotice(data.notice ?? "");
    } catch (cause) { setDraftError(cause instanceof Error ? cause.message : "Could not prepare the request."); }
    finally { setDraftBusy(false); }
  }

  async function copyRemovalDraft() {
    try { await navigator.clipboard.writeText(removalDraft); setDraftNotice("Draft copied to clipboard. Nothing has been sent; use the site's official removal channel."); }
    catch { setDraftError("Clipboard access was blocked. Select and copy the draft text manually."); }
  }

  const statusLabel = (status?: string) => ({
    needs_review: "Needs review", confirmed_relevant: "Confirmed relevant by user",
    not_relevant: "Marked not relevant by user", removal_requested: "User marked request submitted",
    removed_verified: "Removal verified", removal_rejected: "Removal rejected",
  }[status ?? "needs_review"] ?? "Needs review");

  return (
    <main className="min-h-screen bg-[#070b12] px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> Command Center</Link>
        <header className="mt-8 rounded-3xl border border-white/10 bg-[#0d1420] p-6 sm:p-8">
          <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300"><Globe2 size={25} /></div><div><p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Trinorin · Digital Privacy</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Digital Footprint Intelligence</h1></div></div>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">Discover public web results, review possible matches, and retain organization-scoped findings. A name match is a lead, not proof of identity.</p>
        </header>

        <section className="mt-5 rounded-3xl border border-white/10 bg-[#0d1420] p-5 sm:p-7">
          <h2 className="text-lg font-semibold">1. Discover public web results</h2>
          <p className="mt-1 text-sm text-slate-400">Enter up to five identifiers. Findings are saved for review when the database migration is installed.</p>
          <label className="mt-5 block"><span className="text-sm font-medium">Names, usernames, email addresses, or phrases (one per line)</span><textarea required value={termsText} onChange={(event) => setTermsText(event.target.value)} rows={4} placeholder={"your public name\ncurrent username\nold username"} className="mt-2 w-full rounded-xl border border-white/10 bg-[#080e17] p-3 text-sm outline-none focus:border-cyan-400/60" /></label>
          <button type="button" disabled={webBusy || !terms().length} onClick={runWebSearch} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"><Search size={16} />{webBusy ? "Searching public web…" : "Discover public results"}</button>
          {webError && <p role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{webError}</p>}
          {persistenceWarning && <p role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{persistenceWarning}</p>}
          {reviewError && <p role="alert" className="mt-3 rounded-xl border border-red-300/20 bg-red-300/5 p-3 text-sm text-red-100">{reviewError}</p>}
          {verificationError && <p role="status" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{verificationError}</p>}
          {webResults.length > 0 && <div className="mt-6 space-y-3" aria-live="polite"><h3 className="font-semibold">{webResults.length} unique public search results</h3>{webResults.map((item) => <article key={item.url} className="rounded-2xl border border-white/10 bg-[#080e17] p-4"><div className="flex items-start gap-3"><Globe2 size={18} className="mt-1 shrink-0 text-cyan-300" /><div className="min-w-0 flex-1"><a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-2 break-words font-medium text-cyan-200 hover:underline">{item.title}<ExternalLink size={13} className="mt-1 shrink-0" /></a><p className="mt-1 break-all text-xs text-slate-500">{item.url}</p><p className="mt-3 text-sm leading-6 text-slate-300">{item.description || "No description supplied by search provider."}</p><p className="mt-2 text-xs text-slate-500">Search term: {item.matchedTerms.join(", ")}{item.age ? ` · Page age: ${item.age}` : ""}</p><p className="mt-2 inline-block rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300">{statusLabel(item.reviewStatus)}</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={!item.findingId || reviewingId === item.findingId} onClick={() => reviewFinding(item, "confirmed_relevant")} className="inline-flex items-center gap-1 rounded-lg border border-emerald-300/20 px-3 py-2 text-xs text-emerald-200 disabled:opacity-50"><CheckCircle2 size={14} /> Confirm relevant</button><button type="button" disabled={!item.findingId || reviewingId === item.findingId} onClick={() => reviewFinding(item, "not_relevant")} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 disabled:opacity-50"><XCircle size={14} /> Not relevant</button></div>
            <p className="mt-2 text-xs text-slate-500">Review status records your assessment only. It does not contact the site owner or remove content.</p><button type="button" disabled={!item.findingId || verificationBusyId === item.findingId} onClick={() => verifyFinding(item)} className="mt-3 rounded-lg border border-violet-300/20 px-3 py-2 text-xs text-violet-200 disabled:opacity-50">{verificationBusyId === item.findingId ? "Checking public page…" : "Check current public page"}</button>{verificationResults[item.findingId ?? ""] && <div className="mt-2 rounded-xl border border-violet-300/20 bg-violet-300/5 p-3"><p className="text-xs font-medium text-violet-100">Latest check: {verificationResults[item.findingId ?? ""].status.replaceAll("_", " ")}</p><p className="mt-1 text-xs leading-5 text-slate-300">{verificationResults[item.findingId ?? ""].detail}</p><p className="mt-1 text-xs text-slate-500">{verificationResults[item.findingId ?? ""].checkedAt ? new Date(verificationResults[item.findingId ?? ""].checkedAt!).toLocaleString() : "Timestamp pending"}</p></div>}
            <button type="button" disabled={!item.findingId} onClick={() => { setDraftFinding(item); setRequestExplanation(""); setRemovalDraft(""); setDraftError(""); setDraftNotice(""); }} className="mt-3 rounded-lg border border-cyan-300/20 px-3 py-2 text-xs text-cyan-200 disabled:opacity-50">Prepare removal / correction request</button></div></div></article>)}</div>}

          {draftFinding && <section className="mt-5 rounded-2xl border border-cyan-300/20 bg-[#080e17] p-4 sm:p-5">
            <h3 className="font-semibold">Prepare a removal or correction request</h3>
            <p className="mt-2 break-all text-xs text-slate-400">{draftFinding.url}</p>
            <p className="mt-2 text-sm text-slate-300">Explain the issue truthfully. This creates a draft for you to review; it does not submit a request or confirm you own the content.</p>
            <label className="mt-4 block"><span className="text-sm">Reason for requesting review</span><textarea value={requestExplanation} onChange={(event) => setRequestExplanation(event.target.value)} maxLength={1500} rows={3} placeholder="For example: this page exposes personal information that I believe should be removed..." className="mt-2 w-full rounded-xl border border-white/10 bg-[#0d1420] p-3 text-sm outline-none focus:border-cyan-400/60" /></label>
            {draftError && <p role="alert" className="mt-3 text-sm text-red-200">{draftError}</p>}
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={draftBusy || !requestExplanation.trim()} onClick={prepareRemovalDraft} className="rounded-xl bg-cyan-300 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{draftBusy ? "Preparing…" : "Generate request draft"}</button><button type="button" onClick={() => setDraftFinding(null)} className="rounded-xl border border-white/10 px-4 py-2 text-sm text-slate-300">Close</button></div>
            {removalDraft && <><textarea readOnly aria-label="Generated removal request draft" value={removalDraft} rows={14} className="mt-4 w-full rounded-xl border border-white/10 bg-[#0d1420] p-3 text-sm leading-6 text-slate-200" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={copyRemovalDraft} className="rounded-xl border border-cyan-300/20 px-4 py-2 text-sm text-cyan-200">Copy draft</button><button type="button" disabled={reviewingId === draftFinding.findingId || draftFinding.reviewStatus === "removal_requested"} onClick={() => reviewFinding(draftFinding, "removal_requested")} className="rounded-xl border border-emerald-300/20 px-4 py-2 text-sm text-emerald-200 disabled:opacity-50">I submitted this request</button></div></>}
            {draftNotice && <p className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-xs leading-5 text-amber-100">{draftNotice}</p>}
          </section>}

          {webBoundary && <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs leading-5 text-amber-100">{webBoundary}</p>}
        </section>

        <form onSubmit={runScan} className="mt-5 space-y-5 rounded-3xl border border-white/10 bg-[#0d1420] p-5 sm:p-7">
          <h2 className="text-lg font-semibold">2. Check specific public pages</h2>
          <label className="block"><span className="text-sm font-medium">Public page URLs (up to 5, one per line)</span><textarea required value={urlsText} onChange={(event) => setUrlsText(event.target.value)} rows={3} placeholder={"https://example.com/profile\nhttps://example.org/about"} className="mt-2 w-full rounded-xl border border-white/10 bg-[#080e17] p-3 text-sm outline-none focus:border-cyan-400/60" /><span className="mt-1 block text-xs text-slate-500">Only public HTTP/HTTPS HTML pages. Private/local network destinations are blocked.</span></label>
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          <button disabled={busy || !urlsText.trim() || !terms().length} className="inline-flex items-center gap-2 rounded-xl border border-cyan-300/30 px-5 py-3 text-sm font-semibold text-cyan-100 disabled:opacity-50"><ShieldCheck size={16} />{busy ? "Scanning supplied pages…" : "Scan supplied pages"}</button>
        </form>

        {results.length > 0 && <section className="mt-6 space-y-3" aria-live="polite"><h2 className="text-lg font-semibold">Page scan results</h2>{results.map((result, index) => <article key={result.submittedUrl + index} className="rounded-2xl border border-white/10 bg-[#0d1420] p-5"><div className="flex items-start gap-3"><ShieldCheck size={20} className={result.error ? "text-amber-300" : "text-cyan-300"} /><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{result.title ?? result.submittedUrl}</h3><p className="mt-1 break-all text-xs text-slate-500">{result.finalUrl ?? result.submittedUrl}</p>{result.error ? <p className="mt-3 text-sm text-amber-200">{result.error}</p> : <><p className="mt-3 text-sm text-slate-300">{result.matchCount ? `Possible text match: ${result.matchedTerms?.join(", ")}` : "No supplied terms were found in the extracted page text."}</p>{result.evidenceExcerpt && <blockquote className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-slate-300">{result.evidenceExcerpt}</blockquote>}<p className="mt-2 text-xs text-slate-500">HTTP {result.httpStatus} · {result.confidence === "possible_match" ? "Possible match — manual review required" : "No match found"}</p></>}</div></div></article>)}</section>}
        {boundary && <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs leading-5 text-amber-100">{boundary}</p>}
        <p className="mt-6 text-xs leading-5 text-slate-500">Search results are not proof of identity. This feature does not access private accounts, guarantee discovery of every mention, or delete content. Use platform-authorized privacy and removal workflows.</p>
      </div>
    </main>
  );
}
