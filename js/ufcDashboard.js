const UFC_CACHE_KEY = Date.now();
const UFC_DATA_URL = `data/ufc-dashboard.json?v=${UFC_CACHE_KEY}`;
const UFC_MODEL_URL = `data/ufc-model.json?v=${UFC_CACHE_KEY}`;

const dashboardState = {
    data: null,
    modelBundle: null,
    modelEngine: null,
    fighterMap: new Map(),
    charts: new Map(),
    currentView: 'overview',
    renderedViews: new Set(),
    leaderboardPage: 1,
    leaderboardRows: [],
    selectedCardIndex: 0,
    selectedFightIndex: 0,
    selectedOrganization: 'UFC',
    modelMatchups: []
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

const modelCatalog = [
    {
        key: 'ensemble_score', title: 'Detailed Stats Ensemble', type: 'Primary model when eligible', primary: true,
        description: 'When both fighters have the required detailed statistics, selects the deepest available history scenario and combines every eligible component probability with a gradient forest, regardless of promotion.',
        equation: 'P(final) = reconcile(GBDT_scenario(component scores A->B), GBDT_scenario(B->A))'
    },
    {
        key: 'elo_score', title: 'Elo Baseline', type: 'Fallback model',
        description: 'Transforms the difference between current cross-promotion fighter ratings into an expected win probability. Every fighter receives an Elo score; matchups without complete telemetry use Elo only.',
        equation: 'P(A) = 1 / (1 + 10 ^ ((R_B - R_A) / 400))'
    },
    {
        key: 'base_logistic_score', title: 'Base Logistic', type: 'Statistical model',
        description: 'A logistic regression over latest-fight differences in striking, grappling, age, stance, and Elo. Multicollinear features are removed before fitting.',
        equation: 'P(A) = 1 / (1 + exp(-(beta_0 + sum(beta_j * delta_x_j))))'
    },
    {
        key: 'style_matchup_score', title: 'Style Matchup', type: 'Statistical model',
        description: 'Maps each fighter into one of three learned style clusters, one-hot encodes the pairing, and applies a style-interaction logistic coefficient.',
        equation: 'P(A) = logistic(alpha_0 + alpha_(style_A, style_B))'
    },
    {
        key: 'moving_avg_3_score', title: '3-Fight Window', type: 'History model',
        description: 'Compares each fighter\'s change across a three-fight performance window for twenty pace, target, grappling, and defensive metrics.',
        equation: 'delta_m = (x_A,t - x_A,t-3) - (x_B,t - x_B,t-3); P = logistic(beta * delta)'
    },
    {
        key: 'moving_avg_5_score', title: '5-Fight Window', type: 'History model',
        description: 'Extends the rolling logistic model with both three- and five-fight changes, requiring deeper shared history before it can produce a score.',
        equation: 'P(A) = logistic(beta_0 + beta_3 * delta_3 + beta_5 * delta_5)'
    },
    {
        key: 'moving_avg_7_score', title: '7-Fight Window', type: 'History model',
        description: 'Adds seven-fight performance changes to the three- and five-fight feature blocks for established fighters.',
        equation: 'P(A) = logistic(beta_0 + sum(beta_n * delta_n)), n in {3, 5, 7}'
    },
    {
        key: 'moving_avg_10_score', title: '10-Fight Window', type: 'History model',
        description: 'The deepest rolling logistic model uses three-, five-, seven-, and ten-fight changes and routes the matchup to the most experienced ensemble scenario.',
        equation: 'P(A) = logistic(beta_0 + sum(beta_n * delta_n)), n in {3, 5, 7, 10}'
    },
    {
        key: 'gradient_boost_score', title: 'Gradient Boost', type: 'Tree model',
        description: 'One hundred shallow decision trees learn nonlinear interactions among the latest statistical differences, stances, ages, and Elo features.',
        equation: 'P(A) = logistic(F_0 + 0.1 * sum(tree_m(x))), m = 1..100'
    },
    {
        key: 'multi_layer_perceptron_score', title: 'Neural Network', type: 'Neural model',
        description: 'A feed-forward multilayer perceptron processes the same latest-fight difference features through learned dense layers and a logistic output.',
        equation: 'P(A) = logistic(W_L * phi(... phi(W_1 x + b_1)) + b_L)'
    }
];

const signalKeyByLabel = {
    'Base logistic': 'base_logistic_score',
    'Style matchup': 'style_matchup_score',
    '3-fight window': 'moving_avg_3_score',
    '5-fight window': 'moving_avg_5_score',
    '7-fight window': 'moving_avg_7_score',
    '10-fight window': 'moving_avg_10_score',
    'Gradient boost': 'gradient_boost_score',
    'Neural network': 'multi_layer_perceptron_score'
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

function fairOdds(probability) {
    const bounded = Math.min(0.999, Math.max(0.001, probability));
    const decimal = 1 / bounded;
    const american = bounded >= 0.5
        ? -Math.round((100 * bounded) / (1 - bounded))
        : Math.round((100 * (1 - bounded)) / bounded);
    return {
        american: american > 0 ? `+${american}` : String(american),
        decimal: decimal.toFixed(2)
    };
}

function fairOddsText(probability) {
    const odds = fairOdds(probability);
    return `${odds.american} | ${odds.decimal} decimal`;
}

function probabilityRangeMarkup(name, probability, interval, tone) {
    const range = interval || [probability, probability];
    const lower = Math.max(0, range[0]);
    const upper = Math.min(1, range[1]);
    const rangeLabel = `${formatPercent(lower * 100, 1)}-${formatPercent(upper * 100, 1)}`;
    return `
        <div class="probability-range-row">
            <div class="probability-range-label">
                <strong>${escapeHtml(name)}</strong>
                <span>${formatPercent(probability * 100, 1)} | Fair ${escapeHtml(fairOddsText(probability))}</span>
            </div>
            <div class="probability-range-track" role="img" aria-label="${escapeHtml(name)} projected at ${formatPercent(probability * 100, 1)} with a 95% range of ${rangeLabel}">
                <span class="probability-range-line ${tone}" style="left:${lower * 100}%;width:${Math.max(0, (upper - lower) * 100)}%"></span>
                <i class="probability-range-point ${tone}" style="left:${probability * 100}%"></i>
            </div>
            <div class="probability-range-scale"><span>0%</span><strong>95% range ${rangeLabel}</strong><span>100%</span></div>
        </div>`;
}

function formDots(form) {
    if (!form) {
        return '<span>-</span>';
    }
    const dots = form.split('').map(result => {
        const className = result === 'W' ? 'win' : result === 'L' ? 'loss' : 'draw';
        return `<i class="${className}" title="${result === 'W' ? 'Win' : result === 'L' ? 'Loss' : 'Draw'}"></i>`;
    }).join('');
    return `<span class="form-dots" aria-label="Last five results ${escapeHtml(form)}">${dots}</span>`;
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
    const available = ['overview', 'leaderboard', 'matchup', 'cards', 'models', 'methodology'];
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
    if (view === 'models') {
        renderModelExplorer();
    }
    if (view === 'methodology' && !dashboardState.renderedViews.has(view)) {
        renderMethodology();
    }
    dashboardState.renderedViews.add(view);
}

function renderOverview() {
    const { meta } = dashboardState.data;
    const organizer = selectedOrganizer();
    const fighters = fightersForOrganization(organizer?.name);
    element('snapshot-generated').textContent = formatTimestamp(meta.generatedAt);
    element('snapshot-latest').textContent = formatDate(meta.latestFightDate);
    element('metric-fighters').textContent = formatNumber(fighters.length);
    element('metric-established').textContent = formatNumber(organizer?.fightCount ?? meta.fightCount);
    element('metric-cards').textContent = formatNumber(meta.organizerCount);
    element('metric-predictions').textContent = formatNumber(
        cardsForOrganization(organizer?.name).reduce((total, card) => total + card.predicted.length, 0)
    );
    element('metric-insufficient').textContent = formatNumber(meta.ufcAdvancedProfileCount);
    element('organization-fights').textContent = formatNumber(organizer?.fightCount ?? meta.fightCount);
    element('organization-fighters').textContent = formatNumber(fighters.length);
    element('organization-latest').textContent = formatDate(organizer?.latestFightDate ?? meta.latestFightDate);
    const badge = element('organization-primary-badge');
    badge.textContent = organizer?.name === 'UFC' ? 'Primary focus' : 'Cross-promotion coverage';
    badge.classList.toggle('is-secondary', organizer?.name !== 'UFC');
}

function renderOverviewCharts() {
    const fighters = fightersForOrganization();
    const topFighters = [...fighters].sort((a, b) => b.currentRating - a.currentRating).slice(0, 15);
    createChart('overview-top', 'top-ratings-chart', {
        type: 'bar',
        data: {
            labels: topFighters.map(fighter => fighter.name),
            datasets: [{
                label: 'Current Elo',
                data: topFighters.map(fighter => fighter.currentRating),
                backgroundColor: topFighters.map((_, index) => index < 3 ? dashboardColors.coral : dashboardColors.teal),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: { legend: { display: false } },
            scales: {
                x: { min: 0, beginAtZero: true, grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } },
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
        options: chartOptions({ plugins: { legend: { display: false } }, scales: { y: { min: 0, beginAtZero: true, grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } } } })
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

function selectedOrganizer() {
    return dashboardState.data.organizers.find(item => item.name === dashboardState.selectedOrganization)
        || dashboardState.data.organizers[0];
}

function fightersForOrganization(organization = dashboardState.selectedOrganization) {
    if (!organization || organization === 'all') return dashboardState.data.fighters;
    return dashboardState.data.fighters.filter(fighter => fighter.organizations?.includes(organization));
}

function cardsForOrganization(organization = dashboardState.selectedOrganization) {
    if (!organization || organization === 'all') return dashboardState.data.cards;
    return dashboardState.data.cards.filter(card => card.organizer === organization);
}

function organizationOptions(includeAll = false) {
    const organizers = [...dashboardState.data.organizers]
        .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || b.fightCount - a.fightCount);
    return [
        ...(includeAll ? ['<option value="all">All promotions</option>'] : []),
        ...organizers.map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)} · ${formatNumber(item.fightCount)} fights</option>`)
    ].join('');
}

function populateOrganizationControls() {
    element('organization-select').innerHTML = organizationOptions();
    element('organization-select').value = dashboardState.selectedOrganization;
    ['matchup-organization-one', 'matchup-organization-two'].forEach(id => {
        element(id).innerHTML = organizationOptions(true);
        element(id).value = 'UFC';
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
        if (!fighter.organizations?.includes(dashboardState.selectedOrganization)) {
            return false;
        }
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
                <td>${escapeHtml(fighter.lastOrganizer || fighter.organizations?.[0] || '-')}</td>
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
    const top = [...rows].sort((a, b) => b[metric] - a[metric]).slice(0, 12);
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
                x: { min: 0, beginAtZero: true, grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } },
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
        options: chartOptions({ plugins: { legend: { display: false } }, scales: { y: { min: 0, beginAtZero: true, grid: { color: 'rgba(102,113,125,.12)' }, ticks: { color: dashboardColors.muted } } } })
    });
}

function populateMatchupSelectors() {
    const fighters = [...fightersForOrganization('UFC')].sort((a, b) => b.currentRating - a.currentRating);
    setMatchupFighter('one', dashboardState.fighterMap.has('Jon Jones') ? 'Jon Jones' : fighters[0].name, false);
    setMatchupFighter('two', dashboardState.fighterMap.has('Tom Aspinall') ? 'Tom Aspinall' : fighters[1].name, false);
    updateCrossPromotionNote();
}

function normalizedFighterSearch(value) {
    return String(value || '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function fighterSearchMatches(query, organization = 'all') {
    const normalized = normalizedFighterSearch(query);
    if (!normalized) return [];
    const tokens = normalized.split(' ').filter(Boolean);
    return dashboardState.data.fighters
        .filter(fighter => {
            const text = normalizedFighterSearch(`${fighter.name} ${fighter.weightClass} ${fighter.organizations?.join(' ')} ${fighter.currentRating} ${recordText(fighter)}`);
            return (organization === 'all' || fighter.organizations?.includes(organization))
                && tokens.every(token => text.includes(token));
        })
        .sort((a, b) => {
            const nameA = normalizedFighterSearch(a.name);
            const nameB = normalizedFighterSearch(b.name);
            const scoreA = nameA === normalized ? 0 : nameA.startsWith(normalized) ? 1 : nameA.includes(normalized) ? 2 : 3;
            const scoreB = nameB === normalized ? 0 : nameB.startsWith(normalized) ? 1 : nameB.includes(normalized) ? 2 : 3;
            return scoreA - scoreB || b.currentRating - a.currentRating || a.name.localeCompare(b.name);
        })
        .slice(0, 12);
}

function setMatchupFighter(side, fighterName, shouldRender = true) {
    if (!dashboardState.fighterMap.has(fighterName)) return;
    const fighter = dashboardState.fighterMap.get(fighterName);
    const input = element(`matchup-fighter-${side}`);
    input.value = fighterName;
    input.dataset.selectedName = fighterName;
    input.setAttribute('aria-invalid', 'false');
    const organizationSelect = element(`matchup-organization-${side}`);
    if (organizationSelect.value !== 'all' && !fighter.organizations?.includes(organizationSelect.value)) {
        organizationSelect.value = fighter.lastOrganizer || fighter.organizations?.[0] || 'all';
    }
    updateCrossPromotionNote();
    if (shouldRender) renderMatchup();
}

function renderFighterSearchResults(input, query = input.value) {
    const side = input.id.endsWith('one') ? 'one' : 'two';
    const results = element(`fighter-results-${side}`);
    const organization = element(`matchup-organization-${side}`).value;
    const matches = fighterSearchMatches(query, organization);
    results.innerHTML = matches.length ? matches.map((fighter, index) => `<button type="button" role="option" aria-selected="${index === 0}" data-fighter-search-result="${escapeHtml(fighter.name)}" data-target-side="${side}">
        <strong>${escapeHtml(fighter.name)}</strong><em>${formatNumber(fighter.currentRating, 0)} Elo</em>
        <span>${escapeHtml(fighter.lastOrganizer || fighter.organizations?.[0] || 'MMA')} | ${recordText(fighter)} | ${formatNumber(fighter.fights)} modeled fights</span>
    </button>`).join('') : `<div class="fighter-search-empty">${query.trim() ? 'No fighters match this search.' : 'Type a fighter, division, record, or Elo rating.'}</div>`;
    results.hidden = false;
    input.setAttribute('aria-expanded', 'true');
}

function restoreFighterSearch(input) {
    input.value = input.dataset.selectedName || '';
    input.setAttribute('aria-invalid', 'false');
    const side = input.id.endsWith('one') ? 'one' : 'two';
    element(`fighter-results-${side}`).hidden = true;
    input.setAttribute('aria-expanded', 'false');
}

function preferredMatchupOpponent(fighterName) {
    const preferred = ['Jon Jones', 'Tom Aspinall', 'Islam Makhachev', 'Alex Pereira'];
    const match = preferred.find(name => name !== fighterName && dashboardState.fighterMap.has(name));
    return match || dashboardState.data.fighters.find(fighter => fighter.name !== fighterName)?.name;
}

function updateCrossPromotionNote() {
    const organizationOne = element('matchup-organization-one')?.value || 'all';
    const organizationTwo = element('matchup-organization-two')?.value || 'all';
    const crossPromotion = organizationOne !== 'all'
        && organizationTwo !== 'all'
        && organizationOne !== organizationTwo;
    element('cross-promotion-note').textContent = crossPromotion
        ? `Cross-promotion scenario: ${organizationOne} vs ${organizationTwo}. Advanced models activate whenever both fighters have complete detailed statistics.`
        : 'Choose different fighter promotions to create a cross-promotion fight. Elo remains available for every matchup.';
}

function selectTopFighterForOrganization(side) {
    const organization = element(`matchup-organization-${side}`).value;
    const selected = dashboardState.fighterMap.get(element(`matchup-fighter-${side}`).dataset.selectedName);
    if (organization === 'all' || selected?.organizations?.includes(organization)) {
        updateCrossPromotionNote();
        renderMatchup();
        return;
    }
    const replacement = [...fightersForOrganization(organization)]
        .sort((a, b) => b.currentRating - a.currentRating)[0];
    if (replacement) setMatchupFighter(side, replacement.name);
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

function scenarioLabel(scenario) {
    const labels = {
        '3to5': '3-fight scenario',
        '5to7': '5-fight scenario',
        '7to10': '7-fight scenario',
        over10: '10-fight scenario'
    };
    return labels[scenario] || 'No ensemble scenario';
}

function renderMatchup() {
    const fighterOneInput = element('matchup-fighter-one');
    const fighterTwoInput = element('matchup-fighter-two');
    const fighterOne = dashboardState.fighterMap.get(fighterOneInput.dataset.selectedName || fighterOneInput.value);
    let fighterTwo = dashboardState.fighterMap.get(fighterTwoInput.dataset.selectedName || fighterTwoInput.value);
    if (!fighterOne || !fighterTwo) {
        return;
    }
    if (fighterOne.name === fighterTwo.name) {
        fighterTwo = dashboardState.fighterMap.get(preferredMatchupOpponent(fighterOne.name));
        setMatchupFighter('two', fighterTwo.name, false);
    }

    const modelResult = dashboardState.modelEngine?.scoreMatchup(
        fighterOne.name,
        fighterTwo.name,
        fighterOne.lastOrganizer || 'UFC',
        dashboardState.data.meta.latestFightDate
    );
    const selectedScore = element('matchup-score-model').value;
    const effectiveScore = selectedScore === 'best_available_score'
        ? modelResult?.primaryScoreKey
        : selectedScore;
    const selectedLabel = selectedScore === 'best_available_score'
        ? UFC_SCORE_LABELS[effectiveScore] || 'Best available'
        : UFC_SCORE_LABELS[selectedScore] || 'Selected model';
    const selectedProbability = modelResult?.probabilities[selectedScore];
    const scoreAvailable = Number.isFinite(selectedProbability);
    const probabilityOne = scoreAvailable ? selectedProbability : 0.5;
    const probabilityTwo = 1 - probabilityOne;
    const interval = wilsonInterval(probabilityOne, Math.min(fighterOne.fights, fighterTwo.fights));
    const intervalTwo = interval ? [1 - interval[1], 1 - interval[0]] : null;
    const [reliability, reliabilityClass] = matchupReliability(fighterOne, fighterTwo);
    const availableScoreCount = modelResult
        ? UFC_SCORE_KEYS.filter(key => Number.isFinite(modelResult.probabilities[key])).length
        : 1;

    element('probability-name-one').textContent = fighterOne.name;
    element('probability-name-two').textContent = fighterTwo.name;
    element('probability-one').textContent = scoreAvailable ? formatPercent(probabilityOne * 100, 1) : 'N/A';
    element('probability-two').textContent = scoreAvailable ? formatPercent(probabilityTwo * 100, 1) : 'N/A';
    element('ufc-odds-name-one').textContent = fighterOne.name;
    element('ufc-odds-name-two').textContent = fighterTwo.name;
    element('ufc-odds-one').textContent = scoreAvailable ? fairOddsText(probabilityOne) : '-';
    element('ufc-odds-two').textContent = scoreAvailable ? fairOddsText(probabilityTwo) : '-';
    element('probability-bar-one').style.width = `${probabilityOne * 100}%`;
    element('probability-bar-two').style.width = `${probabilityTwo * 100}%`;
    element('matchup-probability-ranges').innerHTML = scoreAvailable ? [
        probabilityRangeMarkup(fighterOne.name, probabilityOne, interval, 'teal'),
        probabilityRangeMarkup(fighterTwo.name, probabilityTwo, intervalTwo, 'violet')
    ].join('') : '<div class="model-unavailable">This score is unavailable because the selected fighters do not share enough required model history.</div>';
    const ratingGap = fighterOne.currentRating - fighterTwo.currentRating;
    element('projection-kicker').textContent = `${selectedLabel} projection`;
    element('projection-heading').textContent = scoreAvailable ? 'Projected win probability' : 'Projection unavailable';
    element('matchup-elo-gap').textContent = `${selectedLabel} | ${ratingGap >= 0 ? '+' : ''}${formatNumber(ratingGap, 0)} Elo difference`;
    element('matchup-confidence').textContent = interval && scoreAvailable
        ? `95% model range using the smaller ${Math.min(fighterOne.fights, fighterTwo.fights)}-fight MMA sample`
        : '95% interval unavailable';
    element('matchup-reliability').textContent = effectiveScore === 'ensemble_score'
        ? scenarioLabel(modelResult?.scenario)
        : 'Elo only';
    element('matchup-reliability').className = `reliability-badge ${reliabilityClass}`;
    element('matchup-scenario').textContent = scenarioLabel(modelResult?.scenario);
    element('matchup-score-count').textContent = `${availableScoreCount} of ${UFC_SCORE_KEYS.length}`;
    element('compare-heading-one').textContent = fighterOne.name;
    element('compare-heading-two').textContent = fighterTwo.name;

    renderMatchupComparison(fighterOne, fighterTwo);
    renderMatchupCharts(fighterOne, fighterTwo, modelResult, effectiveScore);
}

function renderMatchupComparison(fighterOne, fighterTwo) {
    const coreRows = [
        ['Current promotion', fighterOne.lastOrganizer || '-', fighterTwo.lastOrganizer || '-'],
        ['Promotion history', fighterOne.organizations?.join(', ') || '-', fighterTwo.organizations?.join(', ') || '-'],
        ['Current Elo', formatNumber(fighterOne.currentRating, 0), formatNumber(fighterTwo.currentRating, 0)],
        ['Peak Elo', formatNumber(fighterOne.peakRating, 0), formatNumber(fighterTwo.peakRating, 0)],
        ['MMA record', recordText(fighterOne), recordText(fighterTwo)],
        ['Win rate', formatPercent(fighterOne.winPct, 1), formatPercent(fighterTwo.winPct, 1)],
        ['Finish rate', formatPercent(fighterOne.finishPct, 1), formatPercent(fighterTwo.finishPct, 1)],
        ['Current streak', fighterOne.streak, fighterTwo.streak],
        ['Recent win rate', formatPercent((fighterOne.recentWinRate ?? 0.5) * 100, 1), formatPercent((fighterTwo.recentWinRate ?? 0.5) * 100, 1)],
        ['Last fight', formatDate(fighterOne.lastFight), formatDate(fighterTwo.lastFight)]
    ];
    const advancedAvailable = dashboardState.modelEngine?.fighter(fighterOne.name)
        && dashboardState.modelEngine?.fighter(fighterTwo.name);
    const advancedRows = advancedAvailable ? [
        ['Significant strikes / min', formatNumber(fighterOne.strikesLandedPerMin, 2), formatNumber(fighterTwo.strikesLandedPerMin, 2)],
        ['Strikes absorbed / min', formatNumber(fighterOne.strikesAbsorbedPerMin, 2), formatNumber(fighterTwo.strikesAbsorbedPerMin, 2)],
        ['Striking accuracy', formatPercent(fighterOne.strikingAccuracy, 1), formatPercent(fighterTwo.strikingAccuracy, 1)],
        ['Takedowns / 15 min', formatNumber(fighterOne.takedownsPer15, 2), formatNumber(fighterTwo.takedownsPer15, 2)],
        ['Takedown accuracy', formatPercent(fighterOne.takedownAccuracy, 1), formatPercent(fighterTwo.takedownAccuracy, 1)],
        ['Sub attempts / 15 min', formatNumber(fighterOne.submissionAttemptsPer15, 2), formatNumber(fighterTwo.submissionAttemptsPer15, 2)],
        ['Control time share', formatPercent(fighterOne.controlPct, 1), formatPercent(fighterTwo.controlPct, 1)],
        ['Style cluster', fighterOne.style, fighterTwo.style],
        ['Age at last fight', formatNumber(fighterOne.ageAtLastFight, 1), formatNumber(fighterTwo.ageAtLastFight, 1)]
    ] : [];
    const rows = [...coreRows, ...advancedRows];
    element('matchup-comparison-body').innerHTML = rows.map(row => `
        <tr><td>${escapeHtml(row[1])}</td><td>${escapeHtml(row[0])}</td><td>${escapeHtml(row[2])}</td></tr>
    `).join('');
}

function radarValues(fighter) {
    const ratings = dashboardState.data.fighters.map(item => item.currentRating);
    const minRating = Math.min(...ratings);
    const maxRating = Math.max(...ratings);
    const ratingScore = ((fighter.currentRating - minRating) / (maxRating - minRating)) * 100;
    const experience = Math.min(100, Math.log1p(fighter.fights) / Math.log(41) * 100);
    const recentForm = (fighter.recentWinRate ?? 0.5) * 100;
    const activeDays = Math.max(0, (new Date(`${dashboardState.data.meta.latestFightDate}T00:00:00`) - new Date(`${fighter.lastFight}T00:00:00`)) / 86400000);
    const activity = Math.max(0, 100 - Math.min(100, activeDays / 7.3));
    return [ratingScore, fighter.winPct, fighter.finishPct, experience, recentForm, activity];
}

function renderMatchupCharts(fighterOne, fighterTwo, modelResult, selectedScore) {
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
            labels: ['Elo', 'Win rate', 'Finishing', 'Experience', 'Recent form', 'Activity'],
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

    const scoreRows = modelResult
        ? UFC_SCORE_KEYS
            .filter(key => Number.isFinite(modelResult.probabilities[key]))
            .map(key => ({ key, label: UFC_SCORE_LABELS[key], value: modelResult.probabilities[key] * 100 }))
            .sort((a, b) => b.value - a.value)
        : [];
    createChart('matchup-models', 'matchup-model-chart', {
        type: 'bar',
        data: {
            labels: scoreRows.map(item => item.label),
            datasets: [{
                label: `${fighterOne.name} win probability`,
                data: scoreRows.map(item => item.value),
                backgroundColor: scoreRows.map(item => item.key === selectedScore ? dashboardColors.coral : item.key === 'ensemble_score' ? dashboardColors.gold : dashboardColors.teal),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => formatPercent(context.raw, 1) } } },
            scales: {
                x: { min: 0, max: 100, ticks: { color: dashboardColors.muted, callback: value => `${value}%` } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 9 } } }
            }
        })
    });
}

function populateFightCards() {
    const visibleCards = dashboardState.data.cards;
    const select = element('fight-card-select');
    if (!visibleCards.length) {
        select.innerHTML = '<option value="-1">No upcoming MMA cards</option>';
        select.disabled = true;
        dashboardState.selectedCardIndex = -1;
        return;
    }
    select.disabled = false;
    select.innerHTML = visibleCards.map(card => {
        const index = dashboardState.data.cards.indexOf(card);
        const fightCount = card.predicted.length + card.insufficient.length;
        return `<option value="${index}">${escapeHtml(card.organizer)} | ${formatDate(card.date)} | ${escapeHtml(card.event)} · ${fightCount} ${fightCount === 1 ? 'fight' : 'fights'}</option>`;
    }).join('');
    dashboardState.selectedCardIndex = visibleCards.length
        ? dashboardState.data.cards.indexOf(visibleCards[0])
        : 0;
}

function renderFightCard() {
    const card = dashboardState.data.cards[dashboardState.selectedCardIndex];
    if (!card) {
        element('selected-card-date').textContent = '-';
        element('selected-card-predicted').textContent = '0';
        element('selected-card-insufficient').textContent = '0';
        element('insufficient-count').textContent = '0 fights';
        element('ranked-fights-list').innerHTML = '<div class="empty-fights">No upcoming MMA predictions are available in the current model export.</div>';
        element('insufficient-fights-list').innerHTML = '<div class="empty-fights">No card is selected.</div>';
        element('fight-detail-title').textContent = 'No card prediction available';
        element('fight-detail-probabilities').innerHTML = '';
        element('fight-detail-stats').innerHTML = '';
        ['card-edge', 'fight-signals'].forEach(key => {
            dashboardState.charts.get(key)?.destroy();
            dashboardState.charts.delete(key);
        });
        return;
    }
    dashboardState.selectedFightIndex = Math.min(dashboardState.selectedFightIndex, Math.max(0, card.predicted.length - 1));
    element('fight-card-select').value = String(dashboardState.selectedCardIndex);
    element('selected-card-date').textContent = `${card.organizer} · ${formatDate(card.date)}`;
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
    }).join('') : '<div class="empty-fights">No predictions are available for this card.</div>';

    element('insufficient-fights-list').innerHTML = card.insufficient.length ? card.insufficient.map(fight => `
        <article class="insufficient-fight"><strong>${escapeHtml(fight.fighterOne)} vs ${escapeHtml(fight.fighterTwo)}</strong><span>${escapeHtml(fight.reason)}</span></article>
    `).join('') : '<div class="empty-fights">Every fight on this card has at least an Elo prediction.</div>';

    renderCardEdgeChart(card);
    renderFightDetail(card.predicted[dashboardState.selectedFightIndex]);
}

function renderCardEdgeChart(card) {
    const fights = [...card.predicted].slice(0, 12);
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
    const sampleSize = fighterOne && fighterTwo ? Math.min(fighterOne.fights, fighterTwo.fights) : 0;
    const intervalOne = wilsonInterval(fight.probabilityOne, sampleSize);
    const intervalTwo = intervalOne ? [1 - intervalOne[1], 1 - intervalOne[0]] : null;

    element('fight-detail-title').textContent = `${fight.fighterOne} vs ${fight.fighterTwo}`;
    element('fight-detail-probabilities').innerHTML = `
        <div class="fight-probability-row">
            <div><span>${escapeHtml(fight.fighterOne)} ${formatPercent(fight.probabilityOne * 100, 1)}</span><span>${escapeHtml(fight.fighterTwo)} ${formatPercent(fight.probabilityTwo * 100, 1)}</span></div>
            <div class="fight-probability-mini"><i style="width:${fight.probabilityOne * 100}%"></i><i style="width:${fight.probabilityTwo * 100}%"></i></div>
        </div>
        <div class="probability-ranges probability-ranges-compact">
            ${probabilityRangeMarkup(fight.fighterOne, fight.probabilityOne, intervalOne, 'teal')}
            ${probabilityRangeMarkup(fight.fighterTwo, fight.probabilityTwo, intervalTwo, 'violet')}
        </div>`;

    const stats = [
        ['Prediction model', fight.modelType || 'Elo only'],
        ['Model favorite', fight.favorite],
        ['Probability gap', `${formatNumber(fight.probabilityGap, 1)} pts`],
        ['Signal agreement', `${fight.agreement}/${fight.availableSignals}`],
        [`Fair odds: ${fight.fighterOne}`, fairOddsText(fight.probabilityOne)],
        [`Fair odds: ${fight.fighterTwo}`, fairOddsText(fight.probabilityTwo)],
        ['Elo projection', eloProbability === null ? '-' : `${formatPercent(eloProbability * 100, 1)} / ${formatPercent((1 - eloProbability) * 100, 1)}`],
        ['Current Elo', fighterOne && fighterTwo ? `${formatNumber(fighterOne.currentRating, 0)} / ${formatNumber(fighterTwo.currentRating, 0)}` : '-'],
        ['Host promotion', dashboardState.data.cards[dashboardState.selectedCardIndex]?.organizer || '-'],
        ['MMA samples', fighterOne && fighterTwo ? `${fighterOne.fights} / ${fighterTwo.fights}` : '-']
    ];
    element('fight-detail-stats').innerHTML = stats.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');

    const rankedSignals = [...fight.signals].sort((a, b) => {
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return b.value - a.value;
    });
    createChart('fight-signals', 'fight-signals-chart', {
        type: 'bar',
        data: {
            labels: rankedSignals.map(signal => signal.label),
            datasets: [{
                label: `${fight.favorite} signal`,
                data: rankedSignals.map(signal => signal.value === null ? 0 : signal.value * 100),
                backgroundColor: rankedSignals.map(signal => signal.value === null ? dashboardColors.line : signal.value >= 0.5 ? dashboardColors.teal : dashboardColors.coral),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: context => rankedSignals[context.dataIndex].value === null ? 'Not enough fights' : formatPercent(context.raw, 1) } }
            },
            scales: {
                x: { min: 0, max: 100, ticks: { color: dashboardColors.muted, callback: value => `${value}%` } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 9 } } }
            }
        })
    });
}

function populateModelExplorer() {
    dashboardState.modelMatchups = dashboardState.data.cards.flatMap((card, cardIndex) => (
        card.predicted.map((fight, fightIndex) => ({
            id: `${cardIndex}:${fightIndex}`,
            cardIndex,
            fightIndex,
            date: card.date,
            organizer: card.organizer,
            event: card.event,
            fight
        }))
    ));
    element('model-matchup-select').innerHTML = dashboardState.modelMatchups.map(item => (
        `<option value="${item.id}">${escapeHtml(item.organizer)} | ${formatDate(item.date)} | ${escapeHtml(item.fight.fighterOne)} vs ${escapeHtml(item.fight.fighterTwo)}</option>`
    )).join('');
    renderScenarioCards();
    renderModelCatalog();
}

function renderScenarioCards() {
    const order = ['3to5', '5to7', '7to10', 'over10'];
    const depth = { '3to5': 3, '5to7': 5, '7to10': 7, over10: 10 };
    element('scenario-cards').innerHTML = order.map(scenario => {
        const metrics = dashboardState.modelBundle.scenarios[scenario];
        const inputCount = dashboardState.modelBundle.models.ensemble[scenario].features.length;
        return `
            <article class="scenario-card">
                <span>Deepest shared window</span>
                <strong>${depth[scenario]} fights</strong>
                <dl>
                    <dt>Component inputs</dt><dd>${inputCount}</dd>
                    <dt>Test AUC</dt><dd>${metrics.auc === null ? '-' : formatNumber(metrics.auc, 3)}</dd>
                    <dt>Test accuracy</dt><dd>${metrics.accuracy === null ? '-' : formatPercent(metrics.accuracy * 100, 1)}</dd>
                    <dt>Test matchups</dt><dd>${formatNumber(metrics.testSize)}</dd>
                </dl>
            </article>`;
    }).join('');
}

function modelMetricMarkup(model) {
    if (model.key === 'ensemble_score') {
        const scenarios = Object.values(dashboardState.modelBundle.scenarios);
        const aucValues = scenarios.map(item => item.auc).filter(Number.isFinite);
        const accuracyValues = scenarios.map(item => item.accuracy).filter(Number.isFinite);
        return `
            <span>4 scenario forests</span>
            <span>Test AUC ${formatNumber(Math.min(...aucValues), 3)}-${formatNumber(Math.max(...aucValues), 3)}</span>
            <span>Accuracy ${formatPercent(Math.min(...accuracyValues) * 100, 1)}-${formatPercent(Math.max(...accuracyValues) * 100, 1)}</span>`;
    }
    if (model.key === 'elo_score') {
        return '<span>400-point logistic scale</span><span>Transparent baseline</span>';
    }
    const metrics = dashboardState.modelBundle.metrics[model.key];
    if (!metrics) return '<span>Generated component</span>';
    return `
        <span>AUC ${metrics.auc === null ? '-' : formatNumber(metrics.auc, 3)}</span>
        <span>Accuracy ${metrics.accuracy === null ? '-' : formatPercent(metrics.accuracy * 100, 1)}</span>
        ${metrics.observations ? `<span>${formatNumber(metrics.observations)} observations</span>` : ''}`;
}

function renderModelCatalog() {
    element('model-catalog').innerHTML = modelCatalog.map(model => `
        <article class="model-card ${model.primary ? 'primary' : ''}" data-model-card="${model.key}">
            <header><h3>${escapeHtml(model.title)}</h3><span>${escapeHtml(model.type)}</span></header>
            <p>${escapeHtml(model.description)}</p>
            <div class="model-equation">${escapeHtml(model.equation)}</div>
            <div class="model-metrics">${modelMetricMarkup(model)}</div>
        </article>
    `).join('');
}

function selectedGeneratedMatchup() {
    return dashboardState.modelMatchups.find(item => item.id === element('model-matchup-select').value)
        || dashboardState.modelMatchups[0];
}

function generatedModelScores(item) {
    if (!item) return null;
    const { fight } = item;
    const result = dashboardState.modelEngine?.scoreMatchup(
        fight.fighterOne,
        fight.fighterTwo,
        item.organizer,
        item.date
    );
    if (!result) return null;
    result.probabilities.elo_score = fight.eloProbabilityOne ?? result.probabilities.elo_score;
    if (Number.isFinite(fight.advancedEnsembleProbabilityOne)) {
        result.probabilities.ensemble_score = fight.advancedEnsembleProbabilityOne;
    }
    return result;
}

function renderModelScoreLab() {
    const item = selectedGeneratedMatchup();
    const result = generatedModelScores(item);
    if (!item || !result) return;
    const focus = element('model-focus-filter').value;
    const keys = (focus === 'all' ? UFC_SCORE_KEYS : [focus])
        .filter(key => Number.isFinite(result.probabilities[key]));
    const chartRows = keys.map(key => ({
        key,
        label: UFC_SCORE_LABELS[key],
        value: result.probabilities[key] * 100
    })).sort((a, b) => b.value - a.value);
    const fighterOne = item.fight.fighterOne;
    const fighterTwo = item.fight.fighterTwo;
    element('model-table-fighter-one').textContent = fighterOne;
    element('model-table-fighter-two').textContent = fighterTwo;
    element('model-score-chart-heading').textContent = focus === 'all' ? 'All Available Scores' : UFC_SCORE_LABELS[focus];

    const tableKeys = focus === 'all' ? UFC_SCORE_KEYS : [focus];
    element('model-score-body').innerHTML = tableKeys.map(key => {
        const value = result.probabilities[key];
        const available = Number.isFinite(value);
        return `
            <tr class="${key === 'ensemble_score' ? 'primary-model' : ''}">
                <td>${escapeHtml(UFC_SCORE_LABELS[key])}</td>
                <td>${available ? formatPercent(value * 100, 1) : '-'}</td>
                <td>${available ? formatPercent((1 - value) * 100, 1) : '-'}</td>
                <td>${available ? 'Yes' : 'Not enough history'}</td>
            </tr>`;
    }).join('');

    createChart('model-score', 'model-score-chart', {
        type: 'bar',
        data: {
            labels: chartRows.map(row => row.label),
            datasets: [{
                label: `${fighterOne} win probability`,
                data: chartRows.map(row => row.value),
                backgroundColor: chartRows.map(row => row.key === 'ensemble_score' ? dashboardColors.gold : dashboardColors.teal),
                borderRadius: 3
            }]
        },
        options: chartOptions({
            indexAxis: 'y',
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => formatPercent(context.raw, 1) } } },
            scales: {
                x: { min: 0, max: 100, ticks: { color: dashboardColors.muted, callback: value => `${value}%` } },
                y: { grid: { display: false }, ticks: { color: dashboardColors.ink, font: { size: 9 } } }
            }
        })
    });
}

function renderModelExplorer() {
    const focus = element('model-focus-filter').value;
    document.querySelectorAll('[data-model-card]').forEach(card => {
        card.hidden = focus !== 'all' && card.dataset.modelCard !== focus;
    });
    renderModelScoreLab();
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

    element('organization-select').addEventListener('change', event => {
        dashboardState.selectedOrganization = event.target.value;
        dashboardState.leaderboardPage = 1;
        dashboardState.selectedFightIndex = 0;
        renderOverview();
        renderOverviewCharts();
        populateFightCards();
        if (dashboardState.currentView === 'leaderboard') renderLeaderboard();
        if (dashboardState.currentView === 'cards') renderFightCard();
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
        setMatchupFighter('one', button.dataset.matchupFighter, false);
        if (element('matchup-fighter-two').dataset.selectedName === button.dataset.matchupFighter) {
            setMatchupFighter('two', preferredMatchupOpponent(button.dataset.matchupFighter), false);
        }
        setDashboardView('matchup');
    });

    element('matchup-controls').addEventListener('input', event => {
        const input = event.target.closest('#matchup-fighter-one, #matchup-fighter-two');
        if (!input) return;
        input.setAttribute('aria-invalid', 'false');
        renderFighterSearchResults(input);
    });
    element('matchup-controls').addEventListener('focusin', event => {
        const input = event.target.closest('#matchup-fighter-one, #matchup-fighter-two');
        if (!input) return;
        input.select();
        renderFighterSearchResults(input, input.dataset.selectedName || input.value);
    });
    element('matchup-controls').addEventListener('keydown', event => {
        const input = event.target.closest('#matchup-fighter-one, #matchup-fighter-two');
        if (!input) return;
        const side = input.id.endsWith('one') ? 'one' : 'two';
        const results = element(`fighter-results-${side}`);
        const firstResult = results.querySelector('[data-fighter-search-result]');
        if (event.key === 'Enter') {
            event.preventDefault();
            if (firstResult) {
                setMatchupFighter(side, firstResult.dataset.fighterSearchResult);
                restoreFighterSearch(input);
            } else {
                input.setAttribute('aria-invalid', 'true');
            }
        } else if (event.key === 'ArrowDown' && firstResult) {
            event.preventDefault();
            firstResult.focus();
        } else if (event.key === 'Escape') {
            restoreFighterSearch(input);
        }
    });
    element('matchup-controls').addEventListener('click', event => {
        const result = event.target.closest('[data-fighter-search-result]');
        if (!result) return;
        const input = element(`matchup-fighter-${result.dataset.targetSide}`);
        setMatchupFighter(result.dataset.targetSide, result.dataset.fighterSearchResult);
        restoreFighterSearch(input);
    });
    document.addEventListener('click', event => {
        document.querySelectorAll('.fighter-search-picker').forEach(picker => {
            if (!picker.contains(event.target)) {
                restoreFighterSearch(picker.querySelector('input'));
            }
        });
    });
    element('matchup-score-model').addEventListener('change', renderMatchup);
    ['one', 'two'].forEach(side => {
        element(`matchup-organization-${side}`).addEventListener('change', () => {
            selectTopFighterForOrganization(side);
        });
    });
    element('swap-matchup').addEventListener('click', () => {
        const first = element('matchup-fighter-one').dataset.selectedName;
        const second = element('matchup-fighter-two').dataset.selectedName;
        const firstOrganization = element('matchup-organization-one').value;
        const secondOrganization = element('matchup-organization-two').value;
        element('matchup-organization-one').value = secondOrganization;
        element('matchup-organization-two').value = firstOrganization;
        setMatchupFighter('one', second, false);
        setMatchupFighter('two', first, false);
        updateCrossPromotionNote();
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

    element('model-focus-filter').addEventListener('change', renderModelExplorer);
    element('model-matchup-select').addEventListener('change', renderModelScoreLab);
}

async function initializeDashboard() {
    try {
        const [dataResponse, modelResponse] = await Promise.all([
            fetch(UFC_DATA_URL),
            fetch(UFC_MODEL_URL)
        ]);
        if (!dataResponse.ok || !modelResponse.ok) {
            throw new Error(`MMA data request failed with ${dataResponse.status}/${modelResponse.status}`);
        }
        const [data, modelBundle] = await Promise.all([dataResponse.json(), modelResponse.json()]);
        dashboardState.data = data;
        dashboardState.modelBundle = modelBundle;
        dashboardState.fighterMap = new Map(data.fighters.map(fighter => [fighter.name, fighter]));
        dashboardState.modelEngine = new UfcModelEngine(modelBundle, dashboardState.fighterMap);

        Chart.defaults.font.family = 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif';
        Chart.defaults.color = dashboardColors.muted;

        populateOrganizationControls();
        renderOverview();
        populateLeaderboardFilters();
        populateMatchupSelectors();
        populateFightCards();
        populateModelExplorer();
        bindDashboardEvents();
        element('dashboard-loading').hidden = true;

        const requestedView = window.location.hash.replace('#', '');
        setDashboardView(requestedView || 'overview', false);
    } catch (error) {
        console.error(error);
        element('dashboard-loading').textContent = 'The MMA analytics data could not be loaded.';
    }
}

initializeDashboard();
