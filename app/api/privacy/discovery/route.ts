import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_URLS = 5;
const MAX_TERMS = 8;
const MAX_BYTES = 750_000;
const TIMEOUT_MS = 5_000;

function isPrivateAddress(address: string) {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::1" || value === "::" || value.startsWith("fe80:") || value.startsWith("fc") || value.startsWith("fd")) return true;
  if (value.startsWith("::ffff:")) return isPrivateAddress(value.slice(7));
  const parts = value.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

async function validatePublicUrl(raw: string) {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("One of the URLs is invalid."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only public HTTP/HTTPS pages are supported.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Private and local addresses are not allowed.");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private and local addresses are not allowed.");
  } else {
    let addresses: Array<{ address: string; family: number }>;
    try { addresses = await lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error("The URL host could not be resolved."); }
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) {
      throw new Error("The URL does not resolve exclusively to public addresses.");
    }
  }
  url.hash = "";
  return url;
}

function cleanText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

function pageTitle(html: string) {
  return cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 180) || "Untitled page";
}

async function fetchPublicPage(start: URL) {
  let current = start;
  for (let redirect = 0; redirect <= 3; redirect++) {
    current = await validatePublicUrl(current.toString());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": "TrinorinPublicFootprintScanner/0.1 (+user-initiated public-page review)", accept: "text/html,application/xhtml+xml" },
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("The page redirected too many times.");
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) throw new Error(`Page returned HTTP ${response.status}.`);
    const type = response.headers.get("content-type") ?? "";
    if (!type.toLowerCase().includes("text/html") && !type.toLowerCase().includes("application/xhtml+xml")) {
      throw new Error("The URL did not return an HTML page.");
    }
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) throw new Error("The page is larger than the scan limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("The page body was unavailable.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await reader.cancel(); throw new Error("The page is larger than the scan limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return { finalUrl: current.toString(), title: pageTitle(html), text: cleanText(html).slice(0, 100_000), status: response.status };
  }
  throw new Error("Unable to fetch page.");
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });

    const body = await request.json();
    const urls = Array.isArray(body?.urls) ? body.urls.filter((v: unknown): v is string => typeof v === "string").slice(0, MAX_URLS) : [];
    const terms = Array.isArray(body?.terms) ? body.terms.filter((v: unknown): v is string => typeof v === "string").map((v: string) => v.trim()).filter(Boolean).slice(0, MAX_TERMS) : [];
    if (!urls.length || urls.length > MAX_URLS) return NextResponse.json({ error: "Provide between 1 and 5 public page URLs." }, { status: 400 });
    if (!terms.length) return NextResponse.json({ error: "Provide at least one term to look for, such as a username, name, or phrase." }, { status: 400 });
    if (terms.some((term: string) => term.length > 100)) return NextResponse.json({ error: "Each search term must be 100 characters or fewer." }, { status: 400 });

    const results = await Promise.all(urls.map(async (raw: string) => {
      try {
        const start = await validatePublicUrl(raw);
        const page = await fetchPublicPage(start);
        const matches = terms.filter((term: string) => page.text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
        return {
          submittedUrl: start.toString(),
          finalUrl: page.finalUrl,
          title: page.title,
          httpStatus: page.status,
          matchedTerms: matches,
          matchCount: matches.length,
          evidenceExcerpt: matches.length
            ? page.text.slice(Math.max(0, page.text.toLocaleLowerCase().indexOf(matches[0].toLocaleLowerCase()) - 140), page.text.toLocaleLowerCase().indexOf(matches[0].toLocaleLowerCase()) + matches[0].length + 220)
            : null,
          confidence: matches.length ? "possible_match" : "no_match_found",
          limitation: "A text match is a lead, not proof that a page or account belongs to you.",
        };
      } catch (error) {
        return { submittedUrl: raw, error: error instanceof Error ? error.message : "Page could not be scanned." };
      }
    }));

    return NextResponse.json({
      scanType: "user_supplied_public_urls",
      pagesSubmitted: urls.length,
      pagesScanned: results.filter((item) => "finalUrl" in item).length,
      results,
      boundary: "This first scan checks only URLs you supplied. It does not search the entire web, authenticate to accounts, or remove content.",
      persistence: "Results are returned to the signed-in user and are not stored as a persistent footprint record by this endpoint.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to run the public-page scan." }, { status: 500 });
  }
}
