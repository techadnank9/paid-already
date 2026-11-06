"use client";

import { useState } from "react";

type Appearance = {
  video: number;
  signals: string[];
  evidence: string;
  sponsored: boolean;
  shadow: boolean;
  views: number;
  timestamp: number | null;
  frameUrl: string | null;
  thumbnail?: string;
  postUrl: string;
  publishedAt: string;
};
type Brand = {
  name: string;
  category: string;
  website?: string;
  appearances: Appearance[];
  freeCount: number;
  sponsoredCount: number;
  freeViews: number;
  shadowCount: number;
  value: number;
  demand?: { sponsoredPosts: number; sampleCreators: string[] } | null;
};
type Scan = {
  creator: {
    handle: string;
    name: string;
    avatar?: string;
    followers: number;
    platform: string;
    videosScanned: number;
    videosIndexed: number;
  };
  totals: { brands: number; freeMentions: number; value: number; shadowShare: number; cpm: number };
  brands: Brand[];
};

const SIGNAL_LABEL: Record<string, string> = {
  said: "Said it",
  on_screen: "On screen",
  shown: "Shown",
  tagged: "Tagged",
  caption: "Caption",
};

const fmt = (n: number) =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${n}`;
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const ts = (s: number | null) =>
  s == null ? null : `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

const EXAMPLES = ["mikaylanogueira", "savourygirll", "sid.and.listen"];

export default function Home() {
  const [handle, setHandle] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(h: string) {
    const clean = h.replace(/^@/, "").trim();
    if (!clean) return;
    setHandle(clean);
    setLoading(true);
    setError(null);
    setScan(null);
    try {
      const r = await fetch(`/api/scan?handle=${encodeURIComponent(clean)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Scan failed");
      setScan(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24">
      <header className="flex items-center justify-between py-6">
        <div className="font-semibold tracking-tight">
          Paid<span className="text-money">Already</span>
        </div>
        <div className="text-xs text-muted">Video intelligence by Oriane · AI by GMI Cloud</div>
      </header>

      <section className="pt-10 pb-8">
        <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          You already promote brands for free.
          <br />
          <span className="text-money">Get paid for it.</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg text-muted">
          We watch your videos the way a brand would: every product you say, show, or put on
          screen. Then we tell you what that exposure was worth and who is already paying creators
          like you.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(handle);
          }}
          className="mt-8 flex max-w-xl gap-2"
        >
          <div className="flex flex-1 items-center rounded-xl border border-line bg-card px-4 focus-within:border-money">
            <span className="text-muted">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="your TikTok or Instagram handle"
              className="w-full bg-transparent px-1 py-3.5 outline-none placeholder:text-muted/60"
            />
          </div>
          <button
            disabled={loading}
            className="rounded-xl bg-money px-6 font-medium text-black transition active:scale-[0.97] disabled:opacity-60"
          >
            {loading ? "Watching…" : "Scan my videos"}
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-2 text-sm text-muted">
          Try:
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => run(e)} className="underline-offset-4 hover:text-foreground hover:underline">
              @{e}
            </button>
          ))}
        </div>
      </section>

      {loading && <Loading handle={handle} />}
      {error && <p className="rounded-xl border border-red-900/60 bg-red-950/30 p-4 text-red-300">{error}</p>}
      {scan && <Results scan={scan} />}
    </main>
  );
}

function Loading({ handle }: { handle: string }) {
  return (
    <div className="rounded-2xl border border-line bg-card p-8">
      <div className="flex items-center gap-3">
        <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-money" />
        <span>Watching @{handle}&apos;s recent videos…</span>
      </div>
      <ul className="mt-4 space-y-1.5 text-sm text-muted">
        <li>Reading transcripts and on-screen text frame by frame</li>
        <li>Spotting every brand you said, showed, or tagged</li>
        <li>Checking which of those brands pay creators right now</li>
      </ul>
    </div>
  );
}

function Results({ scan }: { scan: Scan }) {
  const { creator, totals, brands } = scan;
  return (
    <section className="space-y-6">
      <div className="rounded-2xl border border-line bg-card p-6 sm:p-8">
        <div className="flex items-center gap-3 text-sm text-muted">
          {creator.avatar && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={creator.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
          )}
          <div>
            <div className="text-foreground">{creator.name}</div>
            <div>
              @{creator.handle} · {fmt(creator.followers)} followers · {creator.videosScanned} videos watched
            </div>
          </div>
        </div>
        <div className="mt-6 text-lg text-muted">You gave away</div>
        <div className="text-5xl font-semibold tracking-tight text-money sm:text-7xl">{money(totals.value)}</div>
        <div className="mt-2 text-lg text-muted">
          of free promotion to <span className="text-foreground">{totals.brands} brands</span> across{" "}
          <span className="text-foreground">{totals.freeMentions} unpaid mentions</span>.
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <Stat label="Hidden exposure" value={`${totals.shadowShare}%`} note="of mentions never tagged or captioned, so brands can't see them" />
          <Stat
            label="Brands paying creators now"
            value={`${brands.filter((b) => (b.demand?.sponsoredPosts ?? 0) > 0).length}`}
            note="of your top brands ran sponsored posts in the last 90 days"
          />
          <Stat label="Valued at" value={`$${totals.cpm} CPM`} note="typical short-form creator rate per 1,000 views" />
        </div>
      </div>

      <div className="space-y-4">
        {brands.map((b) => (
          <BrandCard key={b.name} brand={b} creator={creator} />
        ))}
      </div>
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="text-xs uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      <div className="mt-1 text-sm text-muted">{note}</div>
    </div>
  );
}

function BrandCard({ brand, creator }: { brand: Brand; creator: Scan["creator"] }) {
  const [pitch, setPitch] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const paying = (brand.demand?.sponsoredPosts ?? 0) > 0;

  async function writePitch() {
    setBusy(true);
    try {
      const r = await fetch("/api/pitch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creator: { handle: creator.handle, name: creator.name, followers: creator.followers, platform: creator.platform },
          brand: {
            name: brand.name,
            unpaidMentions: brand.freeCount,
            unpaidViews: brand.freeViews,
            estimatedValueUsd: brand.value,
            moments: brand.appearances.slice(0, 3).map((a) => ({ quote: a.evidence, how: a.signals, views: a.views })),
            alreadyPaysCreators: brand.demand,
          },
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setPitch(j);
    } catch (e) {
      setPitch({ subject: "Couldn't write the pitch", body: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-line bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-2xl font-semibold tracking-tight">{brand.name}</h3>
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{brand.category}</span>
          </div>
          <div className="mt-1 text-sm text-muted">
            {brand.freeCount} unpaid mention{brand.freeCount === 1 ? "" : "s"} · {fmt(brand.freeViews)} views
            {brand.shadowCount > 0 && ` · ${brand.shadowCount} never tagged`}
            {brand.sponsoredCount > 0 && ` · ${brand.sponsoredCount} already sponsored`}
          </div>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold text-money">{money(brand.value)}</div>
          <div className="text-xs text-muted">free exposure you gave</div>
        </div>
      </div>

      {brand.demand && (
        <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${paying ? "bg-money/10 text-money" : "bg-white/5 text-muted"}`}>
          {paying
            ? `${brand.name} has ${brand.demand.sponsoredPosts} sponsored posts in the last 90 days${
                brand.demand.sampleCreators.length ? `, with creators like @${brand.demand.sampleCreators.slice(0, 3).join(", @")}` : ""
              }. They pay creators.`
            : `No sponsored posts found for ${brand.name} recently. You could be their first.`}
        </div>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {brand.appearances.slice(0, 3).map((a, i) => (
          <a
            key={i}
            href={a.postUrl}
            target="_blank"
            rel="noreferrer"
            className="group flex gap-3 rounded-xl border border-line p-2.5 transition hover:border-muted"
          >
            {(a.frameUrl ?? a.thumbnail) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.frameUrl ?? a.thumbnail} alt="" className="h-24 w-16 shrink-0 rounded-md object-cover" />
            )}
            <div className="min-w-0 text-sm">
              <div className="flex flex-wrap gap-1">
                {a.signals.map((s) => (
                  <span key={s} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-muted">
                    {SIGNAL_LABEL[s] ?? s}
                  </span>
                ))}
                {ts(a.timestamp) && <span className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-muted">at {ts(a.timestamp)}</span>}
              </div>
              <p className="mt-1.5 line-clamp-3 text-foreground/90">&ldquo;{a.evidence}&rdquo;</p>
              <div className="mt-1 text-xs text-muted">
                {fmt(a.views)} views{a.sponsored ? " · sponsored" : ""}
              </div>
            </div>
          </a>
        ))}
      </div>

      <div className="mt-4">
        {!pitch ? (
          <button
            onClick={writePitch}
            disabled={busy}
            className="rounded-lg border border-line px-4 py-2 text-sm transition hover:border-money hover:text-money active:scale-[0.97] disabled:opacity-60"
          >
            {busy ? "Writing…" : `Write my pitch to ${brand.name}`}
          </button>
        ) : (
          <div className="rounded-xl border border-line bg-black/30 p-4">
            <div className="text-sm text-muted">Subject</div>
            <div className="font-medium">{pitch.subject}</div>
            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{pitch.body}</p>
            <button
              onClick={() => {
                navigator.clipboard.writeText(`Subject: ${pitch.subject}\n\n${pitch.body}`);
                setCopied(true);
              }}
              className="mt-3 rounded-lg bg-money px-4 py-2 text-sm font-medium text-black active:scale-[0.97]"
            >
              {copied ? "Copied" : "Copy email"}
            </button>
          </div>
        )}
      </div>
    </article>
  );
}
