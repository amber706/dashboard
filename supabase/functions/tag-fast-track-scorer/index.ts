// Tag-based fast-track scorer for CTM Bot.
// v2 (2026-06-01): added DUI exclusion. Any tag containing 'dui' → do NOT fast-track score.
//   This prevents DUI calls with mixed dui+commercial tags from being scored as Commercial 5★
//   and leaking into Google Ads as Commercial Qualified conversions. DUI calls fall through
//   to the regular DUI scoring rubric (path_3_dui) in route-and-score.
//
//   - inbound calls only
//   - any 'dui' substring in tags: SKIP fast-track (don't write call_score, don't change ctm_call status)
//   - talk_time < 120s: mark ctm_call status='skipped_under_2min' (no score)
//   - talk_time >= 120s AND tag contains 'commercial': call_score score=5 insurance_type=commercial
//   - talk_time >= 120s AND tag contains 'ahcccs': call_score score=3 insurance_type=medicaid
// Body: { dry_run?: boolean, limit?: number, since_iso?: string }
// Idempotent: skips calls that already have a call_score.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

async function fetchCallsToProcess(sinceIso: string, limit: number) {
  const calls: any[] = [];
  let from = 0;
  while (from < limit) {
    const { data, error } = await sb.from('ctm_call')
      .select('call_id, raw_payload, status')
      .gte('received_at', sinceIso)
      .eq('direction', 'inbound')
      .order('received_at', { ascending: false })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    calls.push(...data);
    if (data.length < 1000) break;
    from += 1000;
    if (calls.length >= limit) break;
  }
  const ids = calls.map(c => c.call_id);
  const scoredSet = new Set<string>();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { data } = await sb.from('call_score').select('call_id').in('call_id', batch);
    if (data) for (const s of data) scoredSet.add(s.call_id);
  }
  return calls.filter(c => !scoredSet.has(c.call_id)).slice(0, limit);
}

Deno.serve(async (req) => {
  try {
    // This function runs with verify_jwt=false, because the CTM project's Postgres
    // vault has no service_role_key for pg_cron to sign with (it 401'd every 30 min
    // for months). That makes the endpoint publicly reachable, so the caller does NOT
    // get to choose the workload: `since_iso` and `limit` are ignored and pinned to the
    // scheduled sweep's own values. Without that clamp an anonymous caller could pass
    // since_iso far in the past with limit=20000 and force-score a large backlog at
    // 5★ commercial / 3★ AHCCCS — which push-google-conversions then sends to Google
    // Ads as real conversions. Pinned, the worst an anonymous call can do is run the
    // same idempotent sweep the cron already runs, early.
    // dry_run stays honoured: it is read-only.
    const body = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const limit = 5000;
    const sinceIso = new Date(Date.now() - 90 * 86400000).toISOString();

    const calls = await fetchCallsToProcess(sinceIso, limit);

    const stats = {
      total_processed: 0,
      under_2min_skipped: 0,
      no_talk_time: 0,
      dui_excluded_from_fast_track: 0,
      commercial_scored_5: 0,
      ahcccs_scored_3: 0,
      over_2min_no_tag: 0,
      errors: [] as string[],
    };

    const scoresToInsert: any[] = [];
    const callsToMarkSkipped: string[] = [];
    const callsToMarkProcessed: string[] = [];

    for (const c of calls) {
      stats.total_processed++;
      const payload = c.raw_payload ?? {};
      const talkTime = Number(payload.talk_time ?? 0);
      const tagList = (payload.tags ?? payload.tag_list ?? []) as any[];
      const trackingLabel = String(payload.tracking_label ?? '');
      const tagsLower = tagList.map((t: any) => typeof t === 'string' ? t.toLowerCase() : '');

      if (talkTime === 0) {
        stats.no_talk_time++;
        continue;
      }

      // v2: DUI exclusion BEFORE any other classification. Check tags for 'dui' substring.
      // Catches: 'dui', 'ppc-dui', 'dui-ppc', 'elev8-ppc-dui', any future dui-prefixed tags.
      // Also catches 'DUI' in CTM tracking_label as a defense-in-depth signal.
      const hasDui = tagsLower.some((t: string) => t.includes('dui'));
      if (hasDui) {
        stats.dui_excluded_from_fast_track++;
        continue; // don't write call_score, don't change ctm_call status — let regular DUI rubric handle it
      }

      if (talkTime < 120) {
        stats.under_2min_skipped++;
        callsToMarkSkipped.push(c.call_id);
        continue;
      }

      const hasCommercial = tagsLower.some((t: string) => t.includes('commercial'));
      const hasAhcccs = tagsLower.some((t: string) => t.includes('ahcccs'));

      if (hasCommercial) {
        scoresToInsert.push({
          call_id: c.call_id,
          path: 'tag_fast_track',
          score: 5,
          score_label: 'Commercial Tag Auto-Score (2+ min talk time)',
          confidence: 1.0,
          reason: 'Auto-scored 5★ via Commercial CTM tag + 2+ minute talk time',
          insurance_type: 'commercial',
          approval_status: 'auto_approved',
        });
        callsToMarkProcessed.push(c.call_id);
        stats.commercial_scored_5++;
      } else if (hasAhcccs) {
        scoresToInsert.push({
          call_id: c.call_id,
          path: 'tag_fast_track',
          score: 3,
          score_label: 'AHCCCS Tag Auto-Score (2+ min talk time)',
          confidence: 1.0,
          reason: 'Auto-scored 3★ via AHCCCS CTM tag + 2+ minute talk time',
          insurance_type: 'medicaid',
          approval_status: 'auto_approved',
        });
        callsToMarkProcessed.push(c.call_id);
        stats.ahcccs_scored_3++;
      } else {
        stats.over_2min_no_tag++;
      }
    }

    if (dryRun) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, version: 'v2', since: sinceIso, stats }, null, 2), { headers: { 'content-type': 'application/json' } });
    }

    let inserted = 0;
    for (let i = 0; i < scoresToInsert.length; i += 500) {
      const batch = scoresToInsert.slice(i, i + 500);
      const { error } = await sb.from('call_score').upsert(batch, { onConflict: 'call_id' });
      if (error) stats.errors.push(`score insert batch ${i}: ${error.message}`);
      else inserted += batch.length;
    }

    const now = new Date().toISOString();
    let markedProcessed = 0, markedSkipped = 0;
    for (let i = 0; i < callsToMarkProcessed.length; i += 500) {
      const batch = callsToMarkProcessed.slice(i, i + 500);
      const { error } = await sb.from('ctm_call').update({ status: 'processed', processed_at: now }).in('call_id', batch);
      if (error) stats.errors.push(`ctm_call processed batch ${i}: ${error.message}`);
      else markedProcessed += batch.length;
    }
    for (let i = 0; i < callsToMarkSkipped.length; i += 500) {
      const batch = callsToMarkSkipped.slice(i, i + 500);
      const { error } = await sb.from('ctm_call').update({ status: 'skipped_under_2min', processed_at: now }).in('call_id', batch);
      if (error) stats.errors.push(`ctm_call skipped batch ${i}: ${error.message}`);
      else markedSkipped += batch.length;
    }

    return new Response(JSON.stringify({
      ok: true,
      version: 'v2',
      since: sinceIso,
      stats,
      inserted,
      marked_processed: markedProcessed,
      marked_skipped_under_2min: markedSkipped,
    }, null, 2), { headers: { 'content-type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), { status: 500 });
  }
});
