const hpState = {
    data: null,
    league: 'NHL',
    model: 'combined',
    view: 'dashboard',
    customSimulation: null,
};

const hp = (id) => document.getElementById(id);
const hpFormat = (value, digits = 0) => Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
});
const hpPercent = (value, digits = 1) => `${hpFormat(Number(value) * 100, digits)}%`;
const hpDate = (value) => value ? new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
}).format(new Date(`${value}T12:00:00`)) : 'Not yet rated';
const hpEscape = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
const hpModelName = (value) => value === 'combined' ? 'Combined Elo' : 'League-only Elo';

function hpLeague() {
    return hpState.data.leagues[hpState.league];
}

function hpMetric(league = hpLeague(), model = hpState.model) {
    return league.metrics[model];
}

function hpPublishedSimulation(league = hpLeague(), model = hpState.model) {
    return league.simulations[model];
}

function hpSimulation() {
    const custom = hpState.customSimulation;
    return custom && custom.league === hpState.league && custom.model === hpState.model
        ? custom.result
        : hpPublishedSimulation();
}

function hpLeagueOptions(selected) {
    return hpState.data.leagueOrder.map((key) => {
        const league = hpState.data.leagues[key];
        return `<option value="${hpEscape(key)}"${key === selected ? ' selected' : ''}>${hpEscape(league.name)}</option>`;
    }).join('');
}

function hpSetLeague(key, view = hpState.view) {
    if (!hpState.data.leagues[key]) return;
    hpState.league = key;
    hpState.customSimulation = null;
    hp('hp-league').value = key;
    hpShowView(view);
    hpRenderLeague();
}

function hpShowView(view) {
    hpState.view = view;
    document.querySelectorAll('[data-hp-view]').forEach((button) => {
        if (button.getAttribute('role') === 'tab') {
            button.setAttribute('aria-selected', String(button.dataset.hpView === view));
        }
    });
    document.querySelectorAll('[data-hp-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.hpPanel !== view;
    });
}

function hpBarRows(items, value, label, { percentage = false, baseline = null, limit = 12 } = {}) {
    const rows = items.slice(0, limit);
    if (!rows.length) return '<p class="hp-empty">No values are available.</p>';
    const values = rows.map(value);
    const minimum = baseline === null ? Math.min(...values) : baseline;
    const maximum = Math.max(...values);
    const span = Math.max(1e-9, maximum - minimum);
    return rows.map((item) => {
        const raw = value(item);
        const width = percentage ? Math.max(1.5, raw * 100) : Math.max(2, ((raw - minimum) / span) * 100);
        const formatted = percentage ? hpPercent(raw) : hpFormat(raw, raw < 100 ? 1 : 0);
        return `<div class="hp-bar" title="${hpEscape(label(item))}: ${formatted}">
            <span class="hp-bar-label">${hpEscape(label(item))}</span>
            <div class="hp-bar-track"><div class="hp-bar-fill" style="width:${Math.min(100, width)}%"></div></div>
            <span class="hp-bar-value">${formatted}</span>
        </div>`;
    }).join('');
}

function hpRenderDashboard() {
    const league = hpLeague();
    const metric = hpMetric();
    const simulation = hpSimulation();
    const coverage = league.coverage;
    hp('hp-overview-heading').textContent = `${league.name} forecast`;
    hp('hp-team-count').textContent = hpFormat(league.teams.length);
    hp('hp-team-count-note').textContent = `${league.season} projected field`;
    hp('hp-backtest-games').textContent = hpFormat(metric.games);
    hp('hp-accuracy').textContent = hpPercent(metric.accuracy);
    hp('hp-accuracy-ci').textContent = metric.accuracy_ci_low === undefined
        ? 'Interval unavailable for this sample'
        : `95% interval ${hpPercent(metric.accuracy_ci_low)}–${hpPercent(metric.accuracy_ci_high)}`;
    hp('hp-roster-coverage').textContent = hpPercent(coverage.player_boxscore_share);
    hp('hp-regular-winner').textContent = simulation.regularSeasonWinner;
    hp('hp-regular-winner-odds').textContent = `${hpPercent(simulation.regularSeasonWinnerProbability)} chance to finish first`;
    hp('hp-playoff-winner').textContent = simulation.playoffWinner;
    hp('hp-playoff-winner-odds').textContent = `${hpPercent(simulation.playoffWinnerProbability)} championship probability`;
    hp('hp-schedule-basis').textContent = league.scheduleBasis;
    hp('hp-simulation-basis').textContent = `${hpFormat(simulation.runs)} runs · ${simulation.playoffTeams}-team playoff · best of ${simulation.bestOf}`;

    const rosterBacked = coverage.player_boxscore_share >= 0.5;
    const currentRoster = hpState.league === 'NHL';
    hp('hp-data-tier').innerHTML = `
        <span class="${rosterBacked ? 'is-current' : 'is-limited'}">${rosterBacked ? 'Roster-backed' : 'Team-only heavy'}</span>
        <span class="${currentRoster ? 'is-current' : 'is-limited'}">${currentRoster ? 'Current roster refresh' : `Games through ${hpEscape(league.sourceLastGame)}`}</span>`;

    const teamRatings = [...league.teams].sort((a, b) => b[`${hpState.model}_elo`] - a[`${hpState.model}_elo`]);
    const ratingValues = teamRatings.map((team) => team[`${hpState.model}_elo`]);
    hp('hp-rating-range').textContent = `${hpFormat(Math.min(...ratingValues))}–${hpFormat(Math.max(...ratingValues))}`;
    hp('hp-rating-bars').innerHTML = hpBarRows(teamRatings, (team) => team[`${hpState.model}_elo`], (team) => team.name, { baseline: Math.min(...ratingValues) - 10, limit: 10 });
    const playoffTeams = [...simulation.teams].sort((a, b) => b.playoffWinProbability - a.playoffWinProbability);
    hp('hp-title-bars').innerHTML = hpBarRows(playoffTeams, (team) => team.playoffWinProbability, (team) => team.name, { percentage: true, limit: 6 });

    const simulationByName = Object.fromEntries(simulation.teams.map((team) => [team.name, team]));
    hp('hp-overview-table').innerHTML = teamRatings.slice(0, 12).map((team, index) => {
        const forecast = simulationByName[team.name];
        return `<tr><td class="hp-rank">${index + 1}</td><td class="hp-team-cell">${hpEscape(team.name)}</td><td>${hpFormat(team[`${hpState.model}_elo`], 1)}</td><td>${hpFormat(forecast.averagePoints, 1)}</td><td>${hpPercent(forecast.regularSeasonWinProbability)}</td><td class="${forecast.playoffWinProbability >= .1 ? 'hp-prob-high' : ''}">${hpPercent(forecast.playoffWinProbability)}</td></tr>`;
    }).join('');
}

function hpFillTeamSelect(leagueKey, select, preferred, fallbackIndex = 0) {
    const teams = [...hpState.data.leagues[leagueKey].teams].sort((a, b) => a.name.localeCompare(b.name));
    select.innerHTML = teams.map((team) => `<option value="${hpEscape(team.name)}">${hpEscape(team.name)}</option>`).join('');
    select.value = teams.some((team) => team.name === preferred) ? preferred : (teams[fallbackIndex]?.name || teams[0]?.name || '');
}

function hpFindTeam(leagueKey, name) {
    return hpState.data.leagues[leagueKey].teams.find((team) => team.name === name);
}

function hpExpected(ratingA, ratingB, adjustment = 0) {
    return 1 / (1 + 10 ** ((ratingB - ratingA - adjustment) / 400));
}

function hpTeamCard(team, leagueKey, probability) {
    const league = hpState.data.leagues[leagueKey];
    const rosterLabel = team.roster_source || (league.coverage.player_boxscore_share ? 'Latest game roster' : 'Team fallback rating');
    return `<article class="hp-team-profile">
        <header><div><p class="hp-kicker">${hpEscape(league.name)}</p><h3>${hpEscape(team.name)}</h3></div><span>${hpEscape(rosterLabel)}</span></header>
        <dl><div><dt>${hpEscape(hpModelName(hpState.model))}</dt><dd>${hpFormat(team[`${hpState.model}_elo`], 1)}</dd></div><div><dt>Win probability</dt><dd>${hpPercent(probability)}</dd></div><div><dt>Roster players</dt><dd>${hpFormat(team.roster_players || 0)}</dd></div></dl>
    </article>`;
}

function hpRenderMatchup() {
    const leagueA = hp('hp-league-a').value;
    const leagueB = hp('hp-league-b').value;
    const teamA = hpFindTeam(leagueA, hp('hp-team-a').value);
    const teamB = hpFindTeam(leagueB, hp('hp-team-b').value);
    if (!teamA || !teamB) return;
    const ratingA = Number(teamA[`${hpState.model}_elo`]);
    const ratingB = Number(teamB[`${hpState.model}_elo`]);
    const venue = hp('hp-venue').value;
    const adjustment = venue === 'a' ? hpState.data.model.home_advantage : venue === 'b' ? -hpState.data.model.home_advantage : 0;
    const probabilityA = hpExpected(ratingA, ratingB, adjustment);
    const probabilityB = 1 - probabilityA;
    const winnerA = probabilityA >= .5;
    hp('hp-name-a').textContent = teamA.name;
    hp('hp-name-b').textContent = teamB.name;
    hp('hp-prob-a').style.width = `${probabilityA * 100}%`;
    hp('hp-prob-b').style.width = `${probabilityB * 100}%`;
    hp('hp-prob-a').querySelector('span').textContent = hpPercent(probabilityA);
    hp('hp-prob-b').querySelector('span').textContent = hpPercent(probabilityB);
    hp('hp-matchup-pick').textContent = winnerA ? teamA.name : teamB.name;
    hp('hp-matchup-probability').textContent = `${hpPercent(Math.max(probabilityA, probabilityB))} projected winner`;
    const venueText = venue === 'neutral' ? 'neutral ice' : `${venue === 'a' ? teamA.name : teamB.name} home ice (+${hpFormat(hpState.data.model.home_advantage)} Elo)`;
    hp('hp-matchup-detail').textContent = `${hpModelName(hpState.model)} · ${teamA.name} ${hpFormat(ratingA, 1)} vs. ${teamB.name} ${hpFormat(ratingB, 1)} · ${venueText}`;
    const crossLeague = leagueA !== leagueB;
    hp('hp-cross-league-note').textContent = crossLeague
        ? `${hpState.model === 'combined' ? 'Combined Elo uses the shared cross-league scale.' : 'League-only ratings are isolated; use this cross-league result cautiously or switch to Combined Elo.'}`
        : `Both clubs are rated inside ${hpState.data.leagues[leagueA].name}.`;
    hp('hp-matchup-cards').innerHTML = hpTeamCard(teamA, leagueA, probabilityA) + hpTeamCard(teamB, leagueB, probabilityB);
}

function hpRenderSimulation() {
    const league = hpLeague();
    const simulation = hpSimulation();
    const custom = hpState.customSimulation && hpState.customSimulation.league === hpState.league && hpState.customSimulation.model === hpState.model;
    hp('hp-simulation-heading').textContent = `${league.season} ${league.name} Monte Carlo Projection`;
    hp('hp-simulation-status').textContent = custom
        ? `Showing your ${hpFormat(simulation.runs)}-run browser simulation.`
        : `Showing the published ${hpFormat(simulation.runs)}-run ${hpModelName(hpState.model)} model.`;
    hp('hp-sim-regular').textContent = simulation.regularSeasonWinner;
    hp('hp-sim-regular-prob').textContent = `${hpPercent(simulation.regularSeasonWinnerProbability)} first-place probability`;
    hp('hp-sim-playoff').textContent = simulation.playoffWinner;
    hp('hp-sim-playoff-prob').textContent = `${hpPercent(simulation.playoffWinnerProbability)} championship probability`;
    hp('hp-sim-format').textContent = `${hpFormat(simulation.gamesPerTeam, simulation.gamesPerTeam % 1 ? 1 : 0)} games / team`;
    hp('hp-sim-schedule').textContent = `${simulation.playoffTeams} playoff teams · best of ${simulation.bestOf}`;
    hp('hp-sim-table-label').textContent = `${hpFormat(simulation.runs)} runs`;
    const byPoints = [...simulation.teams].sort((a, b) => b.averagePoints - a.averagePoints);
    const byPlayoffs = [...simulation.teams].sort((a, b) => b.playoffWinProbability - a.playoffWinProbability);
    hp('hp-points-bars').innerHTML = hpBarRows(byPoints, (team) => team.averagePoints, (team) => team.name, { baseline: Math.min(...byPoints.map((team) => team.averagePoints)) - 2, limit: Math.min(16, byPoints.length) });
    hp('hp-playoff-bars').innerHTML = hpBarRows(byPlayoffs, (team) => team.playoffWinProbability, (team) => team.name, { percentage: true, limit: Math.min(16, byPlayoffs.length) });
    hp('hp-simulation-table').innerHTML = byPoints.map((team, index) => `<tr><td class="hp-rank">${index + 1}</td><td class="hp-team-cell">${hpEscape(team.name)}</td><td>${hpFormat(team.elo, 1)}</td><td>${hpFormat(team.averageWins, 1)}</td><td>${hpFormat(team.averagePoints, 1)}</td><td>${hpPercent(team.playoffProbability)}</td><td>${hpPercent(team.regularSeasonWinProbability)}</td><td class="${team.playoffWinProbability >= .1 ? 'hp-prob-high' : ''}">${hpPercent(team.playoffWinProbability)}</td></tr>`).join('');
    hp('hp-simulation-method').innerHTML = `<strong>How to read this:</strong> ${hpEscape(league.scheduleBasis)}. Each game samples the active ${hpModelName(hpState.model)} probability with a ${hpFormat(hpState.data.model.home_advantage)}-point home adjustment; 23% of losses receive an overtime point. The top ${simulation.playoffTeams} advance into best-of-${simulation.bestOf} series. These forecasts use the displayed rating snapshot, so trades, injuries, promotions, relegations, and unpublished schedule details can change the field.`;
}

function hpNormalRandom() {
    const left = Math.max(Number.EPSILON, Math.random());
    const right = Math.random();
    return Math.sqrt(-2 * Math.log(left)) * Math.cos(2 * Math.PI * right);
}

function hpSeriesWinner(left, right, bestOf) {
    const needed = Math.floor(bestOf / 2) + 1;
    let leftWins = 0;
    let rightWins = 0;
    const probability = hpExpected(left.elo, right.elo);
    while (leftWins < needed && rightWins < needed) {
        if (Math.random() < probability) leftWins += 1;
        else rightWins += 1;
    }
    return leftWins > rightWins ? left : right;
}

function hpRunBrowserSimulation() {
    const button = hp('hp-run-simulation');
    const runs = Number(hp('hp-runs').value);
    const published = hpPublishedSimulation();
    const base = published.teams.map((team) => ({ ...team, regular: 0, playoff: 0, playoffMade: 0, pointTotal: 0, winTotal: 0 }));
    button.disabled = true;
    hp('hp-simulation-status').textContent = `Running ${hpFormat(runs)} seasons in your browser…`;
    window.setTimeout(() => {
        for (let run = 0; run < runs; run += 1) {
            const table = base.map((team) => {
                const pointSd = Math.max(2.5, Math.sqrt(published.gamesPerTeam * .55));
                const points = Math.max(0, team.averagePoints + hpNormalRandom() * pointSd);
                const wins = Math.max(0, team.averageWins + hpNormalRandom() * Math.sqrt(published.gamesPerTeam * .25));
                team.pointTotal += points;
                team.winTotal += wins;
                return { source: team, name: team.name, elo: team.elo, points };
            }).sort((a, b) => b.points - a.points || Math.random() - .5);
            table[0].source.regular += 1;
            let field = table.slice(0, published.playoffTeams);
            field.forEach((team) => { team.source.playoffMade += 1; });
            while (field.length > 1) {
                const winners = [];
                for (let index = 0; index < field.length / 2; index += 1) {
                    winners.push(hpSeriesWinner(field[index], field[field.length - index - 1], published.bestOf));
                }
                field = winners.sort((a, b) => b.points - a.points);
            }
            field[0].source.playoff += 1;
        }
        const teams = base.map((team) => ({
            name: team.name,
            elo: team.elo,
            averagePoints: team.pointTotal / runs,
            averageWins: team.winTotal / runs,
            regularSeasonWinProbability: team.regular / runs,
            playoffWinProbability: team.playoff / runs,
            playoffProbability: team.playoffMade / runs,
        })).sort((a, b) => b.regularSeasonWinProbability - a.regularSeasonWinProbability);
        const playoffWinner = [...teams].sort((a, b) => b.playoffWinProbability - a.playoffWinProbability)[0];
        hpState.customSimulation = {
            league: hpState.league,
            model: hpState.model,
            result: {
                ...published,
                runs,
                regularSeasonWinner: teams[0].name,
                regularSeasonWinnerProbability: teams[0].regularSeasonWinProbability,
                playoffWinner: playoffWinner.name,
                playoffWinnerProbability: playoffWinner.playoffWinProbability,
                teams,
            },
        };
        button.disabled = false;
        hpRenderSimulation();
        hpRenderDashboard();
    }, 30);
}

function hpRenderRosters() {
    const league = hpLeague();
    const teamSelect = hp('hp-roster-team');
    const previous = teamSelect.value;
    teamSelect.innerHTML = '<option value="all">All teams</option>' + [...league.teams]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((team) => `<option value="${hpEscape(team.name)}">${hpEscape(team.name)}</option>`).join('');
    teamSelect.value = [...teamSelect.options].some((option) => option.value === previous) ? previous : 'all';
    hp('hp-roster-source').textContent = hpState.league === 'NHL'
        ? 'Official current NHL roster · ratings through latest modeled game'
        : `Latest model rosters · games through ${hpDate(league.sourceLastGame)}`;
    const ratingKey = `${hpState.model}_elo`;
    const teams = [...league.teams].sort((a, b) => b[ratingKey] - a[ratingKey]);
    hp('hp-roster-team-bars').innerHTML = hpBarRows(teams, (team) => team[ratingKey], (team) => team.name, { baseline: Math.min(...teams.map((team) => team[ratingKey])) - 5, limit: teams.length });
    hpFilterPlayers();
}

function hpFilterPlayers() {
    const league = hpLeague();
    const selectedTeam = hp('hp-roster-team').value;
    const search = hp('hp-player-search').value.trim().toLocaleLowerCase();
    const position = hp('hp-position').value;
    const ratingKey = `${hpState.model}_elo`;
    const players = league.players.filter((player) => (
        (selectedTeam === 'all' || player.team === selectedTeam)
        && (position === 'all' || player.position === position)
        && (!search || `${player.name} ${player.team}`.toLocaleLowerCase().includes(search))
    )).sort((a, b) => Number(b[ratingKey]) - Number(a[ratingKey]) || a.name.localeCompare(b.name));
    hp('hp-player-count').textContent = `${hpFormat(players.length)} players`;
    hp('hp-player-table-title').textContent = selectedTeam === 'all' ? 'Rated Players' : `${selectedTeam} Roster`;
    hp('hp-player-table').innerHTML = players.length ? players.slice(0, 300).map((player) => `<tr><td class="hp-team-cell">${hpEscape(player.name)}</td><td>${hpEscape(player.team)}</td><td><span class="hp-position">${hpEscape(player.position)}</span></td><td>${hpFormat(player[ratingKey], 1)}</td><td>${hpDate(player.last_game)}</td></tr>`).join('') : `<tr><td colspan="5" class="hp-empty">${league.coverage.player_boxscore_share ? 'No players match these filters.' : 'This league currently has score-only coverage, so the model does not claim a player-level roster.'}</td></tr>`;
}

function hpRecommendationName(value) {
    return value === 'combined' ? 'Combined Elo' : value === 'league' ? 'League-only Elo' : 'No meaningful edge';
}

function hpRenderModel() {
    const league = hpLeague();
    const combined = league.metrics.combined;
    const isolated = league.metrics.league;
    hp('hp-selection-rule').textContent = hpState.data.model.selection_rule;
    hp('hp-combined-accuracy').textContent = hpPercent(combined.accuracy);
    hp('hp-combined-loss').textContent = `${hpFormat(combined.games)} games · ${combined.log_loss.toFixed(3)} log loss`;
    hp('hp-league-accuracy').textContent = hpPercent(isolated.accuracy);
    hp('hp-league-loss').textContent = `${hpFormat(isolated.games)} games · ${isolated.log_loss.toFixed(3)} log loss`;
    hp('hp-recommended-model').textContent = hpRecommendationName(league.metrics.recommended);
    hp('hp-recommendation-detail').textContent = `${Math.abs(league.metrics.accuracy_delta_combined * 100).toFixed(2)} percentage-point accuracy gap`;
    hp('hp-model-table').innerHTML = hpState.data.leagueOrder.map((key) => {
        const item = hpState.data.leagues[key];
        return `<tr class="hp-model-row ${key === hpState.league ? 'is-active' : ''}" data-league-key="${hpEscape(key)}"><td class="hp-team-cell">${hpEscape(item.name)}</td><td>${hpFormat(item.metrics.combined.games)}</td><td>${hpPercent(item.metrics.combined.accuracy)}</td><td>${hpPercent(item.metrics.league.accuracy)}</td><td>${hpEscape(hpRecommendationName(item.metrics.recommended))}</td><td>${hpPercent(item.coverage.player_boxscore_share)}</td><td>${hpDate(item.sourceLastGame)}</td></tr>`;
    }).join('');
}

function hpRenderLeague() {
    const league = hpLeague();
    hp('hp-model-badge').textContent = hpModelName(hpState.model);
    hp('hp-model-help').textContent = hpState.model === 'combined'
        ? 'Ratings carry between competitions; preferred for cross-league matchups.'
        : 'Ratings are isolated inside each organization.';
    hpRenderDashboard();
    hpRenderMatchup();
    hpRenderSimulation();
    hpRenderRosters();
    hpRenderModel();
    document.title = `${league.name} Hockey Predictor | Richard Lavey`;
}

function hpBindEvents() {
    document.querySelectorAll('[data-hp-view]').forEach((button) => button.addEventListener('click', () => hpShowView(button.dataset.hpView)));
    hp('hp-league').addEventListener('change', (event) => hpSetLeague(event.target.value));
    document.querySelectorAll('input[name="hp-model"]').forEach((input) => input.addEventListener('change', (event) => {
        hpState.model = event.target.value;
        hpState.customSimulation = null;
        hpRenderLeague();
    }));
    hp('hp-league-a').addEventListener('change', () => {
        hpFillTeamSelect(hp('hp-league-a').value, hp('hp-team-a'), '');
        hpRenderMatchup();
    });
    hp('hp-league-b').addEventListener('change', () => {
        hpFillTeamSelect(hp('hp-league-b').value, hp('hp-team-b'), '', 1);
        hpRenderMatchup();
    });
    ['hp-team-a', 'hp-team-b', 'hp-venue'].forEach((id) => hp(id).addEventListener('change', hpRenderMatchup));
    hp('hp-swap').addEventListener('click', () => {
        const leagueA = hp('hp-league-a').value;
        const teamA = hp('hp-team-a').value;
        hp('hp-league-a').value = hp('hp-league-b').value;
        hpFillTeamSelect(hp('hp-league-a').value, hp('hp-team-a'), hp('hp-team-b').value);
        hp('hp-league-b').value = leagueA;
        hpFillTeamSelect(hp('hp-league-b').value, hp('hp-team-b'), teamA);
        hpRenderMatchup();
    });
    hp('hp-run-simulation').addEventListener('click', hpRunBrowserSimulation);
    ['hp-roster-team', 'hp-position'].forEach((id) => hp(id).addEventListener('change', hpFilterPlayers));
    hp('hp-player-search').addEventListener('input', hpFilterPlayers);
    hp('hp-model-table').addEventListener('click', (event) => {
        const row = event.target.closest('[data-league-key]');
        if (row) hpSetLeague(row.dataset.leagueKey, 'model');
    });
}

async function hpInitialize() {
    try {
        const response = await fetch('data/hockey-predictor.json');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        hpState.data = await response.json();
        hp('hp-generated').textContent = hpDate(hpState.data.meta.asOf);
        hp('hp-season').textContent = hpState.data.meta.season;
        hp('hp-history-games').textContent = hpFormat(hpState.data.meta.historicalGames);
        hp('hp-league').innerHTML = hpLeagueOptions('NHL');
        hp('hp-league-a').innerHTML = hpLeagueOptions('NHL');
        hp('hp-league-b').innerHTML = hpLeagueOptions('NHL');
        hpFillTeamSelect('NHL', hp('hp-team-a'), 'Carolina Hurricanes');
        hpFillTeamSelect('NHL', hp('hp-team-b'), 'Florida Panthers', 1);
        hp('hp-source-links').innerHTML = hpState.data.sources.map((source) => `<a href="${hpEscape(source.url)}" target="_blank" rel="noopener noreferrer">${hpEscape(source.label)} ↗</a>`).join('');
        hpBindEvents();
        hpRenderLeague();
        hp('hp-loading').hidden = true;
        hpShowView('dashboard');
    } catch (error) {
        console.error(error);
        hp('hp-loading').textContent = 'The Hockey Predictor data could not be loaded. Try refreshing the page.';
    }
}

document.addEventListener('DOMContentLoaded', hpInitialize);
