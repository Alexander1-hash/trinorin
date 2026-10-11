"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Globe2, Search, ShieldCheck } from "lucide-react";

type ScanResult = {
  submittedUrl: string; finalUrl?: string; title?: string; httpStatus?: number;
  matchedTerms?: string[]; matchCount?: number; confidence?: string;
  evidenceExcerpt?: string | null; error?: string; limitation?: string;
};
type WebResult = {
  title: string; url: string; description: string; age: string | null;
  source: string; matchedTerms: string[]; matchType: string; warning: string;
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
  const [busy, setBusy] = useState(false);
  const [webBusy, setWebBusy] = useState(false);

  function terms() {
    return termsText.split("\n").map((value) => value.trim()).filter(Boolean);
  }

  async function runScan(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setResults([]);
    try {
      const response = await fetch("/api/privacy/discovery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: urlsText.split("\n").map((value) => value.trim()).filter(Boolean), terms: terms() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The scan could not run.");
      setResults(data.results ?? []); setBoundary(data.boundary ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scan could not run.");
    } finally { setBusy(false); }
  }

  async function runWebSearch() {
    setWebBusy(true); setWebError(""); setWebResults([]); setWebBoundary("");
    try {
      const response = await fetch("/api/privacy/search-discovery", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ terms: terms() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Web discovery could not run.");
      setWebResults(data.results ?? []); setWebBoundary(data.boundary ?? "");
      if (data.searchErrors?.length) setWebError(data.searchErrors.map((item: {term:string;error:string}) => `${item.term}: ${item.error}`).join(" · "));
    } catch (cause) {
      setWebError(cause instanceof Error ? cause.message : "Web discovery could not run.");
    } finally { setWebBusy(false); }
  }

  return (
    <main className="min-h-screen bg-[#070b12] px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> Command Center</Link>
        <header className="mt-8 rounded-3xl border border-white/10 bg-[#0d1420] p-6 sm:p-8">
          <div className="flex items-center gap-3"><div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300"><Globe2 size={25} /></div><div><p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Trinorin · Digital Privacy</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Digital Footprint Intelligence</h1></div></div>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">Search public web results for names, usernames, or phrases that may relate to your digital footprint, then inspect pages you want to verify. Results are leads, not proof of identity.</p>
        </header>

        <section className="mt-5 rounded-3xl border border-white/10 bg-[#0d1420] p-5 sm:p-7">
          <h2 className="text-lg font-semibold">1. Discover public web results</h2>
          <p className="mt-1 text-sm text-slate-400">Enter up to five identifiers. Search runs through a configured public-web search provider.</p>
          <label className="mt-5 block"><span className="text-sm font-medium">Names, usernames, email addresses, or phrases (one per line)</span><textarea required value={termsText} onChange={(event) => setTermsText(event.target.value)} rows={4} placeholder={"your public name\ncurrent username\nold username"} className="mt-2 w-full rounded-xl border border-white/10 bg-[#080e17] p-3 text-sm outline-none focus:border-cyan-400/60" /></label>
          <button type="button" disabled={webBusy || !terms().length} onClick={runWebSearch} className="mt-4 inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"><Search size={16} />{webBusy ? "Searching public web…" : "Discover public results"}</button>
          {webError && <p role="alert" className="mt-3 rounded-xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-100">{webError}</p>}
          {webResults.length > 0 && <div className="mt-6 space-y-3" aria-live="polite"><h3 className="font-semibold">{webResults.length} unique public search results</h3>{webResults.map((item) => <article key={item.url} className="rounded-2xl border border-white/10 bg-[#080e17] p-4"><div className="flex items-start gap-3"><Globe2 size={18} className="mt-1 shrink-0 text-cyan-300" /><div className="min-w-0 flex-1"><a href={item.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-start gap-2 break-words font-medium text-cyan-200 hover:underline">{item.title}<ExternalLink size={13} className="mt-1 shrink-0" /></a><p className="mt-1 break-all text-xs text-slate-500">{item.url}</p><p className="mt-3 text-sm leading-6 text-slate-300">{item.description || "No description supplied by search provider."}</p><p className="mt-2 text-xs text-slate-500">Search term: {item.matchedTerms.join(", ")}{item.age ? ` · Page age: ${item.age}` : ""} · Unverified lead</p></div></div></article>)}</div>}
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
        <p className="mt-6 text-xs leading-5 text-slate-500">This version searches public web indexes when a search API key is configured. It does not access private accounts, guarantee discovery of every mention, or delete content. Review each result and use platform-authorized privacy or removal workflows.</p>
      </div>
    </main>
  );
}
