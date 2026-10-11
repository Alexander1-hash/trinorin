"use client";

import { FormEvent, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Globe2, Search, ShieldCheck } from "lucide-react";

type ScanResult = {
  submittedUrl: string;
  finalUrl?: string;
  title?: string;
  httpStatus?: number;
  matchedTerms?: string[];
  matchCount?: number;
  confidence?: string;
  evidenceExcerpt?: string | null;
  error?: string;
  limitation?: string;
};

export default function FootprintPage() {
  const [urlsText, setUrlsText] = useState("");
  const [termsText, setTermsText] = useState("");
  const [results, setResults] = useState<ScanResult[]>([]);
  const [boundary, setBoundary] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function runScan(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setResults([]);
    try {
      const response = await fetch("/api/privacy/discovery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          urls: urlsText.split("\n").map((v) => v.trim()).filter(Boolean),
          terms: termsText.split("\n").map((v) => v.trim()).filter(Boolean),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "The scan could not run.");
      setResults(data.results ?? []);
      setBoundary(data.boundary ?? "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The scan could not run.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen bg-[#070b12] px-4 py-6 text-slate-100 sm:px-8">
      <div className="mx-auto max-w-4xl">
        <Link href="/" className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"><ArrowLeft size={16} /> Command Center</Link>
        <header className="mt-8 rounded-3xl border border-white/10 bg-[#0d1420] p-6 sm:p-8">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-3 text-cyan-300"><Globe2 size={25} /></div>
            <div><p className="text-xs uppercase tracking-[0.22em] text-cyan-300">Trinorin · Digital Privacy</p><h1 className="mt-1 text-2xl font-semibold sm:text-3xl">Public Footprint Scan</h1></div>
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-300">Check public pages you provide for names, usernames, email addresses, or phrases that may identify your digital footprint. Results are evidence leads, not proof of ownership.</p>
        </header>

        <form onSubmit={runScan} className="mt-5 space-y-5 rounded-3xl border border-white/10 bg-[#0d1420] p-5 sm:p-7">
          <label className="block"><span className="text-sm font-medium">Public page URLs (up to 5, one per line)</span><textarea required value={urlsText} onChange={(e) => setUrlsText(e.target.value)} rows={4} placeholder={"https://example.com/profile\nhttps://example.org/about"} className="mt-2 w-full rounded-xl border border-white/10 bg-[#080e17] p-3 text-sm outline-none focus:border-cyan-400/60" /><span className="mt-1 block text-xs text-slate-500">Only public HTTP/HTTPS HTML pages. Private/local network destinations are blocked.</span></label>
          <label className="block"><span className="text-sm font-medium">Terms to look for (one per line)</span><textarea required value={termsText} onChange={(e) => setTermsText(e.target.value)} rows={3} placeholder={"your username\nyour public name\nold email address"} className="mt-2 w-full rounded-xl border border-white/10 bg-[#080e17] p-3 text-sm outline-none focus:border-cyan-400/60" /></label>
          {error && <p role="alert" className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p>}
          <button disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-semibold text-slate-950 disabled:opacity-50"><Search size={16} />{busy ? "Scanning public pages…" : "Scan supplied pages"}</button>
        </form>

        {results.length > 0 && <section className="mt-6 space-y-3" aria-live="polite"><h2 className="text-lg font-semibold">Scan results</h2>{results.map((result, index) => <article key={result.submittedUrl + index} className="rounded-2xl border border-white/10 bg-[#0d1420] p-5">
          <div className="flex items-start gap-3"><ShieldCheck size={20} className={result.error ? "text-amber-300" : "text-cyan-300"} /><div className="min-w-0 flex-1"><h3 className="break-words font-medium">{result.title ?? result.submittedUrl}</h3><p className="mt-1 break-all text-xs text-slate-500">{result.finalUrl ?? result.submittedUrl}</p>{result.error ? <p className="mt-3 text-sm text-amber-200">{result.error}</p> : <><p className="mt-3 text-sm text-slate-300">{result.matchCount ? `Possible text match: ${result.matchedTerms?.join(", ")}` : "No supplied terms were found in the extracted page text."}</p>{result.evidenceExcerpt && <blockquote className="mt-3 rounded-xl bg-black/20 p-3 text-sm leading-6 text-slate-300">{result.evidenceExcerpt}</blockquote>}<p className="mt-2 text-xs text-slate-500">HTTP {result.httpStatus} · {result.confidence === "possible_match" ? "Possible match — manual review required" : "No match found"}</p></>}</div></div>
        </article>)}</section>}
        {boundary && <p className="mt-4 rounded-xl border border-amber-300/20 bg-amber-300/5 p-4 text-xs leading-5 text-amber-100">{boundary}</p>}
        <p className="mt-6 text-xs leading-5 text-slate-500">This initial version scans only the URLs you enter. It does not search every search engine or social network, sign into accounts, store results, or delete content. Never scan pages you are not authorized to review.</p>
      </div>
    </main>
  );
}
