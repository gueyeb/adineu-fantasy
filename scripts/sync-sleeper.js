#!/usr/bin/env node
/**
 * Adineu Fantasy — sync Sleeper -> Supabase
 *
 * Pulls live league state from the public Sleeper API (no auth needed,
 * see https://docs.sleeper.com/) and upserts it into the schema created
 * by adineu-fantasy-schema.sql.
 *
 * Run: node sync-sleeper.js
 * Env vars required:
 *   SUPABASE_URL                - your Supabase project URL
 *   SUPABASE_SECRET_KEY         - secret key (server-side only, never expose)
 *                                 SUPABASE_SERVICE_ROLE_KEY is also accepted
 * Env vars optional:
 *   SLEEPER_LEAGUE_ID           - defaults to the Adineu 2026 league
 *   SEASON_YEAR                 - defaults to 2026
 *
 * Intended to run on a schedule (weekly during the season is plenty — Sleeper
 * has no documented rate limit that a once-a-week pull for one league would
 * ever approach). Wire it into n8n with a Schedule Trigger -> Execute Command
 * node calling `node sync-sleeper.js`, or a plain cron entry on the VPS.
 *
 * Deliberately does NOT try to reconcile Sleeper owners against Yahoo owners.
 * That's a one-time manual step (Phase 2) once the Yahoo cold-extract lands —
 * a script guessing "which Sleeper display_name is which Yahoo team" would
 * get people's identities wrong, and that's not a call to automate.
 */

import { createClient } from '@supabase/supabase-js';

const SLEEPER_LEAGUE_ID = process.env.SLEEPER_LEAGUE_ID || '1392715510830878721';
const SEASON_YEAR = Number(process.env.SEASON_YEAR || 2026);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY env vars.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const SLEEPER_API = 'https://api.sleeper.app/v1';

async function sleeperGet(path) {
  const res = await fetch(`${SLEEPER_API}${path}`);
  if (!res.ok) {
    throw new Error(`Sleeper API ${path} -> HTTP ${res.status}`);
  }
  return res.json();
}

async function main() {
  console.log(`Syncing Sleeper league ${SLEEPER_LEAGUE_ID} (season ${SEASON_YEAR})...`);

  // 1. League + current NFL week (to know how many weeks of matchups exist so far)
  const [league, nflState] = await Promise.all([
    sleeperGet(`/league/${SLEEPER_LEAGUE_ID}`),
    sleeperGet(`/state/nfl`),
  ]);

  const { data: season, error: seasonErr } = await supabase
    .from('seasons')
    .upsert(
      {
        year: SEASON_YEAR,
        platform: 'sleeper',
        league_external_id: SLEEPER_LEAGUE_ID,
        league_name: league.name,
        status: league.status,
        playoff_week_start: league.settings?.playoff_week_start ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'platform,league_external_id,year' }
    )
    .select()
    .single();
  if (seasonErr) throw seasonErr;
  console.log(`Season row: ${season.id} (status: ${season.status})`);

  // 2. Users -> owners + owner_platform_ids (create-once, never overwrite display_name)
  const users = await sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/users`);
  const ownerIdByUserId = new Map();

  for (const u of users) {
    const { data: existingLink } = await supabase
      .from('owner_platform_ids')
      .select('owner_id')
      .eq('platform', 'sleeper')
      .eq('platform_user_id', u.user_id)
      .maybeSingle();

    let ownerId = existingLink?.owner_id;

    if (!ownerId) {
      // First time we see this Sleeper user: create a canonical owner.
      // Starting display_name = Sleeper display_name. Rename it directly in
      // Supabase afterwards if you want real first names instead — this
      // script never touches owners.display_name again once the row exists.
      const { data: newOwner, error: ownerErr } = await supabase
        .from('owners')
        .insert({ display_name: u.display_name })
        .select()
        .single();
      if (ownerErr) throw ownerErr;
      ownerId = newOwner.id;

      const { error: linkErr } = await supabase.from('owner_platform_ids').insert({
        owner_id: ownerId,
        platform: 'sleeper',
        platform_user_id: u.user_id,
        platform_display_name: u.display_name,
      });
      if (linkErr) throw linkErr;
      console.log(`New owner created: ${u.display_name} <- sleeper user ${u.user_id}`);
    }

    ownerIdByUserId.set(u.user_id, ownerId);
  }

  // 3. Rosters -> teams (wins/losses/points, keyed by roster_id per season)
  const rosters = await sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/rosters`);
  const teamIdByRosterId = new Map();

  for (const r of rosters) {
    const ownerId = ownerIdByUserId.get(r.owner_id);
    if (!ownerId) {
      console.warn(`Roster ${r.roster_id} has no matching owner (owner_id=${r.owner_id}), skipping.`);
      continue;
    }
    const teamUser = users.find((u) => u.user_id === r.owner_id);
    const teamName = teamUser?.metadata?.team_name || teamUser?.display_name || `Team ${r.roster_id}`;

    const { data: team, error: teamErr } = await supabase
      .from('teams')
      .upsert(
        {
          season_id: season.id,
          owner_id: ownerId,
          team_name: teamName,
          external_roster_id: String(r.roster_id),
          wins: r.settings?.wins ?? 0,
          losses: r.settings?.losses ?? 0,
          ties: r.settings?.ties ?? 0,
          points_for: (r.settings?.fpts ?? 0) + (r.settings?.fpts_decimal ?? 0) / 100,
          points_against: (r.settings?.fpts_against ?? 0) + (r.settings?.fpts_against_decimal ?? 0) / 100,
          is_keeper_team: (r.keepers?.length ?? 0) > 0,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'season_id,external_roster_id' }
      )
      .select()
      .single();
    if (teamErr) throw teamErr;
    teamIdByRosterId.set(r.roster_id, team.id);
  }
  console.log(`Synced ${teamIdByRosterId.size} teams.`);

  // 4. Matchups, week by week, up to the current NFL week (skip in pre_draft/offseason)
  const currentWeek = nflState.week || 0;
  const isLiveSeason = ['in_season', 'post_season', 'complete'].includes(league.status) || league.status === 'in_season';
  const lastWeekToFetch = isLiveSeason ? Math.min(currentWeek, 18) : 0;

  let matchupRows = 0;
  for (let week = 1; week <= lastWeekToFetch; week++) {
    const weekMatchups = await sleeperGet(`/league/${SLEEPER_LEAGUE_ID}/matchups/${week}`);
    if (!weekMatchups.length) continue;

    // Group by matchup_id to find each team's opponent.
    const byMatchupId = new Map();
    for (const m of weekMatchups) {
      if (!byMatchupId.has(m.matchup_id)) byMatchupId.set(m.matchup_id, []);
      byMatchupId.get(m.matchup_id).push(m);
    }

    const rowsThisWeek = [];
    for (const pair of byMatchupId.values()) {
      const [a, b] = pair; // bye weeks / odd counts leave b undefined
      const teamAId = teamIdByRosterId.get(a.roster_id);
      const teamBId = b ? teamIdByRosterId.get(b.roster_id) : null;
      if (!teamAId) continue;

      rowsThisWeek.push({
        season_id: season.id,
        week,
        team_id: teamAId,
        opponent_team_id: teamBId,
        points: a.points,
        opponent_points: b?.points ?? null,
        is_playoff: league.settings?.playoff_week_start ? week >= league.settings.playoff_week_start : false,
        updated_at: new Date().toISOString(),
      });
      if (b && teamBId) {
        rowsThisWeek.push({
          season_id: season.id,
          week,
          team_id: teamBId,
          opponent_team_id: teamAId,
          points: b.points,
          opponent_points: a.points,
          is_playoff: league.settings?.playoff_week_start ? week >= league.settings.playoff_week_start : false,
          updated_at: new Date().toISOString(),
        });
      }
    }

    if (rowsThisWeek.length) {
      const { error: matchupErr } = await supabase
        .from('matchups')
        .upsert(rowsThisWeek, { onConflict: 'season_id,week,team_id' });
      if (matchupErr) throw matchupErr;
      matchupRows += rowsThisWeek.length;
    }
  }
  console.log(`Synced ${matchupRows} matchup rows across ${lastWeekToFetch} week(s).`);

  console.log('Done.');
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
