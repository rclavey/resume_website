const HOCKEY_DATA_URL = 'data/hockey-dashboard.json?v=2026-03-19-1';

const hockeyState = {
    data: null,
    teamMap: new Map(),
    playoffMap: new Map(),
    charts: new Map(),
    currentView: 'overview',
    renderedViews: new Set(),
    playerPage: 1,
    simulationResult: null
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

function chartBaseOptions({ horizontal = false, percentage = false } = {}) {
    const valueScale = horizontal ? 'x' : 'y';
    const categoryScale = horizontal ? 'y' : 'x';
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300 },
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
            legend: { labels: { color: hockeyColors.muted, boxWidth: 12, font: { size: 11, weight: 700 } } },
            tooltip: { backgroundColor: hockeyColors.ink, padding: 11, titleFont: { weight: 800 } }
        },
        scales: {
            [valueScale]: {
                beginAtZero: percentage,
                max: percentage ? 100 : undefined,
                grid: { color: hockeyColors.line },
                ticks: {
                    color: hockeyColors.muted,
                    callback: percentage ? (value) => `${value}%` : undefined
                }
            },
            [categoryScale]: { grid: { display: false }, ticks: { color: hockeyColors.muted } }
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
            ...chartBaseOptions({ horizontal: true }),
            indexAxis: 'y',
            plugins: { ...chartBaseOptions().plugins, legend: { display: false } },
            scales: {
                x: { min: 900, grid: { color: hockeyColors.line }, ticks: { color: hockeyColors.muted } },
                y: { grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 11, weight: 700 } } }
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
                x: { title: { display: true, text: 'Team Elo' }, grid: { color: hockeyColors.line }, ticks: { color: hockeyColors.muted } },
                y: { title: { display: true, text: 'Standings points' }, grid: { color: hockeyColors.line }, ticks: { color: hockeyColors.muted } }
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
        options: chartBaseOptions({ percentage: true })
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
        options: { ...chartBaseOptions({ horizontal: true }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: Math.max(0, Math.floor(Math.min(...chartRows.map((team) => team.rating), 900) / 50) * 50), grid: { color: hockeyColors.line } }, y: { grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
    renderChart('teamPlayoffs', 'team-playoff-chart', {
        type: 'bar', data: { labels: chartRows.map((team) => team.name), datasets: [{ data: chartRows.map((team) => (hockeyState.playoffMap.get(team.name)?.makePlayoffs || 0) * 100), backgroundColor: hockeyColors.lime }] },
        options: { ...chartBaseOptions({ horizontal: true, percentage: true }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } } }
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
        options: { ...chartBaseOptions({ horizontal: true }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: Math.max(0, Math.floor(Math.min(...chartRows.map((player) => player.rating), 900) / 100) * 100), grid: { color: hockeyColors.line } }, y: { grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
}

function renderMatchup() {
    const teamA = hockeyState.teamMap.get(byId('matchup-team-one').value);
    const teamB = hockeyState.teamMap.get(byId('matchup-team-two').value);
    if (!teamA || !teamB) return;
    let probabilityA = expectedScore(teamA.rating, teamB.rating);
    if (teamA.name === teamB.name) probabilityA = 0.5;
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
    byId('matchup-confidence-badge').textContent = `${formatNumber(calibration.games)} comparable games`;
    byId('matchup-ranges').innerHTML = [
        [teamA, probabilityA, rangeA], [teamB, probabilityB, rangeB]
    ].map(([team, probability, range]) => `<div><strong>${escapeHtml(team.name)}: ${formatPercent(range[0])}-${formatPercent(range[1])}</strong><span>Historical 95% interval | fair odds ${fairAmericanOdds(probability)}</span></div>`).join('');

    const cards = [teamA, teamB].map((team) => {
        const odds = hockeyState.playoffMap.get(team.name) || {};
        return `<article><h3>${escapeHtml(team.name)}</h3><div class="hockey-comparison-stats">
            <div><span>Elo</span><strong>${formatNumber(team.rating, 1)}</strong></div><div><span>League rank</span><strong>#${team.rank}</strong></div>
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
        ] }, options: chartBaseOptions({ percentage: true })
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
        options: { ...chartBaseOptions({ horizontal: true, percentage: true }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: 50, max: 100, grid: { color: hockeyColors.line }, ticks: { callback: (value) => `${value}%` } }, y: { grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
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
        options: { ...chartBaseOptions({ horizontal: true }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } }, scales: { x: { min: 75, grid: { color: hockeyColors.line } }, y: { grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
    const cupRows = [...result.teams].sort((a, b) => b.cupProbability - a.cupProbability).slice(0, 16);
    renderChart('simulationCup', 'simulation-cup-chart', {
        type: 'bar', data: { labels: cupRows.map((team) => team.name), datasets: [{ data: cupRows.map((team) => team.cupProbability * 100), backgroundColor: hockeyColors.gold }] },
        options: { ...chartBaseOptions({ horizontal: true, percentage: true }), indexAxis: 'y', plugins: { ...chartBaseOptions().plugins, legend: { display: false } } }
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
        ] }, options: { ...chartBaseOptions({ horizontal: true, percentage: true }), indexAxis: 'y', scales: { x: { stacked: false, min: 0, max: 100, grid: { color: hockeyColors.line }, ticks: { callback: (value) => `${value}%` } }, y: { grid: { display: false }, ticks: { color: hockeyColors.ink, font: { size: 10 } } } } }
    });
}

function renderModel() {
    const { backtest, model } = hockeyState.data;
    byId('model-accuracy').textContent = formatPercent(backtest.accuracy);
    byId('model-accuracy-ci').textContent = `95% CI ${formatPercent(backtest.accuracyLow)}-${formatPercent(backtest.accuracyHigh)}`;
    byId('model-auc').textContent = formatNumber(backtest.auc, 4);
    byId('model-log-loss').textContent = formatNumber(backtest.logLoss, 4);
    byId('model-brier').textContent = formatNumber(backtest.brier, 4);
    byId('model-ece').textContent = formatNumber(backtest.ece, 4);
    byId('selected-trial').textContent = `Production trial ${model.selectedTrial} | regression ${formatPercent(model.regressionRate)}`;
    byId('parameter-table-body').innerHTML = Object.entries(model.params).map(([key, value]) => {
        const [label, role] = parameterCatalog[key] || [key.replaceAll('_', ' '), 'Model configuration'];
        return `<tr><td class="hockey-team-name">${escapeHtml(label)}</td><td>${escapeHtml(role)}</td><td class="hockey-rating">${formatNumber(value, 4)}</td></tr>`;
    }).join('');
    const folds = model.validationMetrics.folds;
    renderChart('modelValidation', 'model-validation-chart', {
        type: 'line', data: { labels: folds.map((fold) => fold.validation_season), datasets: [{ label: 'Accuracy', data: folds.map((fold) => fold.accuracy * 100), borderColor: hockeyColors.ice, backgroundColor: hockeyColors.iceSoft, fill: true, tension: 0.25, pointRadius: 5 }] },
        options: { ...chartBaseOptions({ percentage: true }), scales: { x: { grid: { display: false } }, y: { min: 50, max: 65, grid: { color: hockeyColors.line }, ticks: { callback: (value) => `${value}%` } } } }
    });
    renderChart('modelWeights', 'model-weights-chart', {
        type: 'doughnut', data: { labels: ['Forwards', 'Defense', 'Goalies'], datasets: [{ data: [model.params.w_f, model.params.w_d, model.params.w_g], backgroundColor: [hockeyColors.ice, hockeyColors.blue, hockeyColors.red], borderWidth: 0 }] },
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
    ['matchup-team-one', 'matchup-team-two'].forEach((id) => byId(id).addEventListener('change', renderMatchup));
    byId('swap-matchup').addEventListener('click', () => {
        const first = byId('matchup-team-one').value;
        byId('matchup-team-one').value = byId('matchup-team-two').value;
        byId('matchup-team-two').value = first;
        renderMatchup();
    });
    ['schedule-date', 'schedule-team', 'schedule-confidence', 'schedule-sort'].forEach((id) => byId(id).addEventListener('input', renderSchedule));
    byId('schedule-filters').addEventListener('reset', () => window.setTimeout(renderSchedule));
    byId('run-simulation').addEventListener('click', runSeasonSimulation);
}

async function initializeHockeyDashboard() {
    try {
        const response = await fetch(HOCKEY_DATA_URL);
        if (!response.ok) throw new Error(`Data request failed with ${response.status}`);
        hockeyState.data = await response.json();
        hockeyState.teamMap = new Map(hockeyState.data.teams.map((team) => [team.name, team]));
        hockeyState.playoffMap = new Map(hockeyState.data.playoffs.advancement.map((team) => [team.team, team]));
        setupMetadata();
        setupEvents();
        byId('hockey-loading').hidden = true;
        setView(window.location.hash.slice(1) || 'overview', false);
    } catch (error) {
        byId('hockey-loading').textContent = 'The Hockey Elo Engine data could not be loaded.';
        console.error(error);
    }
}

document.addEventListener('DOMContentLoaded', initializeHockeyDashboard);
