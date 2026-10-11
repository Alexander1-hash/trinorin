import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 15;

type SearchItem = { title?: string; url?: string; description?: string; age?: string; page_age?: string };

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase.from("profiles").select("organization_id").eq("id", user.id).maybeSingle();
    if (!profile?.organization_id) return NextResponse.json({ error: "Your account is not connected to an organization." }, { status: 409 });

    const apiKey = process.env.BRAVE_SEARCH_API_KEY;
    if (!apiKey) return NextResponse.json({
      error: "Automated web discovery is not configured yet. Add BRAVE_SEARCH_API_KEY to the server environment to enable it.",
      code: "SEARCH_PROVIDER_NOT_CONFIGURED",
    }, { status: 503 });

    const body = await request.json();
    const terms = Array.isArray(body?.terms)
      ? [...new Set(body.terms.filter((v: unknown): v is string => typeof v === "string").map((v: string) => v.trim()).filter(Boolean))].slice(0, 5)
      : [];
    if (!terms.length) return NextResponse.json({ error: "Enter at least one name, username, or phrase to search." }, { status: 400 });
    if (terms.some((term: string) => term.length > 100)) return NextResponse.json({ error: "Each search term must be 100 characters or fewer." }, { status: 400 });

    const searches = await Promise.all(terms.map(async (term: string) => {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", term);
      url.searchParams.set("count", "8");
      url.searchParams.set("safesearch", "moderate");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7000);
      try {
        const response = await fetch(url, {
          headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
          signal: controller.signal, cache: "no-store",
        });
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) throw new Error("The search provider rejected its API key. Check BRAVE_SEARCH_API_KEY.");
          if (response.status === 429) throw new Error("The search provider rate limit was reached. Try again later.");
          throw new Error(`The search provider returned HTTP ${response.status}.`);
        }
        const data = await response.json();
        const items: SearchItem[] = Array.isArray(data?.web?.results) ? data.web.results : [];
        return { term, results: items.map((item) => ({
          title: String(item.title ?? "Untitled result").slice(0, 300),
          url: typeof item.url === "string" ? item.url : "",
          description: String(item.description ?? "").slice(0, 1200),
          age: item.page_age ?? item.age ?? null,
        })).filter((item) => {
          try { const parsed = new URL(item.url); return parsed.protocol === "https:" || parsed.protocol === "http:"; }
          catch { return false; }
        }) };
      } catch (error) {
        return { term, error: error instanceof Error ? error.message : "Search failed.", results: [] as {title:string;url:string;description:string;age:string|null}[] };
      } finally { clearTimeout(timer); }
    }));

    const unique = new Map<string, { title: string; url: string; description: string; age: string | null; matchedTerms: string[] }>();
    for (const search of searches) for (const item of search.results) {
      const existing = unique.get(item.url);
      if (existing) { if (!existing.matchedTerms.includes(search.term)) existing.matchedTerms.push(search.term); }
      else unique.set(item.url, { ...item, matchedTerms: [search.term] });
    }

    const candidates = [...unique.values()].slice(0, 30);
    let savedCount = 0;
    let persistenceWarning: string | null = null;
    if (candidates.length) {
      const rows = candidates.map((item) => ({
        organization_id: profile.organization_id,
        created_by: user.id,
        search_term: item.matchedTerms[0],
        source_url: item.url,
        page_title: item.title,
        description: item.description,
        provider: "Brave Search",
        page_age: item.age,
        review_status: "needs_review",
      }));
      const { data: saved, error: saveError } = await supabase
        .from("privacy_footprint_findings")
        .insert(rows)
        .select("id,source_url,review_status,discovered_at");
      if (saveError) {
        persistenceWarning = "Search completed, but findings were not saved. Apply the new privacy_footprint_findings migration and retry.";
      } else {
        savedCount = saved?.length ?? 0;
        const byUrl = new Map((saved ?? []).map((row) => [row.source_url, row]));
        for (const item of candidates) {
          const record = byUrl.get(item.url);
          if (record) Object.assign(item, { findingId: record.id, reviewStatus: record.review_status, discoveredAt: record.discovered_at });
        }
      }
    }

    return NextResponse.json({
      searchProvider: "Brave Search",
      termsSearched: terms,
      resultCount: candidates.length,
      savedCount,
      persistenceWarning,
      results: candidates.map((item) => ({
        ...item,
        source: "Brave Search",
        matchType: "unverified_public_search_result",
        warning: "A result is not proof of identity or ownership. Open and verify before taking action.",
      })),
      searchErrors: searches.filter((item) => item.error).map((item) => ({ term: item.term, error: item.error })),
      boundary: "Public search results are leads, not a complete scan of the internet. They can be outdated, duplicated, misleading, or unrelated. Records are saved for organization members to review. No content was changed or deleted.",
    });
  } catch {
    return NextResponse.json({ error: "Unable to run automated public-web discovery." }, { status: 500 });
  }
}
