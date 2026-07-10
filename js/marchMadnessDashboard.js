const MARCH_MADNESS_DATA_URL = 'data/march-madness-dashboard.json?v=2026-03-18-1';

const mmState = {
    data: null,
    teamMap: new Map(),
    playersByTeam: new Map(),
    charts: new Map(),
    currentView: 'overview',
    renderedViews: new Set(),
    bracketRegion: 'EAST',
    playerPage: 1
};

const mmColors = {
    ink: '#17191c', muted: '#626a72', line: 'rgba(98,106,114,.18)', green: '#147d64',
    greenSoft: 'rgba(20,125,100,.18)', red: '#c14953', redSoft: 'rgba(193,73,83,.18)',
    blue: '#2864a8', blueSoft: 'rgba(40,100,168,.18)', gold: '#c58a16', gray: '#a3abb1'
};

const STAGE_LABELS = {
    roundOf32: 'Round of 32',
    sweet16: 'Sweet 16',
    eliteEight: 'Elite Eight',
    finalFour: 'Final Four',
    titleGame: 'Title game',
    champion: 'Championship'
};

const ROUND_LABELS = {
    2: 'First Round',
    3: 'Second Round',
    4: 'Sweet 16',
    5: 'Elite Eight'
};

const chartInfo = {
    'overview-rating-chart': ['Highest Tournament Team Ratings', 'Ranks the strongest frozen tournament rosters by player-weighted team Elo.', 'Team Elo rating, beginning at zero.', 'Top tournament teams, ordered from highest to lowest.', 'A zero baseline keeps bar lengths proportional. Elo is the mean of the players in each latest pre-tournament roster snapshot.'],
    'overview-title-chart': ['Top Championship Probabilities', 'Shows the teams that won the largest share of 20,000 simulated brackets.', 'Simulated probability of winning the championship.', 'Teams, ordered from highest to lowest title probability.', 'Even the favorite wins fewer than one in ten simulations, illustrating tournament uncertainty.'],
    'overview-calibration-chart': ['Prediction Calibration', 'Compares average Elo confidence with the historical rate at which the favorite won.', 'Model favorite probability bucket.', 'Historical favorite win rate.', 'A calibrated model follows the 45-degree reference line; this model has historically been conservative at higher confidence.'],
    'overview-seed-chart': ['Seed vs. Model Rating', 'Compares official tournament seeding with player-weighted Elo.', 'Official seed from 1 to 16.', 'Frozen team Elo.', 'High-rated teams with larger seed numbers are potential model-identified sleepers.'],
    'team-ranking-chart': ['Filtered Team Ranking', 'Ranks teams matching the active search, region, seed, and metric filters.', 'Selected rating or advancement metric.', 'Filtered tournament teams.', 'Use the controls above the chart to compare the field from different perspectives.'],
    'matchup-rating-chart': ['Rating Comparison', 'Compares the frozen player-weighted Elo of the selected teams.', 'Selected teams.', 'Team Elo, beginning at zero.', 'The zero-based bars preserve proportional magnitude; the rating gap is converted to the neutral-court probability shown above.'],
    'matchup-path-chart': ['Advancement Outlook', 'Compares how often each selected team reached every tournament stage.', 'Tournament stage.', 'Share of 20,000 simulations reaching the stage.', 'Path difficulty matters, so similar Elo teams can have different advancement probabilities.'],
    'matchup-roster-chart': ['Highest-Rated Players', 'Shows the top eight frozen player Elo values on each selected roster.', 'Roster rank within each team.', 'Player Elo.', 'Team Elo uses the complete active roster; this chart highlights the strongest individual inputs.'],
    'simulation-chart': ['Monte Carlo Leaderboard', 'Ranks teams by the selected tournament advancement stage.', 'Simulated probability of reaching the selected stage.', 'Filtered tournament teams.', 'Each run samples every unresolved game from its Elo probability and follows the official bracket path.'],
    'player-rating-chart': ['Highest Player Ratings', 'Ranks individual players from the frozen tournament roster snapshots.', 'Player Elo, beginning at zero.', 'Filtered players.', 'The zero-based bars preserve proportional magnitude. Player changes are allocated according to time played.'],
    'model-calibration-chart': ['Calibration by Confidence Bucket', 'Compares predicted favorite probability with observed favorite success across 70,885 games.', 'Model confidence bucket.', 'Historical win rate.', 'The difference between the two lines shows underconfidence or overconfidence.'],
    'model-sample-chart': ['Backtest Games by Bucket', 'Shows how many historical games fall into each prediction-confidence group.', 'Model confidence bucket.', 'Number of historical games.', 'The highest-confidence buckets contain fewer games, so their intervals are wider.']
};

const byId = id => document.getElementById(id);
const formatNumber = (value, digits = 0) => Number(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const formatPercent = (value, digits = 1) => `${formatNumber(Number(value) * 100, digits)}%`;
const formatDate = value => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${value}T12:00:00`));
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');

function fairOdds(probability) {
    const bounded = Math.min(0.999, Math.max(0.001, probability));
    const american = bounded >= 0.5 ? -Math.round(100 * bounded / (1 - bounded)) : Math.round(100 * (1 - bounded) / bounded);
    return `${american > 0 ? '+' : ''}${american} | ${(1 / bounded).toFixed(2)} decimal`;
}

function expectedScore(ratingA, ratingB) {
    return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function chartOptions({ horizontal = false, percentage = false, zeroBaseline = false, xTitle = '', yTitle = '', legend = false } = {}) {
    const valueAxis = horizontal ? 'x' : 'y';
    const categoryAxis = horizontal ? 'y' : 'x';
    return {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        animation: { duration: 280 },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
            legend: { display: legend, labels: { color: mmColors.muted, boxWidth: 12, font: { size: 11, weight: 700 } } },
            tooltip: { backgroundColor: mmColors.ink, padding: 11, titleFont: { weight: 800 } }
        },
        scales: {
            [valueAxis]: {
                beginAtZero: percentage || zeroBaseline,
                min: percentage || zeroBaseline ? 0 : undefined,
                max: percentage ? 100 : undefined,
                grid: { color: mmColors.line },
                ticks: { color: mmColors.muted, callback: percentage ? value => `${value}%` : undefined },
                title: { display: Boolean(horizontal ? xTitle : yTitle), text: horizontal ? xTitle : yTitle, color: mmColors.muted, font: { size: 11, weight: 700 } }
            },
            [categoryAxis]: {
                grid: { display: false },
                ticks: { color: mmColors.muted },
                title: { display: Boolean(horizontal ? yTitle : xTitle), text: horizontal ? yTitle : xTitle, color: mmColors.muted, font: { size: 11, weight: 700 } }
            }
        }
    };
}

function renderChart(key, canvasId, config) {
    mmState.charts.get(key)?.destroy();
    const canvas = byId(canvasId);
    if (!canvas) return;
    mmState.charts.set(key, new Chart(canvas, config));
}

function setupChartInfo() {
    document.querySelectorAll('.mm-chart-frame canvas').forEach(canvas => {
        if (!chartInfo[canvas.id]) return;
        const header = canvas.closest('.mm-chart-frame')?.querySelector(':scope > header');
        if (!header || header.querySelector(`[data-chart-info="${canvas.id}"]`)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mm-info-button';
        button.dataset.chartInfo = canvas.id;
        button.title = `More information about ${chartInfo[canvas.id][0]}`;
        button.setAttribute('aria-label', button.title);
        button.textContent = 'i';
        header.appendChild(button);
    });
}

function openChartInfo(canvasId) {
    const info = chartInfo[canvasId];
    if (!info) return;
    byId('mm-info-title').textContent = info[0];
    byId('mm-info-description').textContent = info[1];
    byId('mm-info-x').textContent = info[2];
    byId('mm-info-y').textContent = info[3];
    byId('mm-info-note').textContent = info[4];
    byId('mm-info-dialog').showModal();
}

function setView(view, updateHash = true) {
    const valid = ['overview', 'teams', 'matchup', 'bracket', 'simulation', 'players', 'model'];
    const next = valid.includes(view) ? view : 'overview';
    mmState.currentView = next;
    document.querySelectorAll('[data-mm-view]').forEach(button => {
        if (button.getAttribute('role') === 'tab') button.setAttribute('aria-selected', String(button.dataset.mmView === next));
    });
    document.querySelectorAll('[data-mm-panel]').forEach(panel => { panel.hidden = panel.dataset.mmPanel !== next; });
    if (updateHash) history.replaceState(null, '', `#${next}`);
    renderView(next);
}

function renderView(view) {
    if (!mmState.data) return;
    const renderers = { overview: renderOverview, teams: renderTeams, matchup: renderMatchup, bracket: renderBracket, simulation: renderSimulation, players: renderPlayers, model: renderModel };
    requestAnimationFrame(() => renderers[view]?.());
}

function populateSelect(select, values) {
    select.insertAdjacentHTML('beforeend', values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join(''));
}

function renderOverview() {
    const { data } = mmState;
    const topRatings = data.teams.slice(0, 12);
    const topTitles = [...data.teams].sort((a, b) => b.simulation.champion - a.simulation.champion).slice(0, 12);
    const favorite = topTitles[0];
    byId('metric-teams').textContent = formatNumber(data.meta.teams);
    byId('metric-games').textContent = formatNumber(data.backtest.games);
    byId('metric-accuracy').textContent = formatPercent(data.backtest.accuracy, 1);
    byId('metric-accuracy-range').textContent = `${formatPercent(data.backtest.accuracyLow, 1)}-${formatPercent(data.backtest.accuracyHigh, 1)} interval`;
    byId('metric-simulations').textContent = formatNumber(data.meta.simulations);
    byId('metric-players').textContent = formatNumber(data.meta.players);
    byId('champion-pick-heading').textContent = favorite.name;
    byId('champion-pick-meta').textContent = `${favorite.region} | No. ${favorite.seed} seed | ${formatNumber(favorite.rating, 1)} Elo | ${favorite.record.wins}-${favorite.record.losses}`;
    byId('champion-pick-probability').textContent = formatPercent(favorite.simulation.champion, 1);
    byId('champion-pick-odds').textContent = `Fair ${fairOdds(favorite.simulation.champion)}`;
    byId('champion-path').innerHTML = [
        ['Final Four', favorite.simulation.finalFour], ['Title game', favorite.simulation.titleGame], ['Champion', favorite.simulation.champion]
    ].map(([label, value]) => `<div><span>${label}</span><strong>${formatPercent(value, 1)}</strong></div>`).join('');

    renderChart('overviewRating', 'overview-rating-chart', {
        type: 'bar', data: { labels: topRatings.map(team => team.name), datasets: [{ label: 'Team Elo', data: topRatings.map(team => team.rating), backgroundColor: mmColors.green, borderRadius: 3 }] },
        options: chartOptions({ horizontal: true, zeroBaseline: true, xTitle: 'Player-weighted team Elo', yTitle: 'Tournament team' })
    });
    renderChart('overviewTitle', 'overview-title-chart', {
        type: 'bar', data: { labels: topTitles.map(team => team.name), datasets: [{ label: 'Championship probability', data: topTitles.map(team => team.simulation.champion * 100), backgroundColor: mmColors.gold, borderRadius: 3 }] },
        options: chartOptions({ horizontal: true, percentage: true, xTitle: 'Simulated championship probability', yTitle: 'Tournament team' })
    });
    renderCalibrationChart('overviewCalibration', 'overview-calibration-chart');
    renderChart('overviewSeed', 'overview-seed-chart', {
        type: 'scatter', data: { datasets: [{ label: 'Tournament teams', data: data.teams.map(team => ({ x: team.seed, y: team.rating, team: team.name })), pointBackgroundColor: mmColors.blue, pointRadius: 4, pointHoverRadius: 6 }] },
        options: {
            ...chartOptions({ xTitle: 'Official tournament seed', yTitle: 'Player-weighted team Elo' }),
            plugins: { ...chartOptions().plugins, legend: { display: false }, tooltip: { callbacks: { label: context => `${context.raw.team}: No. ${context.raw.x}, ${formatNumber(context.raw.y, 1)} Elo` } } },
            scales: { x: { min: 1, max: 16, ticks: { stepSize: 1 }, grid: { color: mmColors.line }, title: { display: true, text: 'Official tournament seed' } }, y: { grid: { color: mmColors.line }, title: { display: true, text: 'Player-weighted team Elo' } } }
        }
    });
}

function filteredTeams() {
    const query = byId('team-search').value.trim().toLowerCase();
    const region = byId('team-region').value;
    const seed = byId('team-seed').value;
    const sort = byId('team-sort').value;
    const rows = mmState.data.teams.filter(team => (!query || team.name.toLowerCase().includes(query)) && (region === 'all' || team.region === region) && (seed === 'all' || String(team.seed) === seed));
    const sorters = {
        rating: (a, b) => b.rating - a.rating,
        champion: (a, b) => b.simulation.champion - a.simulation.champion,
        finalFour: (a, b) => b.simulation.finalFour - a.simulation.finalFour,
        seed: (a, b) => a.seed - b.seed || b.rating - a.rating,
        winPct: (a, b) => b.record.winPct - a.record.winPct
    };
    return rows.sort(sorters[sort]);
}

function renderTeams() {
    const rows = filteredTeams();
    const sort = byId('team-sort').value;
    const metric = sort === 'champion' ? team => team.simulation.champion * 100 : sort === 'finalFour' ? team => team.simulation.finalFour * 100 : sort === 'seed' ? team => team.seed : sort === 'winPct' ? team => team.record.winPct * 100 : team => team.rating;
    const heading = { rating: 'Highest Team Ratings', champion: 'Championship Probability', finalFour: 'Final Four Probability', seed: 'Tournament Seed', winPct: 'Season Win Rate' }[sort];
    byId('team-chart-heading').textContent = heading;
    byId('team-result-count').textContent = `${formatNumber(rows.length)} teams`;
    byId('team-table-body').innerHTML = rows.map(team => `<tr><td>${team.ratingRank}</td><td><button class="mm-team-button" type="button" data-team-matchup="${escapeHtml(team.name)}">${escapeHtml(team.name)}</button></td><td><span class="mm-region-badge">${team.region}</span></td><td><span class="mm-seed-badge">${team.seed}</span></td><td>${formatNumber(team.rating, 1)}</td><td>${team.record.wins}-${team.record.losses}</td><td>${formatPercent(team.simulation.finalFour, 1)}</td><td>${formatPercent(team.simulation.champion, 1)}</td></tr>`).join('');
    renderChart('teamRanking', 'team-ranking-chart', {
        type: 'bar', data: { labels: rows.slice(0, 16).map(team => team.name), datasets: [{ label: heading, data: rows.slice(0, 16).map(metric), backgroundColor: sort === 'champion' ? mmColors.gold : sort === 'finalFour' ? mmColors.blue : mmColors.green, borderRadius: 3 }] },
        options: chartOptions({ horizontal: true, percentage: ['champion', 'finalFour', 'winPct'].includes(sort), zeroBaseline: ['rating', 'seed'].includes(sort), xTitle: heading, yTitle: 'Tournament team' })
    });
}

function normalizedSearch(value) {
    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function teamSearchMatches(query) {
    const normalized = normalizedSearch(query);
    if (!normalized) return [];
    const tokens = normalized.split(' ').filter(Boolean);
    return mmState.data.teams.filter(team => tokens.every(token => normalizedSearch(`${team.name} ${team.region} seed ${team.seed} ${team.rating}`).includes(token))).sort((a, b) => {
        const nameA = normalizedSearch(a.name);
        const nameB = normalizedSearch(b.name);
        const scoreA = nameA === normalized ? 0 : nameA.startsWith(normalized) ? 1 : nameA.includes(normalized) ? 2 : 3;
        const scoreB = nameB === normalized ? 0 : nameB.startsWith(normalized) ? 1 : nameB.includes(normalized) ? 2 : 3;
        return scoreA - scoreB || b.rating - a.rating;
    }).slice(0, 10);
}

function setMatchupTeam(side, name, shouldRender = true) {
    if (!mmState.teamMap.has(name)) return;
    const input = byId(`matchup-team-${side}`);
    input.value = name;
    input.dataset.selectedName = name;
    input.setAttribute('aria-invalid', 'false');
    if (shouldRender) renderMatchup();
}

function renderTeamSearch(input) {
    const side = input.id.endsWith('one') ? 'one' : 'two';
    const results = byId(`matchup-results-${side}`);
    const matches = teamSearchMatches(input.value);
    results.innerHTML = matches.length ? matches.map((team, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-team-search-result="${escapeHtml(team.name)}" data-target-side="${side}"><strong>${escapeHtml(team.name)}</strong><em>${formatNumber(team.rating, 0)} Elo</em><span>${team.region} | No. ${team.seed} seed | ${team.record.wins}-${team.record.losses} | ${formatPercent(team.simulation.champion, 1)} title</span></button>`).join('') : `<div class="mm-search-empty">${input.value.trim() ? 'No tournament teams match this search.' : 'Type a team, region, seed, or Elo rating.'}</div>`;
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
}

function restoreTeamSearch(input) {
    input.value = input.dataset.selectedName || '';
    const side = input.id.endsWith('one') ? 'one' : 'two';
    byId(`matchup-results-${side}`).hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-invalid', 'false');
}

function calibrationRange(probability) {
    const favorite = Math.max(probability, 1 - probability);
    const bins = mmState.data.backtest.calibration.filter(bin => bin.games > 0);
    const bin = bins.reduce((best, item) => Math.abs(item.averageProbability - favorite) < Math.abs(best.averageProbability - favorite) ? item : best, bins[0]);
    return probability >= 0.5 ? [bin.ciLow, bin.ciHigh, bin] : [1 - bin.ciHigh, 1 - bin.ciLow, bin];
}

function probabilityRangeMarkup(team, probability, range) {
    return `<div class="mm-probability-range"><div><strong>${escapeHtml(team.name)}</strong><span>${formatPercent(probability, 1)}</span></div><div class="mm-range-track"><span style="left:${range[0] * 100}%;width:${Math.max(0, range[1] - range[0]) * 100}%"></span><i style="left:${probability * 100}%"></i></div><small>Historical 95% range ${formatPercent(range[0], 1)}-${formatPercent(range[1], 1)} | ${formatNumber(range[2].games)} comparable games</small></div>`;
}

function renderMatchup() {
    let teamOne = mmState.teamMap.get(byId('matchup-team-one').dataset.selectedName);
    let teamTwo = mmState.teamMap.get(byId('matchup-team-two').dataset.selectedName);
    if (!teamOne || !teamTwo) return;
    if (teamOne.name === teamTwo.name) {
        teamTwo = mmState.data.teams.find(team => team.name !== teamOne.name);
        setMatchupTeam('two', teamTwo.name, false);
    }
    const probabilityOne = expectedScore(teamOne.rating, teamTwo.rating);
    const probabilityTwo = 1 - probabilityOne;
    const rangeOne = calibrationRange(probabilityOne);
    const rangeTwo = calibrationRange(probabilityTwo);
    byId('matchup-name-one').textContent = teamOne.name;
    byId('matchup-name-two').textContent = teamTwo.name;
    byId('matchup-probability-one').textContent = formatPercent(probabilityOne, 1);
    byId('matchup-probability-two').textContent = formatPercent(probabilityTwo, 1);
    byId('matchup-bar-one').style.width = `${probabilityOne * 100}%`;
    byId('matchup-bar-two').style.width = `${probabilityTwo * 100}%`;
    byId('matchup-odds-name-one').textContent = teamOne.name;
    byId('matchup-odds-name-two').textContent = teamTwo.name;
    byId('matchup-odds-one').textContent = fairOdds(probabilityOne);
    byId('matchup-odds-two').textContent = fairOdds(probabilityTwo);
    byId('matchup-confidence').textContent = `${formatNumber(rangeOne[2].games)} comparable games`;
    byId('matchup-ranges').innerHTML = probabilityRangeMarkup(teamOne, probabilityOne, rangeOne) + probabilityRangeMarkup(teamTwo, probabilityTwo, rangeTwo);
    byId('matchup-team-cards').innerHTML = [teamOne, teamTwo].map(team => `<article class="mm-team-card"><header><div><p class="mm-eyebrow">${team.region} region</p><h3>${escapeHtml(team.name)}</h3></div><span class="mm-seed-badge">No. ${team.seed}</span></header><dl><div><dt>Team Elo</dt><dd>${formatNumber(team.rating, 1)}</dd></div><div><dt>Record</dt><dd>${team.record.wins}-${team.record.losses}</dd></div><div><dt>Final Four</dt><dd>${formatPercent(team.simulation.finalFour, 1)}</dd></div><div><dt>Champion</dt><dd>${formatPercent(team.simulation.champion, 1)}</dd></div></dl></article>`).join('');
    renderMatchupCharts(teamOne, teamTwo);
    renderRosterComparison(teamOne, teamTwo);
}

function renderMatchupCharts(teamOne, teamTwo) {
    renderChart('matchupRating', 'matchup-rating-chart', {
        type: 'bar', data: { labels: [teamOne.name, teamTwo.name], datasets: [{ label: 'Team Elo', data: [teamOne.rating, teamTwo.rating], backgroundColor: [mmColors.green, mmColors.red], borderRadius: 3 }] },
        options: chartOptions({ zeroBaseline: true, xTitle: 'Selected team', yTitle: 'Player-weighted team Elo' })
    });
    const stages = ['roundOf32', 'sweet16', 'eliteEight', 'finalFour', 'titleGame', 'champion'];
    renderChart('matchupPath', 'matchup-path-chart', {
        type: 'line', data: { labels: stages.map(stage => STAGE_LABELS[stage]), datasets: [
            { label: teamOne.name, data: stages.map(stage => teamOne.simulation[stage] * 100), borderColor: mmColors.green, backgroundColor: mmColors.greenSoft, fill: false, tension: 0.2, pointRadius: 4 },
            { label: teamTwo.name, data: stages.map(stage => teamTwo.simulation[stage] * 100), borderColor: mmColors.red, backgroundColor: mmColors.redSoft, fill: false, tension: 0.2, pointRadius: 4 }
        ] }, options: chartOptions({ percentage: true, xTitle: 'Tournament stage', yTitle: 'Probability of reaching stage', legend: true })
    });
    const playersOne = mmState.playersByTeam.get(teamOne.name).slice(0, 8);
    const playersTwo = mmState.playersByTeam.get(teamTwo.name).slice(0, 8);
    renderChart('matchupRoster', 'matchup-roster-chart', {
        type: 'bar', data: { labels: Array.from({ length: 8 }, (_, index) => `Roster No. ${index + 1}`), datasets: [
            { label: teamOne.name, data: playersOne.map(player => player.rating), backgroundColor: mmColors.green },
            { label: teamTwo.name, data: playersTwo.map(player => player.rating), backgroundColor: mmColors.red }
        ] }, options: chartOptions({ zeroBaseline: true, xTitle: 'Rating rank within roster', yTitle: 'Player Elo', legend: true })
    });
}

function renderRosterComparison(teamOne, teamTwo) {
    const first = mmState.playersByTeam.get(teamOne.name).slice(0, 10);
    const second = mmState.playersByTeam.get(teamTwo.name).slice(0, 10);
    byId('roster-heading-one').textContent = teamOne.name;
    byId('roster-heading-two').textContent = teamTwo.name;
    byId('matchup-roster-body').innerHTML = Array.from({ length: 10 }, (_, index) => `<tr><td>${first[index] ? `${escapeHtml(first[index].name)} | ${formatNumber(first[index].rating, 0)}` : '-'}</td><td>${index + 1}</td><td>${second[index] ? `${escapeHtml(second[index].name)} | ${formatNumber(second[index].rating, 0)}` : '-'}</td></tr>`).join('');
}

function gameMarkup(game) {
    const winnerIsOne = game.winner === game.teamOne;
    return `<article class="mm-bracket-game"><div class="${winnerIsOne ? 'winner' : ''}"><span>${game.teamOneSeed}</span><span>${escapeHtml(game.teamOne)}</span><strong>${formatNumber(game.teamOneElo, 0)}</strong></div><div class="${winnerIsOne ? '' : 'winner'}"><span>${game.teamTwoSeed}</span><span>${escapeHtml(game.teamTwo)}</span><strong>${formatNumber(game.teamTwoElo, 0)}</strong></div><p class="mm-game-meta">${escapeHtml(game.winner)} ${formatPercent(game.winnerProbability, 1)} | G${game.id}</p></article>`;
}

function renderBracket() {
    const region = mmState.bracketRegion;
    const selectedRound = byId('bracket-round').value;
    const regionGames = mmState.data.games.filter(game => game.region === region && game.round >= 2 && game.round <= 5);
    const visibleRounds = selectedRound === 'all' ? [2, 3, 4, 5] : [Number(selectedRound)];
    byId('bracket-board').style.gridTemplateColumns = `repeat(${visibleRounds.length}, minmax(220px, ${visibleRounds.length === 1 ? '1fr' : 'auto'}))`;
    byId('bracket-board').innerHTML = visibleRounds.map(round => `<section class="mm-bracket-round"><h3>${ROUND_LABELS[round]}</h3>${regionGames.filter(game => game.round === round).sort((a, b) => a.id - b.id).map(gameMarkup).join('')}</section>`).join('');
    const regionalFinal = regionGames.find(game => game.round === 5);
    const upsets = regionGames.filter(game => Number(game.winnerSeed) > Number(game.loserSeed));
    const closest = [...regionGames].sort((a, b) => Math.abs(a.winnerProbability - 0.5) - Math.abs(b.winnerProbability - 0.5))[0];
    byId('bracket-region-winner').textContent = regionalFinal ? `${regionalFinal.winner} (${regionalFinal.winnerSeed})` : '-';
    byId('bracket-upsets').textContent = `${upsets.length} model picks`;
    byId('bracket-closest').textContent = closest ? `${closest.winner} ${formatPercent(closest.winnerProbability, 1)}` : '-';
    byId('first-four-games').innerHTML = mmState.data.games.filter(game => game.round === 1).sort((a, b) => a.id - b.id).map(game => `${gameMarkup(game)}${game.status === 'completed' ? '<span class="sr-only">Completed result</span>' : ''}`).join('');
    byId('national-bracket-games').innerHTML = mmState.data.games.filter(game => game.round >= 6).sort((a, b) => a.id - b.id).map(gameMarkup).join('');
}

function filteredSimulationTeams() {
    const query = byId('simulation-search').value.trim().toLowerCase();
    const region = byId('simulation-region').value;
    const stage = byId('simulation-stage').value;
    return mmState.data.teams.filter(team => (!query || team.name.toLowerCase().includes(query)) && (region === 'all' || team.region === region)).sort((a, b) => b.simulation[stage] - a.simulation[stage] || b.rating - a.rating);
}

function renderSimulation() {
    const stage = byId('simulation-stage').value;
    const rows = filteredSimulationTeams();
    const favorite = [...mmState.data.teams].sort((a, b) => b.simulation.champion - a.simulation.champion)[0];
    byId('simulation-winner-name').textContent = favorite.name;
    byId('simulation-winner-meta').textContent = `${favorite.region} | No. ${favorite.seed} seed | ${formatNumber(favorite.rating, 1)} Elo`;
    byId('simulation-winner-probability').textContent = formatPercent(favorite.simulation.champion, 1);
    byId('simulation-region-favorites').innerHTML = ['EAST', 'WEST', 'SOUTH', 'MIDWEST'].map(region => {
        const team = mmState.data.teams.filter(item => item.region === region).sort((a, b) => b.simulation.finalFour - a.simulation.finalFour)[0];
        return `<div><span>${region}</span><strong>${escapeHtml(team.name)}</strong><small>${formatPercent(team.simulation.finalFour, 1)} Final Four</small></div>`;
    }).join('');
    byId('simulation-chart-heading').textContent = `${STAGE_LABELS[stage]} Probability`;
    byId('simulation-result-count').textContent = `${formatNumber(rows.length)} teams`;
    byId('simulation-table-body').innerHTML = rows.map((team, index) => `<tr><td>${index + 1}</td><td><button class="mm-team-button" type="button" data-team-matchup="${escapeHtml(team.name)}">${escapeHtml(team.name)}</button></td><td>${team.seed}</td><td>${formatPercent(team.simulation.roundOf32, 1)}</td><td>${formatPercent(team.simulation.sweet16, 1)}</td><td>${formatPercent(team.simulation.eliteEight, 1)}</td><td>${formatPercent(team.simulation.finalFour, 1)}</td><td>${formatPercent(team.simulation.titleGame, 1)}</td><td>${formatPercent(team.simulation.champion, 1)}</td></tr>`).join('');
    renderChart('simulation', 'simulation-chart', {
        type: 'bar', data: { labels: rows.slice(0, 20).map(team => team.name), datasets: [{ label: `${STAGE_LABELS[stage]} probability`, data: rows.slice(0, 20).map(team => team.simulation[stage] * 100), backgroundColor: stage === 'champion' ? mmColors.gold : mmColors.blue, borderRadius: 3 }] },
        options: chartOptions({ horizontal: true, percentage: true, xTitle: `Probability of reaching ${STAGE_LABELS[stage]}`, yTitle: 'Tournament team' })
    });
}

function filteredPlayers() {
    const query = byId('player-search').value.trim().toLowerCase();
    const team = byId('player-team').value;
    const region = byId('player-region').value;
    return mmState.data.players.filter(player => (!query || `${player.name} ${player.team}`.toLowerCase().includes(query)) && (team === 'all' || player.team === team) && (region === 'all' || player.region === region));
}

function renderPlayers() {
    const rows = filteredPlayers();
    const pageSize = Number(byId('player-page-size').value);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    mmState.playerPage = Math.min(Math.max(1, mmState.playerPage), pages);
    const offset = (mmState.playerPage - 1) * pageSize;
    byId('player-result-count').textContent = `${formatNumber(rows.length)} players`;
    byId('player-page-status').textContent = `Page ${mmState.playerPage} of ${pages}`;
    byId('player-previous').disabled = mmState.playerPage <= 1;
    byId('player-next').disabled = mmState.playerPage >= pages;
    byId('player-table-body').innerHTML = rows.slice(offset, offset + pageSize).map(player => `<tr><td>${player.overallRank}</td><td><button class="mm-player-button" type="button" data-player-team="${escapeHtml(player.team)}">${escapeHtml(player.name)}</button></td><td>${escapeHtml(player.team)}</td><td>${player.region}</td><td>${player.seed}</td><td>${formatNumber(player.rating, 1)}</td><td>${player.teamRank}</td></tr>`).join('');
    renderChart('playerRating', 'player-rating-chart', {
        type: 'bar', data: { labels: rows.slice(0, 16).map(player => `${player.name} | ${player.team}`), datasets: [{ label: 'Player Elo', data: rows.slice(0, 16).map(player => player.rating), backgroundColor: mmColors.green, borderRadius: 3 }] },
        options: chartOptions({ horizontal: true, zeroBaseline: true, xTitle: 'Individual player Elo', yTitle: 'Tournament player and team' })
    });
}

function renderCalibrationChart(key, canvasId) {
    const bins = mmState.data.backtest.calibration.filter(bin => bin.games > 0);
    renderChart(key, canvasId, {
        type: 'line', data: { labels: bins.map(bin => bin.bucket), datasets: [
            { label: 'Model confidence', data: bins.map(bin => bin.averageProbability * 100), borderColor: mmColors.blue, backgroundColor: mmColors.blueSoft, tension: 0.2, pointRadius: 4 },
            { label: 'Historical hit rate', data: bins.map(bin => bin.hitRate * 100), borderColor: mmColors.green, backgroundColor: mmColors.greenSoft, tension: 0.2, pointRadius: 4 }
        ] }, options: chartOptions({ percentage: true, xTitle: 'Favorite probability bucket', yTitle: 'Probability or historical win rate', legend: true })
    });
}

function renderModel() {
    const { model, backtest } = mmState.data;
    byId('model-base-elo').textContent = formatNumber(model.baseElo);
    byId('model-k-factor').textContent = formatNumber(model.kFactor);
    byId('model-regression').textContent = formatPercent(model.offseasonRegression, 0);
    byId('model-log-loss').textContent = formatNumber(backtest.logLoss, 4);
    byId('model-brier').textContent = formatNumber(backtest.brier, 4);
    byId('model-ece').textContent = formatNumber(backtest.ece, 4);
    renderCalibrationChart('modelCalibration', 'model-calibration-chart');
    const bins = backtest.calibration.filter(bin => bin.games > 0);
    renderChart('modelSamples', 'model-sample-chart', {
        type: 'bar', data: { labels: bins.map(bin => bin.bucket), datasets: [{ label: 'Historical games', data: bins.map(bin => bin.games), backgroundColor: mmColors.gold, borderRadius: 3 }] },
        options: chartOptions({ zeroBaseline: true, xTitle: 'Favorite probability bucket', yTitle: 'Historical games' })
    });
}

function bindEvents() {
    document.querySelectorAll('[data-mm-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.mmView)));
    window.addEventListener('hashchange', () => setView(window.location.hash.slice(1), false));
    ['team-search', 'team-region', 'team-seed', 'team-sort'].forEach(id => byId(id).addEventListener('input', renderTeams));
    byId('team-filters').addEventListener('reset', () => window.setTimeout(renderTeams));
    document.addEventListener('click', event => {
        const teamButton = event.target.closest('[data-team-matchup], [data-player-team]');
        if (teamButton) {
            const name = teamButton.dataset.teamMatchup || teamButton.dataset.playerTeam;
            setMatchupTeam('one', name, false);
            if (byId('matchup-team-two').dataset.selectedName === name) {
                setMatchupTeam('two', mmState.data.teams.find(team => team.name !== name).name, false);
            }
            setView('matchup');
        }
        const infoButton = event.target.closest('[data-chart-info]');
        if (infoButton) openChartInfo(infoButton.dataset.chartInfo);
        document.querySelectorAll('.mm-team-picker').forEach(picker => {
            if (!picker.contains(event.target)) restoreTeamSearch(picker.querySelector('input'));
        });
    });
    byId('matchup-controls').addEventListener('input', event => {
        const input = event.target.closest('#matchup-team-one, #matchup-team-two');
        if (input) renderTeamSearch(input);
    });
    byId('matchup-controls').addEventListener('focusin', event => {
        const input = event.target.closest('#matchup-team-one, #matchup-team-two');
        if (!input) return;
        input.select();
        renderTeamSearch(input);
    });
    byId('matchup-controls').addEventListener('keydown', event => {
        const input = event.target.closest('#matchup-team-one, #matchup-team-two');
        if (!input) return;
        const side = input.id.endsWith('one') ? 'one' : 'two';
        const first = byId(`matchup-results-${side}`).querySelector('[data-team-search-result]');
        if (event.key === 'Enter') {
            event.preventDefault();
            if (first) {
                setMatchupTeam(side, first.dataset.teamSearchResult);
                restoreTeamSearch(input);
            } else input.setAttribute('aria-invalid', 'true');
        } else if (event.key === 'ArrowDown' && first) {
            event.preventDefault();
            first.focus();
        } else if (event.key === 'Escape') restoreTeamSearch(input);
    });
    byId('matchup-controls').addEventListener('click', event => {
        const result = event.target.closest('[data-team-search-result]');
        if (!result) return;
        setMatchupTeam(result.dataset.targetSide, result.dataset.teamSearchResult);
        restoreTeamSearch(byId(`matchup-team-${result.dataset.targetSide}`));
    });
    byId('swap-matchup').addEventListener('click', () => {
        const first = byId('matchup-team-one').dataset.selectedName;
        const second = byId('matchup-team-two').dataset.selectedName;
        setMatchupTeam('one', second, false);
        setMatchupTeam('two', first, false);
        renderMatchup();
    });
    byId('bracket-region-tabs').addEventListener('click', event => {
        const button = event.target.closest('[data-bracket-region]');
        if (!button) return;
        mmState.bracketRegion = button.dataset.bracketRegion;
        document.querySelectorAll('[data-bracket-region]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
        renderBracket();
    });
    byId('bracket-round').addEventListener('change', renderBracket);
    ['simulation-search', 'simulation-region', 'simulation-stage'].forEach(id => byId(id).addEventListener('input', renderSimulation));
    byId('simulation-filters').addEventListener('reset', () => window.setTimeout(renderSimulation));
    ['player-search', 'player-team', 'player-region', 'player-page-size'].forEach(id => byId(id).addEventListener('input', () => { mmState.playerPage = 1; renderPlayers(); }));
    byId('player-filters').addEventListener('reset', () => window.setTimeout(() => { mmState.playerPage = 1; renderPlayers(); }));
    byId('player-previous').addEventListener('click', () => { mmState.playerPage -= 1; renderPlayers(); });
    byId('player-next').addEventListener('click', () => { mmState.playerPage += 1; renderPlayers(); });
    byId('mm-info-close').addEventListener('click', () => byId('mm-info-dialog').close());
}

async function initialize() {
    try {
        const response = await fetch(MARCH_MADNESS_DATA_URL);
        if (!response.ok) throw new Error(`Dashboard data returned ${response.status}`);
        mmState.data = await response.json();
        mmState.teamMap = new Map(mmState.data.teams.map(team => [team.name, team]));
        mmState.playersByTeam = new Map(mmState.data.teams.map(team => [team.name, mmState.data.players.filter(player => player.team === team.name)]));
        byId('snapshot-generated').textContent = formatDate(mmState.data.meta.generatedAt.slice(0, 10));
        byId('snapshot-cutoff').textContent = formatDate(mmState.data.meta.cutoff);
        const regions = ['EAST', 'WEST', 'SOUTH', 'MIDWEST'];
        populateSelect(byId('team-region'), regions);
        populateSelect(byId('simulation-region'), regions);
        populateSelect(byId('player-region'), regions);
        populateSelect(byId('team-seed'), Array.from({ length: 16 }, (_, index) => String(index + 1)));
        populateSelect(byId('player-team'), mmState.data.teams.map(team => team.name).sort());
        byId('bracket-region-tabs').innerHTML = regions.map((region, index) => `<button type="button" data-bracket-region="${region}" aria-pressed="${index === 0}">${region}</button>`).join('');
        setMatchupTeam('one', mmState.teamMap.has('Michigan') ? 'Michigan' : mmState.data.teams[0].name, false);
        setMatchupTeam('two', mmState.teamMap.has('Duke') ? 'Duke' : mmState.data.teams[1].name, false);
        setupChartInfo();
        bindEvents();
        byId('mm-loading').hidden = true;
        setView(window.location.hash.slice(1) || 'overview', false);
    } catch (error) {
        byId('mm-loading').textContent = `Unable to load the March Madness Predictor: ${error.message}`;
        console.error(error);
    }
}

initialize();
