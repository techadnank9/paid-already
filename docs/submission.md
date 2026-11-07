# Owed: Hack the Feed submission

## What's the project?
- A tool that watches a creator's TikTok and Instagram videos and finds every brand they already promote for free: brands they say out loud, show on screen, or put in on-screen text, often without ever tagging them.
- It puts a dollar value on that free exposure, shows which of those brands are paying other creators right now, and builds the proof: timestamped moments, highlighted frames, an auto-cut 9:16 sponsor reel, a shareable proof page, and a ready-to-send pitch email.
- Built for creators, and for talent agencies and managers who run 50+ creators and need to find deals on Monday morning.
- Live: https://owed-app.lovable.app (try @mikaylanogueira)

## What problem does it solve?
- Today, creators give brands huge free exposure and never get paid for it. Since July alone, 3,956 indexed videos literally say "not sponsored".
- Brands can't see this exposure: most of it is spoken or shown, never tagged, so social listening tools that read captions miss it.
- Creators and agencies have no proof to open a conversation, and no idea which brands actually have creator budgets.
- Example: @mikaylanogueira gave $710,910 of free promotion to 18 brands in her last 40 videos, and 71% of it was never tagged. Maybelline ran 1,211 sponsored creator posts in 90 days, but none with her, even though she praised Maybelline Superstay on camera to 2.6M viewers.

## How does it use Oriane video data?
- We use Oriane's content search with full projection to read each video like a brand would: the timestamped transcript (spoken mentions), on-screen text with per-frame bounding polygons (we draw lime boxes around the brand in the frame), frame images, captions, hashtags, mentions, audio and top comments.
- An LLM on GMI Cloud reads those signals and extracts every brand plus whether the mention was sponsored; we compute "shadow" exposure (said or shown but never tagged), the Shadow Reach idea applied to individual creators.
- We query Oriane's whole index for each brand's sponsored posts in the last 90 days (#ad, paid partnership, plus transcript and on-screen mentions) to show which brands pay creators and name the creators they already work with.
- We use Oriane frames and timestamps to auto-cut a sponsor reel: the exact moments, the quote, the brand's logo and colors (via Firecrawl), and the creator's stats.
- Which makes it possible to turn invisible, unpaid exposure into a pitch with proof in under a minute.

## What's the vision at scale?
- In a year, this could be the deal engine for the creator economy: every creator's back catalog scanned continuously, with alerts like "you mentioned Graza 3 times this month; they're paying 40 creators, here's your pitch."
- Two-sided: brands get the mirror view, finding every creator who already loves them, ranked by real reach, before competitors do.
- Agencies run it across their whole roster weekly; we take a cut of deals sourced or charge per seat.
- Every closed deal makes the model better at predicting which brands convert.

## Comments
Stack: Oriane API (contents search, transcripts, on-screen text and frames, sponsor search across the index) · GMI Cloud inference (google/gemini-3.8-flash for brand extraction and pitch writing) · Lovable (frontend, hosted on lovable.app) · Firecrawl (brand logos and colors for reels) · Render (API). Demo creators are pre-scanned for speed; a fresh scan of any handle takes about 2 minutes.
