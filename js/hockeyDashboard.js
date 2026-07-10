const HOCKEY_DATA_URL = `data/hockey-dashboard.json?v=${Date.now()}`;

const hockeyState = {
    data: null,
    teamMap: new Map(),
    playoffMap: new Map(),
    currentPlayerMap: new Map(),
    ratingCatalog: [],
    ratingCatalogMap: new Map(),
    charts: new Map(),
    currentView: 'overview',
    renderedViews: new Set(),
    playerPage: 1,
    simulationResult: null,
    rosterChanges: { one: [], two: [] },
    nextRosterChangeId: 1
};

const hockeyColors = {
    ink: '#121820',
    muted: '#66727f',
    line: '#dbe3e8',
    ice: '#007f91',
    red: '#d34855',
    lime: '#718f22',
    gold: '#aa741d',
    blue: '#335fa8',
    iceSoft: 'rgba(0, 127, 145, 0.18)',
    redSoft: 'rgba(211, 72, 85, 0.18)',
    blueSoft: 'rgba(51, 95, 168, 0.18)'
};

const parameterCatalog = {
    w_f: ['Forward roster weight', 'Team composition'],
    w_d: ['Defense roster weight', 'Team composition'],
    w_g: ['Goalie roster weight', 'Team composition'],
    forward_team_k: ['Forward team K', 'Game result update'],
    defense_team_k: ['Defense team K', 'Game result update'],
    goalie_team_k: ['Goalie team K', 'Game result update'],
    forward_individual_k: ['Forward individual K', 'Player impact update'],
    defense_individual_k: ['Defense individual K', 'Player impact update'],
    goalie_individual_k: ['Goalie individual K', 'Player impact update'],
    forward_scale: ['Forward impact scale', 'Impact bounding'],
    defense_scale: ['Defense impact scale', 'Impact bounding'],
    goalie_scale: ['Goalie impact scale', 'Impact bounding'],
    forward_goal_weight: ['Forward goal weight', 'Skater performance'],
    forward_assist_weight: ['Forward assist weight', 'Skater performance'],
    forward_plus_minus_weight: ['Forward plus-minus weight', 'Skater performance'],
    forward_toi_share_weight: ['Forward usage weight', 'Skater performance'],
    defense_goal_weight: ['Defense goal weight', 'Skater performance'],
    defense_assist_weight: ['Defense assist weight', 'Skater performance'],
    defense_plus_minus_weight: ['Defense plus-minus weight', 'Skater performance'],
    defense_toi_share_weight: ['Defense usage weight', 'Skater performance'],
    goalie_save_pct_multiplier: ['Goalie save impact', 'Goalie performance'],
    league_average_save_pct: ['League average save rate', 'Goalie baseline']
};

const chartInfoCatalog = {
    'overview-team-chart': {
        title: 'Highest Team Ratings',
        description: 'Ranks the twelve strongest frozen team snapshots by player-derived Elo before the prediction window.',
        xAxis: 'Team Elo rating. A larger value indicates a stronger current roster snapshot.',
        yAxis: 'NHL teams, ordered from the highest rating to the lowest rating shown.',
        note: 'The bar axis begins at zero so bar lengths remain proportional. This is a strength rating, not standings points.'
    },
    'overview-scatter-chart': {
        title: 'Rating vs. Standings Points',
        description: 'Compares model-assessed roster strength with actual standings points at the frozen snapshot.',
        xAxis: 'Team Elo rating.',
        yAxis: 'Standings points accumulated through the snapshot date.',
        note: 'Teams far above or below the overall pattern have a larger disagreement between rating strength and season results.'
    },
    'overview-calibration-chart': {
        title: 'Prediction Calibration',
        description: 'Checks whether historical favorites won as often as their predicted probabilities implied.',
        xAxis: 'Favorite win-probability bucket.',
        yAxis: 'Average predicted or observed win rate within each bucket.',
        note: 'Closer lines indicate better calibration. Buckets with fewer than 25 games are excluded from this graph.'
    },
    'team-ratings-chart': {
        title: 'Filtered Team Ratings',
        description: 'Displays team Elo for the clubs remaining after the active team filters and sort order are applied.',
        xAxis: 'Team Elo rating.',
        yAxis: 'Filtered NHL teams.',
        note: 'The rating bars use a zero baseline. Eastern teams are teal and Western teams are red.'
    },
    'team-playoff-chart': {
        title: 'Playoff Probability',
        description: 'Shows each filtered team\'s chance of reaching the playoffs in the published 20,000-run simulation.',
        xAxis: 'Probability of making the playoffs.',
        yAxis: 'Filtered NHL teams.',
        note: 'These probabilities use the frozen March 19, 2026 standings and remaining schedule.'
    },
    'player-ratings-chart': {
        title: 'Player Ratings',
        description: 'Ranks the leading players in the currently filtered player dataset.',
        xAxis: 'Current Elo or all-time peak Elo, depending on the selected leaderboard.',
        yAxis: 'Filtered NHL players.',
        note: 'The rating bars use a zero baseline. Colors identify forwards, defensemen, and goalies.'
    },
    'goalie-ratings-chart': {
        title: 'Goalie Ratings',
        description: 'Provides a goalie-only ranking without mixing goalie Elo values with skater ratings.',
        xAxis: 'Current goalie Elo or all-time peak goalie Elo.',
        yAxis: 'Filtered goalies, ordered from highest to lowest rating.',
        note: 'The rating bars use a zero baseline. Goalie updates also include saves above or below the tuned league-average save percentage.'
    },
    'matchup-comparison-chart': {
        title: 'Team Profile Comparison',
        description: 'Compares the selected teams across league-relative strength and published postseason probabilities.',
        xAxis: 'Profile category: scenario Elo percentile, points percentile, playoff probability, Cup Final probability, and Cup probability.',
        yAxis: 'Relative score or probability from 0% to 100%.',
        note: 'Roster edits affect the Elo percentile. Published playoff fields remain tied to the frozen original simulation.'
    },
    'schedule-chart': {
        title: 'Most Decisive Forecasts',
        description: 'Ranks the strongest favorites among games remaining after schedule filters are applied.',
        xAxis: 'Favorite win probability.',
        yAxis: 'Model pick and opponent for each matchup.',
        note: 'The axis begins at 50% because every displayed value is the favorite side of a two-team forecast. Teal bars are home-team picks; red bars are away-team picks.'
    },
    'simulation-standings-chart': {
        title: 'Average Final Standings',
        description: 'Ranks teams by average final point total across the most recent browser simulation run.',
        xAxis: 'Average simulated final standings points.',
        yAxis: 'Top sixteen projected NHL teams.',
        note: 'The points bars use a zero baseline. The browser simulation starts from the frozen standings and replays all 230 remaining games.'
    },
    'simulation-cup-chart': {
        title: 'Stanley Cup Probability',
        description: 'Ranks teams by how often they won the Stanley Cup in the most recent browser simulation run.',
        xAxis: 'Share of simulations ending in a Stanley Cup championship.',
        yAxis: 'The sixteen teams with the highest simulated championship probability.',
        note: 'Playoffs use NHL division and wildcard seeding followed by best-of-seven series.'
    },
    'published-playoff-chart': {
        title: 'Generated Playoff Progression',
        description: 'Compares advancement probabilities from the locally generated 20,000-run engine benchmark.',
        xAxis: 'Probability of reaching the selected postseason stage.',
        yAxis: 'Teams ordered by published championship probability.',
        note: 'Each group separates making the playoffs, reaching the Cup Final, and winning the championship.'
    },
    'model-validation-chart': {
        title: 'Accuracy by Validation Season',
        description: 'Shows favorite-pick accuracy across the four chronological validation folds used during tuning.',
        xAxis: 'NHL validation season.',
        yAxis: 'Percentage of games where the higher-probability team won.',
        note: 'Because this is a line chart comparing a narrow validation band, the y-axis focuses on 50%-65%. Model selection minimized probability error rather than maximizing accuracy alone.'
    },
    'model-weights-chart': {
        title: 'Optimized Position Weights',
        description: 'Shows the tuned share assigned to forwards, defensemen, and goalies when constructing pregame team Elo.',
        xAxis: 'Not applicable; this is a composition chart.',
        yAxis: 'Not applicable; slice area represents each positional weight.',
        note: 'The three normalized production weights sum to 100%.'
    }
};

const byId = (id) => document.getElementById(id);
const formatNumber = (value, digits = 0) => Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
});
const formatPercent = (value, digits = 1) => `${formatNumber(value * 100, digits)}%`;
const formatDate = (value) => new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
}).format(new Date(`${value}T12:00:00`));
const escapeHtml = (value) => String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

function chartBaseOptions({ horizontal = false, percentage = false, zeroBaseline = false, xTitle = '', yTitle = '' } = {}) {
    const valueScale = horizontal ? 'x' : 'y';
    const categoryScale = horizontal ? 'y' : 'x';
    return {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: horizontal ? 'y' : 'x',
        animation: { duration: 300 },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
            legend: { labels: { color: hockeyColors.muted, boxWidth: 12, font: { size: 11, weight: 700 } } },
            tooltip: { backgroundColor: hockeyColors.ink, padding: 11, titleFont: { weight: 800 } }
        },
        scales: {
            [valueScale]: {
                beginAtZero: percentage || zeroBaseline,
                min: percentage || zeroBaseline ? 0 : undefined,
                max: percentage ? 100 : undefined,
                grid: { color: hockeyColors.line },
                ticks: {
                    color: hockeyColors.muted,
                    callback: percentage ? (value) => `${value}%` : undefined
                },
                title: { display: Boolean(horizontal ? xTitle : yTitle), text: horizontal ? xTitle : yTitle, color: hockeyColors.muted, font: { size: 11, weight: 700 } }
            },
            [categoryScale]: {
                grid: { display: false },
                ticks: { color: hockeyColors.muted },
                title: { display: Boolean(horizontal ? yTitle : xTitle), text: horizontal ? yTitle : xTitle, color: hockeyColors.muted, font: { size: 11, weight: 700 } }
            }
        }
    };
}

function renderChart(key, canvasId, config) {
    hockeyState.charts.get(key)?.destroy();
    const canvas = byId(canvasId);
    if (!canvas) return;
    hockeyState.charts.set(key, new Chart(canvas, config));
}

function fairAmericanOdds(probability) {
    if (probability <= 0 || probability >= 1) return '-';
    const value = probability >= 0.5
        ? -100 * probability / (1 - probability)
        : 100 * (1 - probability) / probability;
    const rounded = Math.round(value);
    return rounded > 0 ? `+${rounded}` : String(rounded);
}

function fairOddsText(probability) {
    return `${fairAmericanOdds(probability)} | ${(1 / Math.max(0.001, probability)).toFixed(2)} decimal`;
}

function expectedScore(ratingA, ratingB) {
    return 1 / (1 + 10 ** ((ratingB - ratingA) / 400));
}

function getCalibration(probability) {
    const favoriteProbability = Math.max(probability, 1 - probability);
    const populated = hockeyState.data.backtest.calibration.filter((bucket) => bucket.games >= 25);
    return populated.reduce((best, bucket) => (
        Math.abs(bucket.averageProbability - favoriteProbability) < Math.abs(best.averageProbability - favoriteProbability)
            ? bucket : best
    ), populated[0]);
}

function percentile(value, values) {
    const sorted = [...values].sort((a, b) => a - b);
    const below = sorted.filter((item) => item <= value).length;
    return Math.round((below / sorted.length) * 100);
}

function populateSelect(select, values, selectedValue) {
    const options = values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('');
    select.insertAdjacentHTML('beforeend', options);
    if (selectedValue && values.includes(selectedValue)) select.value = selectedValue;
}

function setupChartInfo() {
    document.querySelectorAll('.hockey-chart-frame canvas').forEach((canvas) => {
        if (!chartInfoCatalog[canvas.id]) return;
        const header = canvas.closest('.hockey-chart-frame')?.querySelector(':scope > header');
        if (!header || header.querySelector(`[data-chart-info="${canvas.id}"]`)) return;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'hockey-info-button';
        button.dataset.chartInfo = canvas.id;
        button.textContent = 'i';
        button.title = `More information about ${chartInfoCatalog[canvas.id].title}`;
        button.setAttribute('aria-label', `More information about ${chartInfoCatalog[canvas.id].title}`);
        header.append(button);
    });
}

function openChartInfo(chartId) {
    const info = chartInfoCatalog[chartId];
    if (!info) return;
    byId('chart-info-title').textContent = info.title;
    byId('chart-info-description').textContent = info.description;
    byId('chart-info-x-axis').textContent = info.xAxis;
    byId('chart-info-y-axis').textContent = info.yAxis;
    byId('chart-info-note').textContent = info.note;
    const dialog = byId('chart-info-dialog');
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
}

function setupMetadata() {
    const { meta, backtest, teams, currentPlayers, schedule, model } = hockeyState.data;
    const generated = new Date(meta.generatedAt);
    byId('snapshot-generated').textContent = new Intl.DateTimeFormat('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
    }).format(generated);
    byId('snapshot-through').textContent = formatDate(meta.dataEnd);
    byId('metric-games').textContent = formatNumber(backtest.games);
    byId('metric-teams').textContent = formatNumber(teams.length);
    byId('metric-players').textContent = formatNumber(currentPlayers.length);
    byId('metric-schedule').textContent = formatNumber(schedule.length);
    byId('metric-accuracy').textContent = formatPercent(backtest.accuracy);
    byId('model-trials').textContent = `${formatNumber(model.completedTrials)} tuning trials`;

    const teamNames = teams.map((team) => team.name).sort();
    populateSelect(byId('player-team'), teamNames);
    populateSelect(byId('goalie-team'), teamNames);
    populateSelect(byId('schedule-team'), teamNames);
    populateSelect(byId('matchup-team-one'), teamNames, 'Tampa Bay Lightning');
    populateSelect(byId('matchup-team-two'), teamNames, 'Colorado Avalanche');
    const dates = [...new Set(schedule.map((game) => game.date))].sort();
    populateSelect(byId('schedule-date'), dates);
    const nationalities = [...new Set(hockeyState.data.historicPlayers.map((player) => player.nationality))].sort();
    populateSelect(byId('player-nationality'), nationalities);
}

function setView(view, updateHash = true) {
    const validViews = ['overview', 'teams', 'players', 'matchup', 'schedule', 'simulation', 'model'];
    if (!validViews.includes(view)) view = 'overview';
    hockeyState.currentView = view;
    document.querySelectorAll('[data-hockey-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.hockeyPanel !== view;
    });
    document.querySelectorAll('[data-hockey-view]').forEach((button) => {
        if (button.getAttribute('role') === 'tab') {
            button.setAttribute('aria-selected', String(button.dataset.hockeyView === view));
        }
    });
    if (updateHash && window.location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
    requestAnimationFrame(() => renderView(view));
}

function renderView(view) {
    if (view === 'overview') renderOverview();
    if (view === 'teams') renderTeams();
    if (view === 'players') renderPlayers();
    if (view === 'matchup') renderMatchup();
    if (view === 'schedule') renderSchedule();
    if (view === 'simulation') {
        renderPublishedPlayoffs();
        if (!hockeyState.simulationResult) runSeasonSimulation();
    }
    if (view === 'model') renderModel();
    hockeyState.renderedViews.add(view);
}

function renderOverview() {
    const teams = hockeyState.data.teams;
    const top = teams.slice(0, 12);
    renderChart('overviewTeams', 'overview-team-chart', {
        type: 'bar',
        data: {
            labels: top.map((team) => team.name),
            datasets: [{ label: 'Team Elo', data: top.map((team) => team.rating), backgroundColor: hockeyColors.ice }]
        },
        options: {
            ...chartBaseOptions({ horizontal: true, xTitle: 'Team Elo rating', yTitle: 'NHL team' }),
            indexAxis: 'y',
            plugins: { ...chartBaseOptions().plugins, legend: { display: false } },
            scales: {
                x: { min: 0, title: { display: true, text: 'Team Elo rating' }, grid: { color: hockeyColors.line }, ticks: { color: hockeyColors.muted } },
                y: { title: { display: true, text: 'NHL team' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 11, weight: 700 } } }
            }
        }
    });
    renderChart('overviewScatter', 'overview-scatter-chart', {
        type: 'scatter',
        data: {
            datasets: [
                { label: 'Eastern', data: teams.filter((team) => team.conference === 'Eastern').map((team) => ({ x: team.rating, y: team.points, team: team.name })), backgroundColor: hockeyColors.ice },
                { label: 'Western', data: teams.filter((team) => team.conference === 'Western').map((team) => ({ x: team.rating, y: team.points, team: team.name })), backgroundColor: hockeyColors.red }
            ]
        },
        options: {
            ...chartBaseOptions(),
            plugins: {
                ...chartBaseOptions().plugins,
                tooltip: { callbacks: { label: (context) => `${context.raw.team}: ${context.raw.x.toFixed(1)} Elo, ${context.raw.y} pts` } }
            },
            scales: {
                x: { title: { display: true, text: 'Team Elo rating' }, grid: { color: hockeyColors.line }, ticks: { color: hockeyColors.muted } },
                y: { title: { display: true, text: 'Standings points at snapshot' }, grid: { color: hockeyColors.line }, ticks: { color: hockeyColors.muted } }
            }
        }
    });
    const calibration = hockeyState.data.backtest.calibration.filter((bucket) => bucket.games >= 25);
    renderChart('overviewCalibration', 'overview-calibration-chart', {
        type: 'line',
        data: {
            labels: calibration.map((bucket) => bucket.bucket),
            datasets: [
                { label: 'Predicted', data: calibration.map((bucket) => bucket.averageProbability * 100), borderColor: hockeyColors.blue, backgroundColor: hockeyColors.blueSoft, tension: 0.25, pointRadius: 4 },
                { label: 'Observed', data: calibration.map((bucket) => bucket.hitRate * 100), borderColor: hockeyColors.red, backgroundColor: hockeyColors.redSoft, tension: 0.25, pointRadius: 4 }
            ]
        },
        options: chartBaseOptions({ percentage: true, xTitle: 'Favorite win-probability bucket', yTitle: 'Predicted or observed win rate' })
    });
}

function filteredTeams() {
    const query = byId('team-search').value.trim().toLowerCase();
    const conference = byId('team-conference').value;
    const division = byId('team-division').value;
    const sort = byId('team-sort').value;
    const rows = hockeyState.data.teams.filter((team) =>
        (!query || team.name.toLowerCase().includes(query)) &&
        (conference === 'all' || team.conference === conference) &&
        (division === 'all' || team.division === division)
    );
    const playoff = (team) => hockeyState.playoffMap.get(team.name) || {};
    rows.sort((a, b) => {
        if (sort === 'points-desc') return b.points - a.points || b.rating - a.rating;
        if (sort === 'cup-desc') return (playoff(b).champion || 0) - (playoff(a).champion || 0);
        if (sort === 'name-asc') return a.name.localeCompare(b.name);
        return b.rating - a.rating;
    });
    return rows;
}

function renderTeams() {
    const rows = filteredTeams();
    byId('team-count').textContent = `${formatNumber(rows.length)} teams`;
    byId('team-table-body').innerHTML = rows.length ? rows.map((team, index) => {
        const odds = hockeyState.playoffMap.get(team.name) || {};
        return `<tr>
            <td class="hockey-rank">${index + 1}</td><td class="hockey-team-name">${escapeHtml(team.name)}</td>
            <td>${team.conference}</td><td>${team.division}</td><td class="hockey-rating">${formatNumber(team.rating, 1)}</td>
            <td>${team.points}</td><td>${team.rosterSize}</td><td>${formatPercent(odds.makePlayoffs || 0)}</td>
            <td>${formatPercent(odds.champion || 0)}</td><td>${formatDate(team.lastGame)}</td>
        </tr>`;
    }).join('') : '<tr><td class="hockey-empty" colspan="10">No teams match these filters.</td></tr>';

    const chartRows = rows.slice(0, 16);
    renderChart('teamRatings', 'team-ratings-chart', {
        type: 'bar', data: { labels: chartRows.map((team) => team.name), datasets: [{ data: chartRows.map((team) => team.rating), backgroundColor: chartRows.map((team) => team.conference === 'Eastern' ? hockeyColors.ice : hockeyColors.red) }] },
        options: { ...chartBaseOptions({ horizontal: true, zeroBaseline: true, xTitle: 'Team Elo rating', yTitle: 'NHL team' }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: 0, title: { display: true, text: 'Team Elo rating' }, grid: { color: hockeyColors.line } }, y: { title: { display: true, text: 'NHL team' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
    renderChart('teamPlayoffs', 'team-playoff-chart', {
        type: 'bar', data: { labels: chartRows.map((team) => team.name), datasets: [{ data: chartRows.map((team) => (hockeyState.playoffMap.get(team.name)?.makePlayoffs || 0) * 100), backgroundColor: hockeyColors.lime }] },
        options: { ...chartBaseOptions({ horizontal: true, percentage: true, xTitle: 'Probability of making playoffs', yTitle: 'NHL team' }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } } }
    });
}

function playerRows() {
    const mode = byId('player-mode').value;
    const query = byId('player-search').value.trim().toLowerCase();
    const position = byId('player-position').value;
    const team = byId('player-team').value;
    const nationality = byId('player-nationality').value;
    const source = mode === 'historic' ? hockeyState.data.historicPlayers : hockeyState.data.currentPlayers;
    return source.filter((player) =>
        (!query || player.name.toLowerCase().includes(query)) &&
        (position === 'all' || player.position === position) &&
        (team === 'all' || player.team === team) &&
        (mode !== 'historic' || nationality === 'all' || player.nationality === nationality)
    ).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

function renderPlayers() {
    const mode = byId('player-mode').value;
    const historic = mode === 'historic';
    byId('nationality-filter-wrap').hidden = !historic;
    byId('player-country-heading').hidden = !historic;
    byId('player-rating-heading').textContent = historic ? 'Peak Elo' : 'Current Elo';
    byId('player-date-heading').textContent = historic ? 'Peak date' : 'Last game';
    byId('player-chart-title').textContent = historic ? 'Highest All-Time Player Peaks' : 'Highest Current Player Ratings';
    const rows = playerRows();
    const pageSize = Number(byId('player-page-size').value);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    hockeyState.playerPage = Math.min(hockeyState.playerPage, pages);
    const start = (hockeyState.playerPage - 1) * pageSize;
    byId('player-count').textContent = `${formatNumber(rows.length)} players`;
    byId('player-page-status').textContent = `Page ${hockeyState.playerPage} of ${pages}`;
    byId('player-previous').disabled = hockeyState.playerPage <= 1;
    byId('player-next').disabled = hockeyState.playerPage >= pages;
    byId('player-table-body').innerHTML = rows.length ? rows.slice(start, start + pageSize).map((player, index) => `<tr>
        <td class="hockey-rank">${start + index + 1}</td><td class="hockey-player-name">${escapeHtml(player.name)}</td>
        <td><span class="hockey-pill">${player.position}</span></td><td>${escapeHtml(player.team)}</td>
        <td class="hockey-rating">${formatNumber(player.rating, 1)}</td><td>${formatDate(historic ? player.peakDate : player.lastGame)}</td>
        ${historic ? `<td>${player.nationality}</td>` : ''}</tr>`).join('') : `<tr><td class="hockey-empty" colspan="${historic ? 7 : 6}">No players match these filters.</td></tr>`;
    const chartRows = rows.slice(0, 15);
    renderChart('playerRatings', 'player-ratings-chart', {
        type: 'bar', data: { labels: chartRows.map((player) => player.name), datasets: [{ data: chartRows.map((player) => player.rating), backgroundColor: chartRows.map((player) => player.position === 'Forward' ? hockeyColors.ice : player.position === 'Defense' ? hockeyColors.blue : hockeyColors.red) }] },
        options: { ...chartBaseOptions({ horizontal: true, zeroBaseline: true, xTitle: historic ? 'All-time peak player Elo' : 'Current player Elo', yTitle: 'NHL player' }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: 0, title: { display: true, text: historic ? 'All-time peak player Elo' : 'Current player Elo' }, grid: { color: hockeyColors.line } }, y: { title: { display: true, text: 'NHL player' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
    renderGoalies();
}

function renderGoalies() {
    const historic = byId('goalie-mode').value === 'historic';
    const team = byId('goalie-team').value;
    const query = byId('goalie-search').value.trim().toLowerCase();
    const source = historic ? hockeyState.data.historicPlayers : hockeyState.data.currentPlayers;
    const goalies = source.filter((player) =>
        player.position === 'Goalie' &&
        (team === 'all' || player.team === team) &&
        (!query || player.name.toLowerCase().includes(query))
    ).sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
    byId('goalie-count').textContent = `${formatNumber(goalies.length)} goalies`;
    byId('goalie-chart-title').textContent = historic ? 'Highest All-Time Goalie Peaks' : 'Highest Current Goalie Ratings';
    byId('goalie-rating-heading').textContent = historic ? 'Peak Elo' : 'Current Elo';
    byId('goalie-date-heading').textContent = historic ? 'Peak date' : 'Last game';
    byId('goalie-country-heading').hidden = !historic;
    byId('goalie-table-body').innerHTML = goalies.length ? goalies.slice(0, 50).map((goalie, index) => `<tr>
        <td class="hockey-rank">${index + 1}</td><td class="hockey-player-name">${escapeHtml(goalie.name)}</td>
        <td>${escapeHtml(goalie.team)}</td><td class="hockey-rating">${formatNumber(goalie.rating, 1)}</td>
        <td>${formatDate(historic ? goalie.peakDate : goalie.lastGame)}</td>${historic ? `<td>${goalie.nationality}</td>` : ''}
    </tr>`).join('') : `<tr><td class="hockey-empty" colspan="${historic ? 6 : 5}">No goalies match these filters.</td></tr>`;
    const chartRows = goalies.slice(0, 15);
    renderChart('goalieRatings', 'goalie-ratings-chart', {
        type: 'bar',
        data: {
            labels: chartRows.map((goalie) => goalie.name),
            datasets: [{ data: chartRows.map((goalie) => goalie.rating), backgroundColor: hockeyColors.red }]
        },
        options: {
            ...chartBaseOptions({ horizontal: true, xTitle: historic ? 'All-time peak goalie Elo' : 'Current goalie Elo', yTitle: 'NHL goalie' }),
            indexAxis: 'y',
            plugins: { ...chartBaseOptions().plugins, legend: { display: false } },
            scales: {
                x: { min: 0, title: { display: true, text: historic ? 'All-time peak goalie Elo' : 'Current goalie Elo' }, grid: { color: hockeyColors.line } },
                y: { title: { display: true, text: 'NHL goalie' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } }
            }
        }
    });
}

function currentTeamRoster(teamName) {
    return hockeyState.data.currentPlayers.filter((player) => player.team === teamName);
}

function meanRating(players) {
    if (!players.length) return 1000;
    return players.reduce((sum, player) => sum + player.rating, 0) / players.length;
}

function rosterComponentRating(players) {
    const params = hockeyState.data.model.params;
    const forwards = players.filter((player) => player.position === 'Forward');
    const defense = players.filter((player) => player.position === 'Defense');
    const goalies = players.filter((player) => player.position === 'Goalie');
    return params.w_f * meanRating(forwards) + params.w_d * meanRating(defense) + params.w_g * meanRating(goalies);
}

function normalizePlayerSearch(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function ratingEntryLabel(entry) {
    const source = entry.source === 'current' ? 'Current' : 'Peak';
    const date = entry.peakDate ? ` | ${entry.peakDate}` : '';
    return `${entry.name} | ${source} Elo ${formatNumber(entry.rating, 0)} | ${entry.team} | ${entry.position}${date}`;
}

function buildRatingCatalog() {
    const current = hockeyState.data.currentPlayers.map((player, index) => ({
        ...player,
        key: `current:${index}`,
        source: 'current'
    }));
    const historic = hockeyState.data.historicPlayers.map((player, index) => ({
        ...player,
        key: `historic:${index}`,
        source: 'historic'
    }));
    hockeyState.ratingCatalog = [...current, ...historic].map((entry) => ({
        ...entry,
        searchText: normalizePlayerSearch(`${entry.name} ${entry.team} ${entry.position} ${entry.source} ${entry.nationality || ''} ${entry.rating}`)
    }));
    hockeyState.ratingCatalogMap = new Map(hockeyState.ratingCatalog.map((entry) => [entry.key, entry]));
}

function scenarioTeam(team, side) {
    const baseRoster = currentTeamRoster(team.name);
    const changes = hockeyState.rosterChanges[side].filter((change) => hockeyState.ratingCatalogMap.has(change.incomingKey));
    const outgoingNames = new Set(changes.map((change) => change.outgoingName));
    const scenarioRoster = baseRoster.filter((player) => !outgoingNames.has(player.name));
    changes.forEach((change) => {
        const incoming = hockeyState.ratingCatalogMap.get(change.incomingKey);
        if (incoming && !scenarioRoster.some((player) => player.name === incoming.name)) scenarioRoster.push(incoming);
    });
    const delta = rosterComponentRating(scenarioRoster) - rosterComponentRating(baseRoster);
    return { ...team, baseRating: team.rating, rating: team.rating + delta, ratingDelta: delta, scenarioRoster };
}

function rosterPlayerOptions(players, selectedName) {
    return players.map((player) => `<option value="${escapeHtml(player.name)}"${player.name === selectedName ? ' selected' : ''}>${escapeHtml(player.name)} (${player.position}, ${formatNumber(player.rating, 0)})</option>`).join('');
}

function eligibleRatingEntries(side, currentChangeId) {
    const team = hockeyState.teamMap.get(byId(`matchup-team-${side}`).value);
    if (!team) return [];
    const changes = hockeyState.rosterChanges[side];
    const outgoingNames = new Set(changes.map((change) => change.outgoingName));
    const retainedRosterNames = new Set(currentTeamRoster(team.name)
        .filter((player) => !outgoingNames.has(player.name))
        .map((player) => player.name));
    const usedKeys = new Set(changes
        .filter((change) => change.id !== currentChangeId && change.incomingKey)
        .map((change) => change.incomingKey));
    return hockeyState.ratingCatalog.filter((entry) => !retainedRosterNames.has(entry.name) && !usedKeys.has(entry.key));
}

function searchRatingEntries(query, side, changeId) {
    const normalized = normalizePlayerSearch(query);
    if (!normalized) return [];
    const tokens = normalized.split(' ').filter(Boolean);
    return eligibleRatingEntries(side, changeId)
        .filter((entry) => tokens.every((token) => entry.searchText.includes(token)))
        .sort((a, b) => {
            const nameA = normalizePlayerSearch(a.name);
            const nameB = normalizePlayerSearch(b.name);
            const scoreA = nameA === normalized ? 0 : nameA.startsWith(normalized) ? 1 : nameA.includes(normalized) ? 2 : 3;
            const scoreB = nameB === normalized ? 0 : nameB.startsWith(normalized) ? 1 : nameB.includes(normalized) ? 2 : 3;
            return scoreA - scoreB || (a.source === 'current' ? -1 : 1) - (b.source === 'current' ? -1 : 1) || b.rating - a.rating || a.name.localeCompare(b.name);
        })
        .slice(0, 12);
}

function renderRatingSearchResults(input, query = input.value) {
    const row = input.closest('.hockey-roster-change');
    if (!row) return;
    const side = row.dataset.side;
    const changeId = Number(row.dataset.changeId);
    const results = byId(input.getAttribute('aria-controls'));
    const matches = searchRatingEntries(query, side, changeId);
    results.innerHTML = matches.length ? matches.map((entry, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-rating-key="${entry.key}" data-side="${side}" data-change-id="${changeId}">
        <strong>${escapeHtml(entry.name)}</strong><em>${formatNumber(entry.rating, 0)} Elo</em>
        <span>${entry.source === 'current' ? 'Current rating' : `All-time peak${entry.peakDate ? ` on ${entry.peakDate}` : ''}`} | ${escapeHtml(entry.team)} | ${entry.position}${entry.nationality ? ` | ${entry.nationality}` : ''}</span>
    </button>`).join('') : `<div class="hockey-search-empty">${query.trim() ? 'No eligible rated players match this search.' : 'Type a player, team, position, or rating source.'}</div>`;
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-invalid', 'false');
}

function hideRatingSearch(input) {
    const results = byId(input.getAttribute('aria-controls'));
    if (results) results.hidden = true;
    input.setAttribute('aria-expanded', 'false');
}

function restoreRatingSearchInput(input) {
    const selected = hockeyState.ratingCatalogMap.get(input.dataset.selectedKey);
    input.value = selected ? ratingEntryLabel(selected) : '';
    input.setAttribute('aria-invalid', 'false');
    hideRatingSearch(input);
}

function selectRatingEntry(side, changeId, ratingKey) {
    const change = hockeyState.rosterChanges[side].find((item) => item.id === changeId);
    if (!change || !hockeyState.ratingCatalogMap.has(ratingKey)) return;
    change.incomingKey = ratingKey;
    renderMatchup();
}

function renderRosterChanges(side, team, scenario) {
    const changes = hockeyState.rosterChanges[side];
    const container = byId(`roster-changes-${side}`);
    const roster = currentTeamRoster(team.name).sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name));
    const usedOutgoing = new Set(changes.map((change) => change.outgoingName));
    container.innerHTML = changes.length ? changes.map((change) => {
        const outgoingOptions = roster.filter((player) => player.name === change.outgoingName || !usedOutgoing.has(player.name));
        const incoming = hockeyState.ratingCatalogMap.get(change.incomingKey);
        const inputId = `roster-player-search-${side}-${change.id}`;
        const resultsId = `roster-player-results-${side}-${change.id}`;
        return `<div class="hockey-roster-change" data-change-id="${change.id}" data-side="${side}">
            <label><span>Replace</span><select data-roster-field="outgoing">${rosterPlayerOptions(outgoingOptions, change.outgoingName)}</select></label>
            <span class="hockey-roster-arrow">&rarr;</span>
            <div class="hockey-player-picker">
                <label for="${inputId}">With any rated player</label>
                <input id="${inputId}" type="search" data-rating-search data-selected-key="${incoming?.key || ''}" role="combobox" aria-autocomplete="list" aria-controls="${resultsId}" aria-expanded="false" autocomplete="off" placeholder="Search all rated players" value="${incoming ? escapeHtml(ratingEntryLabel(incoming)) : ''}">
                <div id="${resultsId}" class="hockey-player-results" role="listbox" hidden></div>
            </div>
            <button class="hockey-remove-change" type="button" data-remove-roster-change="${change.id}" data-side="${side}" title="Remove roster change" aria-label="Remove roster change">&times;</button>
        </div>`;
    }).join('') : '<div class="hockey-roster-empty">Current frozen roster</div>';
    byId(`roster-team-${side}`).textContent = team.name;
    const delta = scenario.ratingDelta;
    const deltaClass = delta > 0.05 ? 'hockey-rating-delta-positive' : delta < -0.05 ? 'hockey-rating-delta-negative' : '';
    const deltaText = Math.abs(delta) < 0.05 ? 'base' : `${delta > 0 ? '+' : ''}${formatNumber(delta, 1)}`;
    byId(`roster-rating-${side}`).innerHTML = `${formatNumber(scenario.rating, 1)} <span class="${deltaClass}">(${deltaText})</span>`;
}

function addRosterChange(side) {
    const team = hockeyState.teamMap.get(byId(`matchup-team-${side}`).value);
    if (!team) return;
    const usedOutgoing = new Set(hockeyState.rosterChanges[side].map((change) => change.outgoingName));
    const outgoing = currentTeamRoster(team.name)
        .filter((player) => !usedOutgoing.has(player.name))
        .sort((a, b) => a.position.localeCompare(b.position) || a.name.localeCompare(b.name))[0];
    if (!outgoing) return;
    hockeyState.rosterChanges[side].push({
        id: hockeyState.nextRosterChangeId++,
        outgoingName: outgoing.name,
        incomingKey: ''
    });
    renderMatchup();
}

function updateRosterChange(side, changeId, field, value) {
    const change = hockeyState.rosterChanges[side].find((item) => item.id === changeId);
    if (!change) return;
    if (field === 'outgoing') {
        change.outgoingName = value;
        change.incomingKey = '';
    }
    renderMatchup();
}

function renderMatchup() {
    const baseTeamA = hockeyState.teamMap.get(byId('matchup-team-one').value);
    const baseTeamB = hockeyState.teamMap.get(byId('matchup-team-two').value);
    if (!baseTeamA || !baseTeamB) return;
    const teamA = scenarioTeam(baseTeamA, 'one');
    const teamB = scenarioTeam(baseTeamB, 'two');
    renderRosterChanges('one', baseTeamA, teamA);
    renderRosterChanges('two', baseTeamB, teamB);
    const hasScenario = [...hockeyState.rosterChanges.one, ...hockeyState.rosterChanges.two]
        .some((change) => hockeyState.ratingCatalogMap.has(change.incomingKey));
    let probabilityA = expectedScore(teamA.rating, teamB.rating);
    if (teamA.name === teamB.name && !hasScenario) probabilityA = 0.5;
    const probabilityB = 1 - probabilityA;
    const calibration = getCalibration(probabilityA);
    const aIsFavorite = probabilityA >= 0.5;
    const rangeA = aIsFavorite ? [calibration.ciLow, calibration.ciHigh] : [1 - calibration.ciHigh, 1 - calibration.ciLow];
    const rangeB = [1 - rangeA[1], 1 - rangeA[0]];
    byId('matchup-name-one').textContent = teamA.name;
    byId('matchup-name-two').textContent = teamB.name;
    byId('matchup-probability-one').textContent = formatPercent(probabilityA);
    byId('matchup-probability-two').textContent = formatPercent(probabilityB);
    byId('matchup-bar-one').style.width = `${probabilityA * 100}%`;
    byId('matchup-bar-two').style.width = `${probabilityB * 100}%`;
    byId('matchup-odds-name-one').textContent = teamA.name;
    byId('matchup-odds-name-two').textContent = teamB.name;
    byId('matchup-odds-one').textContent = fairOddsText(probabilityA);
    byId('matchup-odds-two').textContent = fairOddsText(probabilityB);
    byId('matchup-confidence-badge').textContent = `${formatNumber(calibration.games)} comparable games`;
    byId('matchup-projection-kicker').textContent = hasScenario ? 'Roster-adjusted Elo' : 'Elo baseline';
    byId('matchup-projection-note').textContent = hasScenario
        ? 'The neutral-ice projection now includes the displayed roster substitutions. Schedule context and published playoff odds remain tied to the original frozen snapshot.'
        : 'The hypothetical matchup isolates team Elo on neutral ice. Generated schedule forecasts additionally account for home ice, rest, back-to-backs, and travel.';
    byId('matchup-ranges').innerHTML = [
        [teamA, probabilityA, rangeA], [teamB, probabilityB, rangeB]
    ].map(([team, probability, range]) => `<div><strong>${escapeHtml(team.name)}: ${formatPercent(range[0])}-${formatPercent(range[1])}</strong><span>Historical 95% interval | fair odds ${fairAmericanOdds(probability)}</span></div>`).join('');

    const cards = [teamA, teamB].map((team) => {
        const odds = hockeyState.playoffMap.get(team.name) || {};
        return `<article><h3>${escapeHtml(team.name)}</h3><div class="hockey-comparison-stats">
            <div><span>Scenario Elo</span><strong>${formatNumber(team.rating, 1)}</strong></div><div><span>Change</span><strong class="${team.ratingDelta > 0.05 ? 'hockey-rating-delta-positive' : team.ratingDelta < -0.05 ? 'hockey-rating-delta-negative' : ''}">${team.ratingDelta > 0 ? '+' : ''}${formatNumber(team.ratingDelta, 1)}</strong></div>
            <div><span>Points</span><strong>${team.points}</strong></div><div><span>Cup odds</span><strong>${formatPercent(odds.champion || 0)}</strong></div>
        </div></article>`;
    }).join('');
    byId('matchup-team-cards').innerHTML = cards;

    const ratings = hockeyState.data.teams.map((team) => team.rating);
    const points = hockeyState.data.teams.map((team) => team.points);
    const profile = (team) => {
        const odds = hockeyState.playoffMap.get(team.name) || {};
        return [percentile(team.rating, ratings), percentile(team.points, points), (odds.makePlayoffs || 0) * 100, (odds.cupFinal || 0) * 100, (odds.champion || 0) * 100];
    };
    renderChart('matchupProfile', 'matchup-comparison-chart', {
        type: 'bar', data: { labels: ['Elo percentile', 'Points percentile', 'Make playoffs', 'Cup Final', 'Win Cup'], datasets: [
            { label: teamA.name, data: profile(teamA), backgroundColor: hockeyColors.ice },
            { label: teamB.name, data: profile(teamB), backgroundColor: hockeyColors.red }
        ] }, options: chartBaseOptions({ percentage: true, xTitle: 'Team profile metric', yTitle: 'League-relative score or probability' })
    });
}

function scheduleRows() {
    const date = byId('schedule-date').value;
    const team = byId('schedule-team').value;
    const confidence = byId('schedule-confidence').value;
    const sort = byId('schedule-sort').value;
    const rows = hockeyState.data.schedule.filter((game) => {
        if (date !== 'all' && game.date !== date) return false;
        if (team !== 'all' && game.homeTeam !== team && game.awayTeam !== team) return false;
        if (confidence === 'close' && game.favoriteProbability >= 0.55) return false;
        if (confidence === 'lean' && (game.favoriteProbability < 0.55 || game.favoriteProbability >= 0.65)) return false;
        if (confidence === 'strong' && game.favoriteProbability < 0.65) return false;
        return true;
    });
    rows.sort((a, b) => {
        if (sort === 'close-asc') return a.favoriteProbability - b.favoriteProbability;
        if (sort === 'confidence-desc') return b.favoriteProbability - a.favoriteProbability;
        if (sort === 'gap-desc') return b.ratingDifference - a.ratingDifference;
        return a.date.localeCompare(b.date) || a.homeTeam.localeCompare(b.homeTeam);
    });
    return rows;
}

function renderSchedule() {
    const rows = scheduleRows();
    byId('schedule-count').textContent = `${formatNumber(rows.length)} games`;
    const closest = [...rows].sort((a, b) => a.favoriteProbability - b.favoriteProbability)[0];
    const strongest = [...rows].sort((a, b) => b.favoriteProbability - a.favoriteProbability)[0];
    const average = rows.reduce((sum, game) => sum + game.favoriteProbability, 0) / Math.max(1, rows.length);
    byId('schedule-closest').textContent = closest ? `${closest.awayTeam} at ${closest.homeTeam}` : '-';
    byId('schedule-closest-meta').textContent = closest ? `${closest.pick} ${formatPercent(closest.favoriteProbability)} | ${formatDate(closest.date)}` : '-';
    byId('schedule-strongest').textContent = strongest?.pick || '-';
    byId('schedule-strongest-meta').textContent = strongest ? `${formatPercent(strongest.favoriteProbability)} vs ${strongest.pick === strongest.homeTeam ? strongest.awayTeam : strongest.homeTeam}` : '-';
    byId('schedule-average').textContent = rows.length ? formatPercent(average) : '-';
    byId('schedule-table-body').innerHTML = rows.length ? rows.slice(0, 230).map((game) => `<tr>
        <td>${formatDate(game.date)}</td><td class="hockey-team-name">${escapeHtml(game.awayTeam)} at ${escapeHtml(game.homeTeam)}</td>
        <td>${escapeHtml(game.pick)}</td><td class="hockey-rating">${formatPercent(game.favoriteProbability)}</td>
        <td>${formatPercent(game.ciLow)}-${formatPercent(game.ciHigh)}</td><td>${formatNumber(game.ratingDifference, 1)}</td>
        <td>${fairAmericanOdds(game.favoriteProbability)}</td></tr>`).join('') : '<tr><td class="hockey-empty" colspan="7">No games match these filters.</td></tr>';
    const chartRows = [...rows].sort((a, b) => b.favoriteProbability - a.favoriteProbability).slice(0, 14);
    renderChart('schedule', 'schedule-chart', {
        type: 'bar', data: { labels: chartRows.map((game) => `${game.pick} vs ${game.pick === game.homeTeam ? game.awayTeam : game.homeTeam}`), datasets: [{ data: chartRows.map((game) => game.favoriteProbability * 100), backgroundColor: chartRows.map((game) => game.pick === game.homeTeam ? hockeyColors.ice : hockeyColors.red) }] },
        options: { ...chartBaseOptions({ horizontal: true, percentage: true, xTitle: 'Favorite win probability', yTitle: 'Model pick vs. opponent' }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: 50, max: 100, title: { display: true, text: 'Favorite win probability' }, grid: { color: hockeyColors.line }, ticks: { callback: (value) => `${value}%` } }, y: { title: { display: true, text: 'Model pick vs. opponent' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
}

function mulberry32(seed) {
    return function random() {
        let value = seed += 0x6D2B79F5;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
    };
}

function rankTeams(teams, points) {
    return [...teams].sort((a, b) => points.get(b.name) - points.get(a.name) || b.rating - a.rating || a.name.localeCompare(b.name));
}

function seedConference(conference, points) {
    const conferenceTeams = hockeyState.data.teams.filter((team) => team.conference === conference);
    const divisions = [...new Set(conferenceTeams.map((team) => team.division))];
    const topThree = new Map();
    const qualified = new Set();
    divisions.forEach((division) => {
        const ranked = rankTeams(conferenceTeams.filter((team) => team.division === division), points).slice(0, 3);
        topThree.set(division, ranked);
        ranked.forEach((team) => qualified.add(team.name));
    });
    const wildcards = rankTeams(conferenceTeams.filter((team) => !qualified.has(team.name)), points).slice(0, 2);
    const divisionWinners = divisions.map((division) => topThree.get(division)[0]);
    divisionWinners.sort((a, b) => points.get(b.name) - points.get(a.name) || b.rating - a.rating);
    const bestWinner = divisionWinners[0];
    const otherWinner = divisionWinners[1];
    const bestDivision = topThree.get(bestWinner.division);
    const otherDivision = topThree.get(otherWinner.division);
    return [
        [bestWinner, wildcards[1]],
        [bestDivision[1], bestDivision[2]],
        [otherWinner, wildcards[0]],
        [otherDivision[1], otherDivision[2]]
    ];
}

function simulateSeries(teamA, teamB, random) {
    const probabilityA = expectedScore(teamA.rating, teamB.rating);
    let winsA = 0;
    let winsB = 0;
    while (winsA < 4 && winsB < 4) {
        if (random() < probabilityA) winsA += 1;
        else winsB += 1;
    }
    return winsA === 4 ? teamA : teamB;
}

function simulateConference(conference, points, random, bracket) {
    const firstRound = seedConference(conference, points);
    const firstWinners = firstRound.map(([teamA, teamB]) => {
        const winner = simulateSeries(teamA, teamB, random);
        if (bracket) bracket.push({ conference, round: 'First round', teamA, teamB, winner });
        return winner;
    });
    const secondPairs = [[firstWinners[0], firstWinners[1]], [firstWinners[2], firstWinners[3]]];
    const secondWinners = secondPairs.map(([teamA, teamB]) => {
        const winner = simulateSeries(teamA, teamB, random);
        if (bracket) bracket.push({ conference, round: 'Second round', teamA, teamB, winner });
        return winner;
    });
    const winner = simulateSeries(secondWinners[0], secondWinners[1], random);
    if (bracket) bracket.push({ conference, round: 'Conference final', teamA: secondWinners[0], teamB: secondWinners[1], winner });
    return { winner, playoffTeams: new Set(firstRound.flat().map((team) => team.name)) };
}

function simulateSeason(runs) {
    const random = mulberry32(20260319 + runs);
    const teamTotals = new Map(hockeyState.data.teams.map((team) => [team.name, {
        points: 0, playoffs: 0, presidents: 0, cups: 0
    }]));
    let representativeBracket = [];
    for (let run = 0; run < runs; run += 1) {
        const points = new Map(hockeyState.data.teams.map((team) => [team.name, team.points]));
        hockeyState.data.schedule.forEach((game) => {
            const homeWins = random() < game.homeProbability;
            const winner = homeWins ? game.homeTeam : game.awayTeam;
            const loser = homeWins ? game.awayTeam : game.homeTeam;
            points.set(winner, points.get(winner) + 2);
            if (random() < hockeyState.data.playoffs.overtimeRate) points.set(loser, points.get(loser) + 1);
        });
        const league = rankTeams(hockeyState.data.teams, points);
        teamTotals.get(league[0].name).presidents += 1;
        league.forEach((team) => { teamTotals.get(team.name).points += points.get(team.name); });
        const bracket = run === 0 ? [] : null;
        const eastern = simulateConference('Eastern', points, random, bracket);
        const western = simulateConference('Western', points, random, bracket);
        [...eastern.playoffTeams, ...western.playoffTeams].forEach((team) => { teamTotals.get(team).playoffs += 1; });
        const cupWinner = simulateSeries(eastern.winner, western.winner, random);
        if (bracket) {
            bracket.push({ conference: 'League', round: 'Stanley Cup Final', teamA: eastern.winner, teamB: western.winner, winner: cupWinner });
            representativeBracket = bracket;
        }
        teamTotals.get(cupWinner.name).cups += 1;
    }
    const teams = hockeyState.data.teams.map((team) => {
        const total = teamTotals.get(team.name);
        return {
            ...team,
            projectedPoints: total.points / runs,
            playoffProbability: total.playoffs / runs,
            presidentsProbability: total.presidents / runs,
            cupProbability: total.cups / runs
        };
    }).sort((a, b) => b.projectedPoints - a.projectedPoints || b.rating - a.rating);
    return { runs, teams, bracket: representativeBracket };
}

function runSeasonSimulation() {
    const runs = Number(byId('simulation-runs').value);
    const button = byId('run-simulation');
    button.disabled = true;
    byId('simulation-status').textContent = `Simulating ${formatNumber(runs)} regular seasons and playoff brackets...`;
    window.setTimeout(() => {
        const started = performance.now();
        hockeyState.simulationResult = simulateSeason(runs);
        renderSimulationResult();
        const elapsed = Math.max(0.1, (performance.now() - started) / 1000);
        byId('simulation-status').textContent = `${formatNumber(runs)} simulations complete in ${formatNumber(elapsed, 1)} seconds. Frozen snapshot: ${formatDate(hockeyState.data.playoffs.standingsDate)}.`;
        button.disabled = false;
    }, 20);
}

function bracketCards(bracket) {
    return bracket.map((series) => `<article data-conference="${series.conference}">
        <span class="hockey-bracket-round">${series.conference} | ${series.round}</span>
        <div class="hockey-bracket-team"><strong>${escapeHtml(series.teamA.name || series.teamA)}</strong><span>${series.teamA.rating ? formatNumber(series.teamA.rating, 0) : ''}</span></div>
        <div class="hockey-bracket-team"><strong>${escapeHtml(series.teamB.name || series.teamB)}</strong><span>${series.teamB.rating ? formatNumber(series.teamB.rating, 0) : ''}</span></div>
        <div class="hockey-bracket-pick">Winner: ${escapeHtml(series.winner.name || series.winner)}</div>
    </article>`).join('');
}

function renderSimulationResult() {
    const result = hockeyState.simulationResult;
    const cupWinner = [...result.teams].sort((a, b) => b.cupProbability - a.cupProbability)[0];
    const presidentsWinner = [...result.teams].sort((a, b) => b.presidentsProbability - a.presidentsProbability)[0];
    const pointsLeader = result.teams[0];
    byId('sim-cup-winner').textContent = cupWinner.name;
    byId('sim-cup-odds').textContent = `${formatPercent(cupWinner.cupProbability)} of simulations`;
    byId('sim-presidents-winner').textContent = presidentsWinner.name;
    byId('sim-presidents-odds').textContent = `${formatPercent(presidentsWinner.presidentsProbability)} of simulations`;
    byId('sim-points-leader').textContent = pointsLeader.name;
    byId('sim-points-total').textContent = `${formatNumber(pointsLeader.projectedPoints, 1)} average points`;
    byId('simulation-table-runs').textContent = `${formatNumber(result.runs)} runs`;
    byId('simulation-table-body').innerHTML = result.teams.map((team, index) => `<tr>
        <td class="hockey-rank">${index + 1}</td><td class="hockey-team-name">${escapeHtml(team.name)}</td><td>${team.division}</td>
        <td>${team.points}</td><td class="hockey-rating">${formatNumber(team.projectedPoints, 1)}</td>
        <td>${formatPercent(team.playoffProbability)}</td><td>${formatPercent(team.presidentsProbability)}</td><td>${formatPercent(team.cupProbability)}</td></tr>`).join('');
    byId('simulation-bracket').innerHTML = bracketCards(result.bracket);

    renderChart('simulationStandings', 'simulation-standings-chart', {
        type: 'bar', data: { labels: result.teams.slice(0, 16).map((team) => team.name), datasets: [{ label: 'Average final points', data: result.teams.slice(0, 16).map((team) => team.projectedPoints), backgroundColor: result.teams.slice(0, 16).map((team) => team.conference === 'Eastern' ? hockeyColors.ice : hockeyColors.red) }] },
        options: { ...chartBaseOptions({ horizontal: true, zeroBaseline: true, xTitle: 'Average simulated final points', yTitle: 'NHL team' }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: 0, title: { display: true, text: 'Average simulated final points' }, grid: { color: hockeyColors.line } }, y: { title: { display: true, text: 'NHL team' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
    const cupRows = [...result.teams].sort((a, b) => b.cupProbability - a.cupProbability).slice(0, 16);
    renderChart('simulationCup', 'simulation-cup-chart', {
        type: 'bar', data: { labels: cupRows.map((team) => team.name), datasets: [{ data: cupRows.map((team) => team.cupProbability * 100), backgroundColor: hockeyColors.gold }] },
        options: { ...chartBaseOptions({ horizontal: true, percentage: true, xTitle: 'Stanley Cup win probability', yTitle: 'NHL team' }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } } }
    });
}

function renderPublishedPlayoffs() {
    const playoffs = hockeyState.data.playoffs;
    byId('published-simulation-date').textContent = `${formatNumber(playoffs.simulations)} runs | ${formatDate(playoffs.standingsDate)} snapshot`;
    byId('published-bracket').innerHTML = playoffs.firstRound.map((series) => `<article data-conference="${series.conference}">
        <span class="hockey-bracket-round">${series.conference} Conference | First round</span>
        <div class="hockey-bracket-team"><strong>${series.awaySeed} ${escapeHtml(series.awayTeam)}</strong><span>${formatNumber(series.awayRating, 0)}</span></div>
        <div class="hockey-bracket-team"><strong>${series.homeSeed} ${escapeHtml(series.homeTeam)}</strong><span>${formatNumber(series.homeRating, 0)}</span></div>
        <div class="hockey-bracket-pick">Pick: ${escapeHtml(series.pick)} ${formatPercent(series.winProbability)}</div>
    </article>`).join('');
    const rows = playoffs.advancement.slice(0, 16);
    renderChart('publishedPlayoffs', 'published-playoff-chart', {
        type: 'bar', data: { labels: rows.map((team) => team.team), datasets: [
            { label: 'Make playoffs', data: rows.map((team) => team.makePlayoffs * 100), backgroundColor: hockeyColors.ice },
            { label: 'Cup Final', data: rows.map((team) => team.cupFinal * 100), backgroundColor: hockeyColors.blue },
            { label: 'Champion', data: rows.map((team) => team.champion * 100), backgroundColor: hockeyColors.gold }
        ] }, options: { ...chartBaseOptions({ horizontal: true, percentage: true, xTitle: 'Postseason advancement probability', yTitle: 'NHL team' }), indexAxis: 'y', scales: { x: { stacked: false, min: 0, max: 100, title: { display: true, text: 'Postseason advancement probability' }, grid: { color: hockeyColors.line }, ticks: { callback: (value) => `${value}%` } }, y: { title: { display: true, text: 'NHL team' }, grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
}

function renderModel() {
    const { backtest, model } = hockeyState.data;
    const params = model.params;
    byId('model-accuracy').textContent = formatPercent(backtest.accuracy);
    byId('model-accuracy-ci').textContent = `95% CI ${formatPercent(backtest.accuracyLow)}-${formatPercent(backtest.accuracyHigh)}`;
    byId('model-auc').textContent = formatNumber(backtest.auc, 4);
    byId('model-log-loss').textContent = formatNumber(backtest.logLoss, 4);
    byId('model-brier').textContent = formatNumber(backtest.brier, 4);
    byId('model-ece').textContent = formatNumber(backtest.ece, 4);
    byId('selected-trial').textContent = `Production trial ${model.selectedTrial} | regression ${formatPercent(model.regressionRate)}`;
    byId('model-development-range').textContent = `${model.trainingSeasons[0]}-${model.holdoutSeasons.at(-1)} seasons`;
    byId('creation-game-count').textContent = formatNumber(model.gamesProcessed);
    byId('creation-validation-seasons').textContent = model.validationSeasons.join(', ');
    byId('creation-holdout-seasons').textContent = model.holdoutSeasons.join(', ');
    byId('creation-trials').textContent = `${formatNumber(model.completedTrials)} trials (seed ${model.searchSeed})`;
    byId('creation-stability').textContent = `${formatNumber(model.stabilityLambda, 2)} x fold standard deviation`;
    byId('creation-finalists').textContent = formatNumber(model.topCandidatesEvaluated);
    byId('team-weight-forward').textContent = formatNumber(params.w_f, 4);
    byId('team-weight-defense').textContent = formatNumber(params.w_d, 4);
    byId('team-weight-goalie').textContent = formatNumber(params.w_g, 4);
    byId('forward-impact-equation').textContent = `${formatNumber(params.forward_goal_weight, 4)} x goals + ${formatNumber(params.forward_assist_weight, 4)} x assists + ${formatNumber(params.forward_plus_minus_weight, 4)} x clipped +/- + ${formatNumber(params.forward_toi_share_weight, 4)} x TOI z-score`;
    byId('defense-impact-equation').textContent = `${formatNumber(params.defense_goal_weight, 4)} x goals + ${formatNumber(params.defense_assist_weight, 4)} x assists + ${formatNumber(params.defense_plus_minus_weight, 4)} x clipped +/- + ${formatNumber(params.defense_toi_share_weight, 4)} x TOI z-score`;
    byId('goalie-impact-equation').textContent = `shots faced x (save% - ${formatNumber(params.league_average_save_pct, 4)}); ${formatNumber(params.goalie_save_pct_multiplier, 2)} x the save% gap when shots faced are unavailable`;
    byId('parameter-table-body').innerHTML = Object.entries(model.params).map(([key, value]) => {
        const [label, role] = parameterCatalog[key] || [key.replaceAll('_', ' '), 'Model configuration'];
        return `<tr><td class="hockey-team-name">${escapeHtml(label)}</td><td>${escapeHtml(role)}</td><td class="hockey-rating">${formatNumber(value, 4)}</td></tr>`;
    }).join('');
    const folds = model.validationMetrics.folds;
    renderChart('modelValidation', 'model-validation-chart', {
        type: 'line', data: { labels: folds.map((fold) => fold.validation_season), datasets: [{ label: 'Accuracy', data: folds.map((fold) => fold.accuracy * 100), borderColor: hockeyColors.ice, backgroundColor: hockeyColors.iceSoft, fill: true, tension: 0.25, pointRadius: 5 }] },
        options: { ...chartBaseOptions({ percentage: true, xTitle: 'Validation season', yTitle: 'Favorite-pick accuracy' }), scales: { x: { title: { display: true, text: 'Validation season' }, grid: { display: false } }, y: { min: 50, max: 65, title: { display: true, text: 'Favorite-pick accuracy' }, grid: { color: hockeyColors.line }, ticks: { callback: (value) => `${value}%` } } } }
    });
    renderChart('modelWeights', 'model-weights-chart', {
        type: 'doughnut', data: { labels: ['Forwards', 'Defense', 'Goalies'], datasets: [{ data: [params.w_f, params.w_d, params.w_g], backgroundColor: [hockeyColors.ice, hockeyColors.blue, hockeyColors.red], borderWidth: 0 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '58%', plugins: chartBaseOptions().plugins }
    });
}

function setupEvents() {
    document.querySelectorAll('[data-hockey-view]').forEach((button) => button.addEventListener('click', () => setView(button.dataset.hockeyView)));
    window.addEventListener('hashchange', () => setView(window.location.hash.slice(1), false));
    ['team-search', 'team-conference', 'team-division', 'team-sort'].forEach((id) => byId(id).addEventListener('input', renderTeams));
    byId('team-filters').addEventListener('reset', () => window.setTimeout(renderTeams));
    ['player-mode', 'player-search', 'player-position', 'player-team', 'player-nationality', 'player-page-size'].forEach((id) => byId(id).addEventListener('input', () => { hockeyState.playerPage = 1; renderPlayers(); }));
    byId('player-filters').addEventListener('reset', () => window.setTimeout(() => { hockeyState.playerPage = 1; renderPlayers(); }));
    byId('player-previous').addEventListener('click', () => { hockeyState.playerPage -= 1; renderPlayers(); });
    byId('player-next').addEventListener('click', () => { hockeyState.playerPage += 1; renderPlayers(); });
    ['goalie-mode', 'goalie-team', 'goalie-search'].forEach((id) => byId(id).addEventListener('input', renderGoalies));
    byId('goalie-filters').addEventListener('reset', () => window.setTimeout(renderGoalies));
    byId('matchup-team-one').addEventListener('change', () => { hockeyState.rosterChanges.one = []; renderMatchup(); });
    byId('matchup-team-two').addEventListener('change', () => { hockeyState.rosterChanges.two = []; renderMatchup(); });
    byId('swap-matchup').addEventListener('click', () => {
        const first = byId('matchup-team-one').value;
        byId('matchup-team-one').value = byId('matchup-team-two').value;
        byId('matchup-team-two').value = first;
        const firstChanges = hockeyState.rosterChanges.one;
        hockeyState.rosterChanges.one = hockeyState.rosterChanges.two;
        hockeyState.rosterChanges.two = firstChanges;
        renderMatchup();
    });
    document.querySelectorAll('[data-add-roster-change]').forEach((button) => button.addEventListener('click', () => addRosterChange(button.dataset.addRosterChange)));
    byId('reset-roster-scenarios').addEventListener('click', () => {
        hockeyState.rosterChanges = { one: [], two: [] };
        renderMatchup();
    });
    const rosterScenarios = byId('roster-scenario-heading').closest('.hockey-roster-scenarios');
    rosterScenarios.addEventListener('change', (event) => {
        const field = event.target.closest('[data-roster-field]');
        const row = event.target.closest('.hockey-roster-change');
        if (!field || !row) return;
        updateRosterChange(row.dataset.side, Number(row.dataset.changeId), field.dataset.rosterField, field.value);
    });
    rosterScenarios.addEventListener('input', (event) => {
        const input = event.target.closest('[data-rating-search]');
        if (input) renderRatingSearchResults(input);
    });
    rosterScenarios.addEventListener('focusin', (event) => {
        const input = event.target.closest('[data-rating-search]');
        if (!input) return;
        const selected = hockeyState.ratingCatalogMap.get(input.dataset.selectedKey);
        input.select();
        renderRatingSearchResults(input, selected?.name || '');
    });
    rosterScenarios.addEventListener('keydown', (event) => {
        const input = event.target.closest('[data-rating-search]');
        if (!input) return;
        const results = byId(input.getAttribute('aria-controls'));
        if (event.key === 'Escape') {
            restoreRatingSearchInput(input);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            results.querySelector('button')?.focus();
        } else if (event.key === 'Enter') {
            const firstResult = results.querySelector('button');
            if (firstResult) {
                event.preventDefault();
                firstResult.click();
            } else {
                input.setAttribute('aria-invalid', 'true');
            }
        }
    });
    rosterScenarios.addEventListener('click', (event) => {
        const ratingResult = event.target.closest('[data-rating-key]');
        if (ratingResult) {
            selectRatingEntry(ratingResult.dataset.side, Number(ratingResult.dataset.changeId), ratingResult.dataset.ratingKey);
            return;
        }
        const button = event.target.closest('[data-remove-roster-change]');
        if (!button) return;
        const side = button.dataset.side;
        const id = Number(button.dataset.removeRosterChange);
        hockeyState.rosterChanges[side] = hockeyState.rosterChanges[side].filter((change) => change.id !== id);
        renderMatchup();
    });
    ['schedule-date', 'schedule-team', 'schedule-confidence', 'schedule-sort'].forEach((id) => byId(id).addEventListener('input', renderSchedule));
    byId('schedule-filters').addEventListener('reset', () => window.setTimeout(renderSchedule));
    byId('run-simulation').addEventListener('click', runSeasonSimulation);
    document.addEventListener('click', (event) => {
        const infoButton = event.target.closest('[data-chart-info]');
        if (infoButton) openChartInfo(infoButton.dataset.chartInfo);
        if (!event.target.closest('.hockey-player-picker')) {
            document.querySelectorAll('[data-rating-search][aria-expanded="true"]').forEach(restoreRatingSearchInput);
        }
    });
    byId('close-chart-info').addEventListener('click', () => byId('chart-info-dialog').close());
    byId('chart-info-dialog').addEventListener('click', (event) => {
        if (event.target === byId('chart-info-dialog')) byId('chart-info-dialog').close();
    });
}

async function initializeHockeyDashboard() {
    try {
        const response = await fetch(HOCKEY_DATA_URL);
        if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
        hockeyState.data = await response.json();
        hockeyState.teamMap = new Map(hockeyState.data.teams.map((team) => [team.name, team]));
        hockeyState.playoffMap = new Map(hockeyState.data.playoffs.advancement.map((team) => [team.team, team]));
        hockeyState.currentPlayerMap = new Map(hockeyState.data.currentPlayers.map((player) => [player.name, player]));
        buildRatingCatalog();
        setupMetadata();
        setupChartInfo();
        setupEvents();
        byId('hockey-loading').hidden = true;
        setView(window.location.hash.slice(1) || 'overview', false);
    } catch (error) {
        byId('hockey-loading').textContent = 'The Hockey Elo Engine data could not be loaded.';
        console.error(error);
    }
}

document.addEventListener('DOMContentLoaded', initializeHockeyDashboard);
