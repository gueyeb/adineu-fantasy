import { createClient } from "npm:@supabase/supabase-js@2.112.0";

const SLEEPER_API = "https://api.sleeper.app/v1";
const DEFAULT_LEAGUE_ID = "1392715510830878721";
const DEFAULT_SEASON_YEAR = 2026;

function serverKeys(): string[] {
  const keys: string[] = [];
  const encodedKeys = Deno.env.get("SUPABASE_SECRET_KEYS");

  if (encodedKeys) {
    try {
      const parsed = JSON.parse(encodedKeys) as Record<string, unknown>;
      for (const value of Object.values(parsed)) {
        if (typeof value === "string") keys.push(value);
      }
    } catch {
      console.error("SUPABASE_SECRET_KEYS is not valid JSON.");
    }
  }

  for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
    const value = Deno.env.get(name);
    if (value) keys.push(value);
  }

  return [...new Set(keys)];
}

async function sleeperGet(path: string) {
  const response = await fetch(`${SLEEPER_API}${path}`);
  if (!response.ok) {
    throw new Error(`Sleeper API ${path} returned HTTP ${response.status}`);
  }
  return response.json();
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const apiKey = request.headers.get("apikey");
  if (!apiKey || !serverKeys().includes(apiKey)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) {
    return Response.json({ error: "SUPABASE_URL is unavailable" }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const leagueId = String(body.leagueId || DEFAULT_LEAGUE_ID);
    const seasonYear = Number(body.seasonYear || DEFAULT_SEASON_YEAR);
    const supabase = createClient(supabaseUrl, apiKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [league, nflState] = await Promise.all([
      sleeperGet(`/league/${leagueId}`),
      sleeperGet("/state/nfl"),
    ]);

    const { data: season, error: seasonError } = await supabase
      .from("seasons")
      .upsert(
        {
          year: seasonYear,
          platform: "sleeper",
          league_external_id: leagueId,
          league_name: league.name,
          status: league.status,
          playoff_week_start: league.settings?.playoff_week_start ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "platform,league_external_id,year" },
      )
      .select()
      .single();
    if (seasonError) throw seasonError;

    const users = await sleeperGet(`/league/${leagueId}/users`);
    const ownerIdByUserId = new Map<string, string>();
    let ownersCreated = 0;

    for (const user of users) {
      const { data: existingLink, error: linkLookupError } = await supabase
        .from("owner_platform_ids")
        .select("owner_id")
        .eq("platform", "sleeper")
        .eq("platform_user_id", user.user_id)
        .maybeSingle();
      if (linkLookupError) throw linkLookupError;

      let ownerId = existingLink?.owner_id;
      if (!ownerId) {
        const { data: newOwner, error: ownerError } = await supabase
          .from("owners")
          .insert({ display_name: user.display_name })
          .select()
          .single();
        if (ownerError) throw ownerError;

        ownerId = newOwner.id;
        const { error: linkError } = await supabase.from("owner_platform_ids").insert({
          owner_id: ownerId,
          platform: "sleeper",
          platform_user_id: user.user_id,
          platform_display_name: user.display_name,
        });
        if (linkError) throw linkError;
        ownersCreated += 1;
      }

      ownerIdByUserId.set(user.user_id, ownerId);
    }

    const rosters = await sleeperGet(`/league/${leagueId}/rosters`);
    const teamIdByRosterId = new Map<number, string>();

    for (const roster of rosters) {
      const ownerId = ownerIdByUserId.get(roster.owner_id);
      if (!ownerId) continue;

      const teamUser = users.find((user: { user_id: string }) => user.user_id === roster.owner_id);
      const teamName = teamUser?.metadata?.team_name || teamUser?.display_name || `Team ${roster.roster_id}`;
      const { data: team, error: teamError } = await supabase
        .from("teams")
        .upsert(
          {
            season_id: season.id,
            owner_id: ownerId,
            team_name: teamName,
            external_roster_id: String(roster.roster_id),
            wins: roster.settings?.wins ?? 0,
            losses: roster.settings?.losses ?? 0,
            ties: roster.settings?.ties ?? 0,
            points_for: (roster.settings?.fpts ?? 0) + (roster.settings?.fpts_decimal ?? 0) / 100,
            points_against: (roster.settings?.fpts_against ?? 0) +
              (roster.settings?.fpts_against_decimal ?? 0) / 100,
            is_keeper_team: (roster.keepers?.length ?? 0) > 0,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "season_id,external_roster_id" },
        )
        .select()
        .single();
      if (teamError) throw teamError;
      teamIdByRosterId.set(roster.roster_id, team.id);
    }

    const isLiveSeason = ["in_season", "post_season", "complete"].includes(league.status);
    const lastWeekToFetch = isLiveSeason ? Math.min(nflState.week || 0, 18) : 0;
    let matchupRows = 0;

    for (let week = 1; week <= lastWeekToFetch; week += 1) {
      const weekMatchups = await sleeperGet(`/league/${leagueId}/matchups/${week}`);
      const byMatchupId = new Map<number, typeof weekMatchups>();

      for (const matchup of weekMatchups) {
        if (!byMatchupId.has(matchup.matchup_id)) byMatchupId.set(matchup.matchup_id, []);
        byMatchupId.get(matchup.matchup_id)?.push(matchup);
      }

      const rows = [];
      for (const pair of byMatchupId.values()) {
        const [first, second] = pair;
        const firstTeamId = teamIdByRosterId.get(first.roster_id);
        const secondTeamId = second ? teamIdByRosterId.get(second.roster_id) : null;
        if (!firstTeamId) continue;

        rows.push({
          season_id: season.id,
          week,
          team_id: firstTeamId,
          opponent_team_id: secondTeamId,
          points: first.points,
          opponent_points: second?.points ?? null,
          is_playoff: league.settings?.playoff_week_start
            ? week >= league.settings.playoff_week_start
            : false,
          updated_at: new Date().toISOString(),
        });

        if (second && secondTeamId) {
          rows.push({
            season_id: season.id,
            week,
            team_id: secondTeamId,
            opponent_team_id: firstTeamId,
            points: second.points,
            opponent_points: first.points,
            is_playoff: league.settings?.playoff_week_start
              ? week >= league.settings.playoff_week_start
              : false,
            updated_at: new Date().toISOString(),
          });
        }
      }

      if (rows.length) {
        const { error: matchupError } = await supabase
          .from("matchups")
          .upsert(rows, { onConflict: "season_id,week,team_id" });
        if (matchupError) throw matchupError;
        matchupRows += rows.length;
      }
    }

    return Response.json({
      ok: true,
      leagueId,
      seasonYear,
      leagueStatus: league.status,
      ownersCreated,
      teamsSynced: teamIdByRosterId.size,
      matchupRows,
      weeksSynced: lastWeekToFetch,
    });
  } catch (error) {
    console.error("Sleeper sync failed", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown sync failure" },
      { status: 500 },
    );
  }
});
