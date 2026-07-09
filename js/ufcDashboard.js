const UFC_DATA_URL = 'data/ufc-dashboard.json?v=2025-10-14-2';

const dashboardState = {
    data: null,
    fighterMap: new Map(),
    charts: new Map(),
    currentView: 'overview',
    renderedViews: new Set(),
    leaderboardPage: 1,
    leaderboardRows: [],
    selectedCardIndex: 0,
    selectedFightIndex: 0
};

const dashboardColors = {
    ink: '#111315',
    muted: '#66717d',
    line: '#dfe5eb',
    teal: '#008a7a',
    coral: '#f05a3b',
    violet: '#6251d8',
    gold: '#b77813',
    tealSoft: 'rgba(0, 138, 122, 0.18)',
    coralSoft: 'rgba(240, 90, 59, 0.18)',
    violetSoft: 'rgba(98, 81, 216, 0.18)',
    goldSoft: 'rgba(183, 120, 19, 0.18)'
};

const element = id => document.getElementById(id);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function formatNumber(value, digits = 0) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    const number = Number(value);
    if (!Number.isFinite(number)) {
        return '-';
    }
    return number.toLocaleString('en-US', {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits
    });
}

function formatPercent(value, digits = 1) {
    if (value === null || value === undefined || value === '') {
        return '-';
    }
    return `${formatNumber(value, digits)}%`;
}

function formatDate(value, includeYear = true) {
    if (!value) {
        return '-';
    }
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: includeYear ? 'numeric' : undefined
    });
}

function formatTimestamp(value) {
    if (!value) {
        return '-';
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? value
        : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function ratingProbability(ratingOne, ratingTwo) {
    return 1 / (1 + (10 ** ((ratingTwo - ratingOne) / 400)));
}

function wilsonInterval(probability, sampleSize, z = 1.96) {
    if (!sampleSize) {
        return null;
    }
    const denominator = 1 + ((z ** 2) / sampleSize);
    const center = (probability + ((z ** 2) / (2 * sampleSize))) / denominator;
    const margin = (z * Math.sqrt(
        (probability * (1 - probability) / sampleSize) + ((z ** 2) / (4 * (sampleSize ** 2)))
    )) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function formDots(form) {
    if (!form) {
        return '<span>-</span>';
    }
    const dots = form.split('').map(result => {
        const className = result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw';
        return `<i class="${className}" title="${result === 'W' ? 'Win' : result === 'L' ? 'Loss' : 'Draw'}"></i>`;
    }).join('');
    return `<span class="form-dots" aria-label="Recent form ${escapeHtml(form)}">${dots}</span>`;
}

function recordText(fighter) {
    return `${fighter.wins}-${fighter.losses}${fighter.draws ? `-${fighter.draws}` : ''}`;
}

function chartOptions(overrides = {}) {
    return {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { intersect: false, mode: 'nearest' },
        plugins: {
            legend: {
                labels: {
                    color: dashboardColors.muted,
                    usePointStyle: true,
                    boxWidth: 8,
                    font: { size: 11, weight: 600 }
                }
            },
            tooltip: {
                backgroundColor: dashboardColors.ink,
                titleFont: { weight: 800 },
                padding: 10,
                cornerRadius: 5
            }
        },
        scales: {
            x: {
                grid: { color: 'rgba(102, 113, 125, 0.12)' },
                ticks: { color: dashboardColors.muted, font: { size: 10 } }
            },
            y: {
                grid: { color: 'rgba(102, 113, 125, 0.12)' },
                ticks: { color: dashboardColors.muted, font: { size: 10 } }
            }
        },
        ...overrides
    };
}

function createChart(key, canvasId, configuration) {
    const canvas = element(canvasId);
    if (!canvas || typeof Chart === 'undefined') {
        return null;
    }
    dashboardState.charts.get(key)?.destroy();
    const chart = new Chart(canvas, configuration);
    dashboardState.charts.set(key, chart);
    return chart;
}

function histogram(values, size = 100) {
    if (!values.length) {
        return { labels: [], counts: [] };
    }
    const lower = Math.floor(Math.min(...values) / size) * size;
    const upper = Math.ceil(Math.max(...values) / size) * size;
    const labels = [];
    const counts = [];
    for (let start = lower; start < upper; start += size) {
        labels.push(`${start}-${start + size - 1}`);
        counts.push(values.filter(value => value >= start && value < start + size).length);
    }
    return { labels, counts };
}

function setDashboardView(view, updateHash = true) {
    if (!dashboardState.data) {
        return;
    }
    const available = ['overview', 'leaderboard', 'matchup', 'cards', 'methodology'];
    const nextView = available.includes(view) ? view : 'overview';
    dashboardState.currentView = nextView;

    document.querySelectorAll('[data-dashboard-panel]').forEach(panel => {
        panel.hidden = panel.dataset.dashboardPanel !== nextView;
    });
    document.querySelectorAll('[data-dashboard-view]').forEach(button => {
        button.setAttribute('aria-selected', String(button.dataset.dashboardView === nextView));
    });
    const selectedTab = document.querySelector(`[data-dashboard-view="${nextView}"]`);
    selectedTab?.scrollIntoView({ block: 'nearest', inline: 'center' });

    if (updateHash) {
        history.replaceState(null, '', `#${nextView}`);
    }
    renderView(nextView);
}

function renderView(view) {
    if (view === 'overview' && !dashboardState.renderedViews.has(view)) {
        renderOverviewCharts();
    }
    if (view === 'leaderboard') {
        renderLeaderboard();
    }
    if (view === 'matchup') {
        renderMatchup();
    }
    if (view === 'cards') {
        renderFightCard();
    }
    if (view === 'methodology' && !dashboardState.renderedViews.has(view)) {
        renderMethodology();
    }
    dashboardState.renderedViews.add(view);
}

function renderOverview() {
    const { meta, fighters } = dashboardState.data;
    element('snapshot-generated').textContent = formatTimestamp(meta.generatedAt);
    element('snapshot-latest').textContent = formatDate(meta.latestFightDate);
    element('metric-fighters').textContent = formatNumber(meta.fighterCount);
    element('metric-established').textContent = formatNumber(fighters.filter(fighter => fighter.fights >= 5).length);
    element('metric-cards').textContent = formatNumber(meta.cardCount);
    element('metric-predictions').textContent = formatNumber(meta.predictedFightCount);
    element('metric-insufficient').textContent = formatNumber(meta.insufficientFightCount);
}

function renderOverviewCharts() {
    const fighters = dashboardState.data.fighters;
    const topFighters = [...fighters].sort((a, b) => b.currentRating - a.currentRating).slice(0, 15).reverse();
    createChart('overview-top', 'top-ratings-chart', {
        type: 'bar',
        data: {
            labels: topFighters.map(fighter => fighter.name),
            datasets: [{
                label: 'Current Elo',
                data: topFighters.map(fighter => fighter.currentRating),
                backgroundColor: topFighters.map((_, index) => index >= 12 ? dashboardColors.coral : dashboardColors.teal),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { min: 1100, grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 10, weight: 650 } } }
            }
        })
    });

    const distribution = histogram(fighters.map(fighter => fighter.currentRating));
    createChart('overview-distribution', 'rating-distribution-chart', {
        type: 'bar',
        data: {
            labels: distribution.labels,
            datasets: [{
                label: 'Fighters',
                data: distribution.counts,
                backgroundColor: dashboardColors.violet,
                borderRadius: 3
            }]
        },
        options: chartOptions({ plugins: { legend: { display: false } } })
    });

    createChart('overview-scatter', 'rating-scatter-chart', {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Fighters',
                data: fighters.map(fighter => ({ x: fighter.currentRating, y: fighter.peakRating, fighter: fighter.name })),
                backgroundColor: dashboardColors.coralSoft,
                borderColor: dashboardColors.coral,
                pointRadius: 2,
                pointHoverRadius: 5
            }]
        },
        options: chartOptions({
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => `${context.raw.fighter}: ${formatNumber(context.raw.x)} current / ${formatNumber(context.raw.y)} peak`
                    }
                }
            },
            scales: {
                x: { title: { display: true, text: 'Current Elo', color: dashboardColors.muted }, ticks: { color: dashboardColors.muted } },
                y: { title: { display: true, text: 'Peak Elo', color: dashboardColors.muted }, ticks: { color: dashboardColors.muted } }
            }
        })
    });

    const experienceBuckets = [
        ['1-2', fighter => fighter.fights < 3],
        ['3-4', fighter => fighter.fights >= 3 && fighter.fights < 5],
        ['5-9', fighter => fighter.fights >= 5 && fighter.fights < 10],
        ['10-19', fighter => fighter.fights >= 10 && fighter.fights < 20],
        ['20+', fighter => fighter.fights >= 20]
    ];
    createChart('overview-experience', 'experience-chart', {
        type: 'doughnut',
        data: {
            labels: experienceBuckets.map(bucket => `${bucket[0]} fights`),
            datasets: [{
                data: experienceBuckets.map(bucket => fighters.filter(bucket[1]).length),
                backgroundColor: [dashboardColors.coral, dashboardColors.gold, dashboardColors.teal, dashboardColors.violet, dashboardColors.ink],
                borderColor: '#ffffff',
                borderWidth: 3
            }]
        },
        options: chartOptions({
            cutout: '62%',
            scales: {},
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 8, color: dashboardColors.muted } }
            }
        })
    });
}

function populateLeaderboardFilters() {
    const weightClasses = [...new Set(dashboardState.data.fighters.map(fighter => fighter.weightClass))]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
    element('weight-class-filter').insertAdjacentHTML(
        'beforeend',
        weightClasses.map(weightClass => `<option value="${escapeHtml(weightClass)}">${escapeHtml(weightClass)}</option>`).join('')
    );
}

function filteredLeaderboardRows() {
    const search = element('fighter-search').value.trim().toLowerCase();
    const weightClass = element('weight-class-filter').value;
    const activity = element('activity-filter').value;
    const form = element('form-filter').value;
    const metric = element('rating-metric-filter').value;
    const sort = element('leaderboard-sort').value;
    const minimumFights = Number(element('minimum-fights').value || 0);
    const minimumRating = Number(element('minimum-rating').value || 0);
    const snapshotDate = new Date(`${dashboardState.data.meta.latestFightDate}T00:00:00`);

    const rows = dashboardState.data.fighters.filter(fighter => {
        if (search && !fighter.name.toLowerCase().includes(search)) {
            return false;
        }
        if (weightClass !== 'all' && fighter.weightClass !== weightClass) {
            return false;
        }
        if (fighter.fights < minimumFights || fighter[metric] < minimumRating) {
            return false;
        }
        if (activity !== 'all') {
            const cutoff = new Date(snapshotDate);
            cutoff.setFullYear(cutoff.getFullYear() - Number(activity));
            if (new Date(`${fighter.lastFight}T00:00:00`) < cutoff) {
                return false;
            }
        }
        if (form === 'winning' && !fighter.streak.startsWith('W')) {
            return false;
        }
        if (form === 'losing' && !fighter.streak.startsWith('L')) {
            return false;
        }
        if (form === 'positive' && fighter.ratingTrend <= 0) {
            return false;
        }
        return true;
    });

    rows.sort((a, b) => {
        switch (sort) {
        case 'rating-asc': return a[metric] - b[metric];
        case 'fights-desc': return b.fights - a.fights || b[metric] - a[metric];
        case 'win-desc': return b.winPct - a.winPct || b.fights - a.fights;
        case 'trend-desc': return b.ratingTrend - a.ratingTrend;
        case 'recent-desc': return b.lastFight.localeCompare(a.lastFight);
        case 'name-asc': return a.name.localeCompare(b.name);
        default: return b[metric] - a[metric];
        }
    });
    return rows;
}

function renderLeaderboard() {
    const rows = filteredLeaderboardRows();
    dashboardState.leaderboardRows = rows;
    const pageSize = Number(element('leaderboard-page-size').value);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    dashboardState.leaderboardPage = Math.min(dashboardState.leaderboardPage, pages);
    const start = (dashboardState.leaderboardPage - 1) * pageSize;
    const pageRows = rows.slice(start, start + pageSize);
    const body = element('leaderboard-body');

    body.innerHTML = pageRows.length ? pageRows.map((fighter, index) => {
        const trendClass = fighter.ratingTrend > 0 ? 'trend-positive' : fighter.ratingTrend < 0 ? 'trend-negative' : '';
        const trendPrefix = fighter.ratingTrend > 0 ? '+' : '';
        return `
            <tr>
                <td class="rank-number">${start + index + 1}</td>
                <td><button class="fighter-table-button" type="button" data-matchup-fighter="${escapeHtml(fighter.name)}">${escapeHtml(fighter.name)}</button></td>
                <td>${escapeHtml(fighter.weightClass)}</td>
                <td class="rating-cell">${formatNumber(fighter.currentRating, 0)}</td>
                <td>${formatNumber(fighter.peakRating, 0)}</td>
                <td>${recordText(fighter)}</td>
                <td>${formatPercent(fighter.winPct, 1)}</td>
                <td>${fighter.fights}</td>
                <td class="${trendClass}">${trendPrefix}${formatNumber(fighter.ratingTrend, 0)}</td>
                <td>${formDots(fighter.form)}</td>
                <td>${formatDate(fighter.lastFight)}</td>
            </tr>`;
    }).join('') : '<tr><td class="table-empty" colspan="11">No fighters match the selected filters.</td></tr>';

    element('leaderboard-count').textContent = `${formatNumber(rows.length)} ${rows.length === 1 ? 'fighter' : 'fighters'}`;
    element('leaderboard-page-status').textContent = `Page ${dashboardState.leaderboardPage} of ${pages}`;
    element('leaderboard-previous').disabled = dashboardState.leaderboardPage <= 1;
    element('leaderboard-next').disabled = dashboardState.leaderboardPage >= pages;
    element('minimum-fights-output').textContent = element('minimum-fights').value;
    renderLeaderboardCharts(rows);
}

function renderLeaderboardCharts(rows) {
    const metric = element('rating-metric-filter').value;
    const label = metric === 'currentRating' ? 'Current Elo' : 'Peak Elo';
    const top = [...rows].sort((a, b) => b[metric] - a[metric]).slice(0, 12).reverse();
    createChart('leaderboard-top', 'leaderboard-top-chart', {
        type: 'bar',
        data: {
            labels: top.map(fighter => fighter.name),
            datasets: [{ label, data: top.map(fighter => fighter[metric]), backgroundColor: dashboardColors.teal, borderRadius: 3 }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 9 } } }
            }
        })
    });

    const distribution = histogram(rows.map(fighter => fighter[metric]));
    createChart('leaderboard-histogram', 'leaderboard-histogram-chart', {
        type: 'bar',
        data: {
            labels: distribution.labels,
            datasets: [{ label: 'Fighters', data: distribution.counts, backgroundColor: dashboardColors.violet, borderRadius: 3 }]
        },
        options: chartOptions({ plugins: { legend: { display: false } } })
    });
}

function populateMatchupSelectors() {
    const fighters = [...dashboardState.data.fighters].sort((a, b) => a.name.localeCompare(b.name));
    const options = fighters.map(fighter => `<option value="${escapeHtml(fighter.name)}">${escapeHtml(fighter.name)} | ${formatNumber(fighter.currentRating, 0)}</option>`).join('');
    element('matchup-fighter-one').innerHTML = options;
    element('matchup-fighter-two').innerHTML = options;

    element('matchup-fighter-one').value = dashboardState.fighterMap.has('Jon Jones') ? 'Jon Jones' : fighters[0].name;
    element('matchup-fighter-two').value = dashboardState.fighterMap.has('Tom Aspinall') ? 'Tom Aspinall' : fighters[1].name;
}

function preferredMatchupOpponent(fighterName) {
    const preferred = ['Jon Jones', 'Tom Aspinall', 'Islam Makhachev', 'Alex Pereira'];
    const match = preferred.find(name => name !== fighterName && dashboardState.fighterMap.has(name));
    return match || dashboardState.data.fighters.find(fighter => fighter.name !== fighterName)?.name;
}

function matchupReliability(fighterOne, fighterTwo) {
    const sample = Math.min(fighterOne.fights, fighterTwo.fights);
    if (sample >= 7) {
        return ['Established', 'established'];
    }
    if (sample >= 3) {
        return ['Developing', 'developing'];
    }
    return ['Limited', 'limited'];
}

function renderMatchup() {
    const fighterOne = dashboardState.fighterMap.get(element('matchup-fighter-one').value);
    let fighterTwo = dashboardState.fighterMap.get(element('matchup-fighter-two').value);
    if (!fighterOne || !fighterTwo) {
        return;
    }
    if (fighterOne.name === fighterTwo.name) {
        fighterTwo = dashboardState.fighterMap.get(preferredMatchupOpponent(fighterOne.name));
        element('matchup-fighter-two').value = fighterTwo.name;
    }

    const probabilityOne = ratingProbability(fighterOne.currentRating, fighterTwo.currentRating);
    const probabilityTwo = 1 - probabilityOne;
    const interval = wilsonInterval(probabilityOne, Math.min(fighterOne.fights, fighterTwo.fights));
    const [reliability, reliabilityClass] = matchupReliability(fighterOne, fighterTwo);

    element('probability-name-one').textContent = fighterOne.name;
    element('probability-name-two').textContent = fighterTwo.name;
    element('probability-one').textContent = formatPercent(probabilityOne * 100, 1);
    element('probability-two').textContent = formatPercent(probabilityTwo * 100, 1);
    element('probability-bar-one').style.width = `${probabilityOne * 100}%`;
    element('probability-bar-two').style.width = `${probabilityTwo * 100}%`;
    const ratingGap = fighterOne.currentRating - fighterTwo.currentRating;
    element('matchup-elo-gap').textContent = `${ratingGap >= 0 ? '+' : ''}${formatNumber(ratingGap, 0)} Elo for ${ratingGap >= 0 ? fighterOne.name : fighterTwo.name}`;
    element('matchup-confidence').textContent = interval
        ? `Fighter A 95% interval: ${formatPercent(interval[0] * 100, 1)}-${formatPercent(interval[1] * 100, 1)}`
        : '95% interval unavailable';
    element('matchup-reliability').textContent = reliability;
    element('matchup-reliability').className = `reliability-badge ${reliabilityClass}`;
    element('compare-heading-one').textContent = fighterOne.name;
    element('compare-heading-two').textContent = fighterTwo.name;

    renderMatchupComparison(fighterOne, fighterTwo);
    renderMatchupCharts(fighterOne, fighterTwo);
}

function renderMatchupComparison(fighterOne, fighterTwo) {
    const rows = [
        ['Current Elo', formatNumber(fighterOne.currentRating, 0), formatNumber(fighterTwo.currentRating, 0)],
        ['Peak Elo', formatNumber(fighterOne.peakRating, 0), formatNumber(fighterTwo.peakRating, 0)],
        ['UFC record', recordText(fighterOne), recordText(fighterTwo)],
        ['Win rate', formatPercent(fighterOne.winPct, 1), formatPercent(fighterTwo.winPct, 1)],
        ['Finish rate', formatPercent(fighterOne.finishPct, 1), formatPercent(fighterTwo.finishPct, 1)],
        ['Current streak', fighterOne.streak, fighterTwo.streak],
        ['Significant strikes / min', formatNumber(fighterOne.strikesLandedPerMin, 2), formatNumber(fighterTwo.strikesLandedPerMin, 2)],
        ['Strikes absorbed / min', formatNumber(fighterOne.strikesAbsorbedPerMin, 2), formatNumber(fighterTwo.strikesAbsorbedPerMin, 2)],
        ['Striking accuracy', formatPercent(fighterOne.strikingAccuracy, 1), formatPercent(fighterTwo.strikingAccuracy, 1)],
        ['Takedowns / 15 min', formatNumber(fighterOne.takedownsPer15, 2), formatNumber(fighterTwo.takedownsPer15, 2)],
        ['Takedown accuracy', formatPercent(fighterOne.takedownAccuracy, 1), formatPercent(fighterTwo.takedownAccuracy, 1)],
        ['Sub attempts / 15 min', formatNumber(fighterOne.submissionAttemptsPer15, 2), formatNumber(fighterTwo.submissionAttemptsPer15, 2)],
        ['Control time share', formatPercent(fighterOne.controlPct, 1), formatPercent(fighterTwo.controlPct, 1)],
        ['Style cluster', fighterOne.style, fighterTwo.style],
        ['Age at last fight', formatNumber(fighterOne.ageAtLastFight, 1), formatNumber(fighterTwo.ageAtLastFight, 1)],
        ['Last fight', formatDate(fighterOne.lastFight), formatDate(fighterTwo.lastFight)]
    ];
    element('matchup-comparison-body').innerHTML = rows.map(row => `
        <tr><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[2])}</td></tr>
    `).join('');
}

function radarValues(fighter) {
    const ratings = dashboardState.data.fighters.map(item => item.currentRating);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const ratingScore = ((fighter.currentRating - minRating) / (maxRating - minRating)) * 100;
    const striking = Math.min(100, (fighter.strikesLandedPerMin / 10) * 100);
    const defense = Math.max(0, 100 - ((fighter.strikesAbsorbedPerMin / 10) * 100));
    const grappling = Math.min(100, (fighter.takedownsPer15 * 14) + (fighter.submissionAttemptsPer15 * 18) + fighter.controlPct);
    return [ratingScore, fighter.winPct, fighter.finishPct, striking, defense, grappling];
}

function renderMatchupCharts(fighterOne, fighterTwo) {
    const dates = [...new Set([
        ...fighterOne.history.map(point => point[0]),
        ...fighterTwo.history.map(point => point[0])
    ])].sort();
    const historyMapOne = new Map(fighterOne.history);
    const historyMapTwo = new Map(fighterTwo.history);

    createChart('matchup-history', 'matchup-history-chart', {
        type: 'line',
        data: {
            labels: dates.map(date => formatDate(date)),
            datasets: [
                {
                    label: fighterOne.name,
                    data: dates.map(date => historyMapOne.get(date) ?? null),
                    borderColor: dashboardColors.teal,
                    backgroundColor: dashboardColors.tealSoft,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    spanGaps: true,
                    tension: 0.18
                },
                {
                    label: fighterTwo.name,
                    data: dates.map(date => historyMapTwo.get(date) ?? null),
                    borderColor: dashboardColors.violet,
                    backgroundColor: dashboardColors.violetSoft,
                    pointRadius: 2,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                    spanGaps: true,
                    tension: 0.18
                }
            ]
        },
        options: chartOptions({
            scales: {
                x: { grid: { display: false }, ticks: { color: dashboardColors.muted, maxTicksLimit: 8, maxRotation: 0 } },
                y: { grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } }
            }
        })
    });

    createChart('matchup-radar', 'matchup-radar-chart', {
        type: 'radar',
        data: {
            labels: ['Elo', 'Win rate', 'Finishing', 'Striking', 'Defense', 'Grappling'],
            datasets: [
                {
                    label: fighterOne.name,
                    data: radarValues(fighterOne),
                    borderColor: dashboardColors.teal,
                    backgroundColor: dashboardColors.tealSoft,
                    pointBackgroundColor: dashboardColors.teal
                },
                {
                    label: fighterTwo.name,
                    data: radarValues(fighterTwo),
                    borderColor: dashboardColors.violet,
                    backgroundColor: dashboardColors.violetSoft,
                    pointBackgroundColor: dashboardColors.violet
                }
            ]
        },
        options: chartOptions({
            scales: {
                r: {
                    min: 0,
                    max: 100,
                    ticks: { display: false },
                    grid: { color: 'rgba(102,113,125,.18)' },
                    angleLines: { color: 'rgba(102,113,125,.18)' },
                    pointLabels: { color: dashboardColors.muted, font: { size: 10, weight: 650 } }
                }
            }
        })
    });
}

function populateFightCards() {
    element('fight-card-select').innerHTML = dashboardState.data.cards.map((card, index) => (
        `<option value="${index}">${formatDate(card.date)} | ${card.predicted.length + card.insufficient.length} ${(card.predicted.length + card.insufficient.length) === 1 ? 'fight' : 'fights'}</option>`
    )).join('');
}

function renderFightCard() {
    const card = dashboardState.data.cards[dashboardState.selectedCardIndex];
    if (!card) {
        return;
    }
    dashboardState.selectedFightIndex = Math.min(dashboardState.selectedFightIndex, Math.max(0, card.predicted.length - 1));
    element('fight-card-select').value = String(dashboardState.selectedCardIndex);
    element('selected-card-date').textContent = formatDate(card.date);
    element('selected-card-predicted').textContent = card.predicted.length;
    element('selected-card-insufficient').textContent = card.insufficient.length;
    element('insufficient-count').textContent = `${card.insufficient.length} ${card.insufficient.length === 1 ? 'fight' : 'fights'}`;

    element('ranked-fights-list').innerHTML = card.predicted.length ? card.predicted.map((fight, index) => {
        const other = fight.favorite === fight.fighterOne ? fight.fighterTwo : fight.fighterOne;
        const consensus = fight.availableSignals ? (fight.agreement / fight.availableSignals) * 100 : 0;
        return `
            <button class="fight-rank-button ${index === dashboardState.selectedFightIndex ? 'active' : ''}" type="button" data-fight-index="${index}">
                <span class="fight-rank">${index + 1}</span>
                <span class="fight-names"><strong>${escapeHtml(fight.favorite)} | ${formatPercent(fight.favoriteProbability * 100, 1)}</strong><span>vs ${escapeHtml(other)}</span></span>
                <span class="consensus-meter"><span><i style="width:${consensus}%"></i></span><small>${fight.agreement}/${fight.availableSignals} signals favor pick</small></span>
                <span class="fight-gap"><strong>${formatNumber(fight.probabilityGap, 1)}</strong><small>pt gap</small></span>
            </button>`;
    }).join('') : '<div class="empty-fights">No scenario-model predictions are available for this card.</div>';

    element('insufficient-fights-list').innerHTML = card.insufficient.length ? card.insufficient.map(fight => `
        <article class="insufficient-fight"><strong>${escapeHtml(fight.fighterOne)} vs ${escapeHtml(fight.fighterTwo)}</strong><span>${escapeHtml(fight.reason)}</span></article>
    `).join('') : '<div class="empty-fights">Every generated fight on this card has a scenario prediction.</div>';

    renderCardEdgeChart(card);
    renderFightDetail(card.predicted[dashboardState.selectedFightIndex]);
}

function renderCardEdgeChart(card) {
    const fights = [...card.predicted].slice(0, 12).reverse();
    createChart('card-edge', 'fight-card-edge-chart', {
        type: 'bar',
        data: {
            labels: fights.map(fight => `${fight.fighterOne} vs ${fight.fighterTwo}`),
            datasets: [{
                label: 'Probability gap',
                data: fights.map(fight => fight.probabilityGap),
                backgroundColor: fights.map(fight => fight.probabilityGap >= 40 ? dashboardColors.coral : fight.probabilityGap >= 20 ? dashboardColors.gold : dashboardColors.teal),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: context => `${formatNumber(context.raw, 1)} percentage-point gap` } }
            },
            scales: {
                x: { min: 0, max: 100, ticks: { color: dashboardColors.muted, callback: value => `${value} pts` } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 9 } } }
            }
        })
    });
}

function renderFightDetail(fight) {
    if (!fight) {
        element('fight-detail-title').textContent = 'No ranked prediction available';
        element('fight-detail-probabilities').innerHTML = '';
        element('fight-detail-stats').innerHTML = '';
        dashboardState.charts.get('fight-signals')?.destroy();
        return;
    }
    const fighterOne = dashboardState.fighterMap.get(fight.fighterOne);
    const fighterTwo = dashboardState.fighterMap.get(fight.fighterTwo);
    const eloProbability = fighterOne && fighterTwo
        ? ratingProbability(fighterOne.currentRating, fighterTwo.currentRating)
        : null;

    element('fight-detail-title').textContent = `${fight.fighterOne} vs ${fight.fighterTwo}`;
    element('fight-detail-probabilities').innerHTML = `
        <div class="fight-probability-row">
            <div><span>${escapeHtml(fight.fighterOne)} ${formatPercent(fight.probabilityOne * 100, 1)}</span><span>${escapeHtml(fight.fighterTwo)} ${formatPercent(fight.probabilityTwo * 100, 1)}</span></div>
            <div class="fight-probability-mini"><i style="width:${fight.probabilityOne * 100}%"></i><i style="width:${fight.probabilityTwo * 100}%"></i></div>
        </div>`;

    const stats = [
        ['Model favorite', fight.favorite],
        ['Probability gap', `${formatNumber(fight.probabilityGap, 1)} pts`],
        ['Signal agreement', `${fight.agreement}/${fight.availableSignals}`],
        ['Elo projection', eloProbability === null ? '-' : `${formatPercent(eloProbability * 100, 1)} / ${formatPercent((1 - eloProbability) * 100, 1)}`],
        ['Current Elo', fighterOne && fighterTwo ? `${formatNumber(fighterOne.currentRating, 0)} / ${formatNumber(fighterTwo.currentRating, 0)}` : '-'],
        ['UFC samples', fighterOne && fighterTwo ? `${fighterOne.fights} / ${fighterTwo.fights}` : '-']
    ];
    element('fight-detail-stats').innerHTML = stats.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');

    createChart('fight-signals', 'fight-signals-chart', {
        type: 'bar',
        data: {
            labels: fight.signals.map(signal => signal.label),
            datasets: [{
                label: `${fight.favorite} signal`,
                data: fight.signals.map(signal => signal.value === null ? 0 : signal.value * 100),
                backgroundColor: fight.signals.map(signal => signal.value === null ? dashboardColors.line : signal.value >= 0.5 ? dashboardColors.teal : dashboardColors.coral),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: context => fight.signals[context.dataIndex].value === null ? 'Not enough fights' : formatPercent(context.raw, 1) } }
            },
            scales: {
                x: { min: 0, max: 100, ticks: { color: dashboardColors.muted, callback: value => `${value}%` } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 9 } } }
            }
        })
    });
}

function renderMethodology() {
    const bins = dashboardState.data.eloBins;
    element('elo-calibration-body').innerHTML = bins.map(bin => `
        <tr><td>${escapeHtml(bin.range)}</td><td>${formatNumber(bin.fights)}</td><td>${formatPercent(bin.winPct, 1)}</td><td>${formatPercent(bin.lower, 1)}-${formatPercent(bin.upper, 1)}</td></tr>
    `).join('');

    createChart('elo-calibration', 'elo-calibration-chart', {
        type: 'line',
        data: {
            labels: bins.map(bin => bin.range),
            datasets: [
                {
                    label: 'Higher-rated fighter win rate',
                    data: bins.map(bin => bin.winPct),
                    borderColor: dashboardColors.teal,
                    backgroundColor: dashboardColors.tealSoft,
                    fill: true,
                    pointBackgroundColor: dashboardColors.teal,
                    tension: 0.18
                },
                {
                    label: 'Even chance',
                    data: bins.map(() => 50),
                    borderColor: dashboardColors.muted,
                    borderDash: [5, 5],
                    pointRadius: 0
                }
            ]
        },
        options: chartOptions({
            scales: {
                x: { grid: { display: false }, ticks: { color: dashboardColors.muted, maxRotation: 45, minRotation: 45 } },
                y: { min: 40, max: 100, ticks: { color: dashboardColors.muted, callback: value => `${value}%` } }
            }
        })
    });
}

function bindDashboardEvents() {
    document.querySelectorAll('[data-dashboard-view]').forEach(button => {
        button.addEventListener('click', () => setDashboardView(button.dataset.dashboardView));
    });

    const filterIds = [
        'fighter-search', 'weight-class-filter', 'activity-filter', 'form-filter',
        'rating-metric-filter', 'leaderboard-sort', 'minimum-fights',
        'minimum-rating', 'leaderboard-page-size'
    ];
    filterIds.forEach(id => {
        const control = element(id);
        const eventName = control.matches('input') ? 'input' : 'change';
        control.addEventListener(eventName, () => {
            dashboardState.leaderboardPage = 1;
            if (dashboardState.currentView === 'leaderboard') {
                renderLeaderboard();
            }
        });
    });

    element('leaderboard-filters').addEventListener('reset', () => {
        window.setTimeout(() => {
            dashboardState.leaderboardPage = 1;
            renderLeaderboard();
        }, 0);
    });
    element('leaderboard-previous').addEventListener('click', () => {
        dashboardState.leaderboardPage -= 1;
        renderLeaderboard();
    });
    element('leaderboard-next').addEventListener('click', () => {
        dashboardState.leaderboardPage += 1;
        renderLeaderboard();
    });
    element('leaderboard-body').addEventListener('click', event => {
        const button = event.target.closest('[data-matchup-fighter]');
        if (!button) {
            return;
        }
        element('matchup-fighter-one').value = button.dataset.matchupFighter;
        if (element('matchup-fighter-two').value === button.dataset.matchupFighter) {
            element('matchup-fighter-two').value = preferredMatchupOpponent(button.dataset.matchupFighter);
        }
        setDashboardView('matchup');
    });

    element('matchup-fighter-one').addEventListener('change', renderMatchup);
    element('matchup-fighter-two').addEventListener('change', renderMatchup);
    element('swap-matchup').addEventListener('click', () => {
        const first = element('matchup-fighter-one').value;
        element('matchup-fighter-one').value = element('matchup-fighter-two').value;
        element('matchup-fighter-two').value = first;
        renderMatchup();
    });

    element('fight-card-select').addEventListener('change', event => {
        dashboardState.selectedCardIndex = Number(event.target.value);
        dashboardState.selectedFightIndex = 0;
        renderFightCard();
    });
    element('ranked-fights-list').addEventListener('click', event => {
        const button = event.target.closest('[data-fight-index]');
        if (!button) {
            return;
        }
        dashboardState.selectedFightIndex = Number(button.dataset.fightIndex);
        renderFightCard();
    });
}

async function initializeDashboard() {
    try {
        const response = await fetch(UFC_DATA_URL);
        if (!response.ok) {
            throw new Error(`UFC data request failed with ${response.status}`);
        }
        const data = await response.json();
        dashboardState.data = data;
        dashboardState.fighterMap = new Map(data.fighters.map(fighter => [fighter.name, fighter]));

        Chart.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
        Chart.defaults.color = dashboardColors.muted;

        renderOverview();
        populateLeaderboardFilters();
        populateMatchupSelectors();
        populateFightCards();
        bindDashboardEvents();
        element('dashboard-loading').hidden = true;

        const requestedView = window.location.hash.replace('#', '');
        setDashboardView(requestedView || 'overview', false);
    } catch (error) {
        console.error(error);
        element('dashboard-loading').textContent = 'The UFC analytics data could not be loaded.';
    }
}

initializeDashboard();
