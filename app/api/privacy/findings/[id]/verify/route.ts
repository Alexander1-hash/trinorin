import { NextResponse } from "next/server";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

const MAX_BYTES = 500_000;
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
  try { url = new URL(raw); } catch { throw new Error("Saved source URL is invalid."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only public HTTP/HTTPS pages can be checked.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) throw new Error("Private and local addresses are blocked.");
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error("Private and local addresses are blocked.");
  } else {
    let addresses: Array<{ address: string; family: number }>;
    try { addresses = await lookup(host, { all: true, verbatim: true }); }
    catch { throw new Error("Source host could not be resolved."); }
    if (!addresses.length || addresses.some((item) => isPrivateAddress(item.address))) throw new Error("Source host does not resolve exclusively to public addresses.");
  }
  url.hash = "";
  return url;
}

function cleanText(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ").trim();
}

async function inspectPublicPage(start: URL) {
  let current = start;
  for (let redirect = 0; redirect <= 3; redirect++) {
    current = await validatePublicUrl(current.toString());
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(current, {
        redirect: "manual", signal: controller.signal,
        headers: { "user-agent": "TrinorinFootprintVerifier/0.1 (+user-initiated public-page verification)", accept: "text/html,application/xhtml+xml" },
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === 3) throw new Error("Redirect chain could not be verified safely.");
      current = new URL(location, current);
      continue;
    }
    if (response.status === 404 || response.status === 410) return { status: response.status, title: "", text: "", finalUrl: current.toString(), unavailable: true };
    if (!response.ok) return { status: response.status, title: "", text: "", finalUrl: current.toString(), unavailable: false, inconclusive: true };
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (!type.includes("text/html") && !type.includes("application/xhtml+xml")) return { status: response.status, title: "", text: "", finalUrl: current.toString(), unavailable: false, inconclusive: true };
    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) throw new Error("Source page exceeds the verification size limit.");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Source page body was unavailable.");
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_BYTES) { await reader.cancel(); throw new Error("Source page exceeds the verification size limit."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    const title = cleanText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").slice(0, 180);
    return { status: response.status, title, text: cleanText(html).slice(0, 100_000), finalUrl: current.toString(), unavailable: false, inconclusive: false };
  }
  throw new Error("Source could not be checked.");
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await context.params;
    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });

    const { data: finding, error: findingError } = await supabase.from("privacy_footprint_findings")
      .select("id,source_url,search_term").eq("id", id).eq("organization_id", profile.organization_id).maybeSingle();
    if (findingError) return NextResponse.json({ error: "Verification storage is unavailable. Apply the footprint migrations." }, { status: 500 });
    if (!finding) return NextResponse.json({ error: "Finding not found in your organization." }, { status: 404 });

    let observation: { status: number; title: string; text: string; finalUrl: string; unavailable: boolean; inconclusive?: boolean };
    try { observation = await inspectPublicPage(await validatePublicUrl(finding.source_url)); }
    catch (cause) {
      const detail = cause instanceof Error ? cause.message : "The source could not be checked safely.";
      const { data: check, error } = await supabase.from("privacy_footprint_verification_checks").insert({
        organization_id: profile.organization_id, finding_id: finding.id, checked_by: user.id,
        source_url: finding.source_url, verification_status: "verification_inconclusive",
        checked_term: finding.search_term, detail,
      }).select("id,verification_status,checked_at,detail").single();
      if (error) return NextResponse.json({ error: "Could not save verification observation. Apply the verification migration." }, { status: 500 });
      return NextResponse.json({ check, notice: "Inconclusive: a failed or blocked check is not proof that content was removed." });
    }

    const containsTerm = observation.text.toLocaleLowerCase().includes(finding.search_term.toLocaleLowerCase());
    const verificationStatus = observation.unavailable ? "source_unavailable"
      : observation.inconclusive ? "verification_inconclusive"
      : containsTerm ? "content_still_detected" : "term_not_found";
    const detail = observation.unavailable
      ? "The source returned HTTP 404/410. This indicates the URL is unavailable, but does not independently prove the content was permanently removed."
      : observation.inconclusive
      ? "The source responded, but its status or content type did not allow a reliable text check."
      : containsTerm
      ? "The saved search term is still present in the fetched public page text."
      : "The saved search term was not found in the fetched public page text. Dynamic content, page changes, and indexing delays can affect this result.";
    const { data: check, error } = await supabase.from("privacy_footprint_verification_checks").insert({
      organization_id: profile.organization_id, finding_id: finding.id, checked_by: user.id,
      source_url: observation.finalUrl, http_status: observation.status,
      verification_status: verificationStatus, page_title: observation.title,
      checked_term: finding.search_term, detail,
    }).select("id,verification_status,http_status,page_title,checked_term,detail,checked_at").single();
    if (error) return NextResponse.json({ error: "Could not save verification observation. Apply the verification migration." }, { status: 500 });
    return NextResponse.json({
      check,
      notice: "This is a timestamped observation of one public-page check, not proof of identity, permanent deletion, or removal from search-engine caches. Trinorin does not automatically change the finding's removal status.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to verify this public footprint finding." }, { status: 500 });
  }
}
