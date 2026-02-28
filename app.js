const NEWS_SOURCES = {
    fox: "https://moxie.foxnews.com/google-publisher/world.xml",
    cnn: "https://news.google.com/rss/search?q=site:cnn.com+iran+israel+strike",
    abc: "https://abcnews.go.com/abcnews/internationalheadlines",
    jpost: "https://www.jpost.com/rss/rssfeedsfrontpage.aspx",
    toi: "https://www.timesofisrael.com/feed/",
    aljazeera: "https://www.aljazeera.com/xml/rss/all.xml",
    cbs: "https://www.cbsnews.com/latest/rss/world"
};

const ALERT_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json";
const CORS_PROXY = "https://api.allorigins.win/raw?url=";
const RED_ALERT_SOCKET = "https://redalert.orielhaim.com";

const ASSET_DATA = [
    { id: 'csg-72', name: 'USS Abraham Lincoln (CVN-72)', type: 'navy', x: 92, y: 90, status: 'OPERATIONAL', mission: 'STRIKE / DETERRENCE' },
    { id: 'sub-georgia', name: 'USS Georgia (SSGN-729)', type: 'navy', x: 12, y: 58, status: 'SUBMERGED', mission: 'GUIDED MISSILE SUPPORT' },
    { id: 'b52-strat', name: 'B-52H Stratofortress Wing', type: 'air', x: 62, y: 88, status: 'READY', mission: 'LONG-RANGE DETERRANCE' },
    { id: 'f35-squad', name: 'F-35I Adir Squadron', type: 'air', x: 21, y: 52, status: 'ACTIVE PATROL', mission: 'COMBAT AIR PATROL' },
    { id: 'thaad-1', name: 'THAAD Battery Alpha', type: 'defense', x: 24, y: 57, status: 'ENGAGED', mission: 'BALLISTIC MISSILE DEFENSE' },
    { id: 'arrow-3', name: 'Arrow-3 Strategic Def.', type: 'defense', x: 23, y: 55, status: 'OPERATIONAL', mission: 'EXO-ATMOSPHERIC DEFENSE' },
    { id: 'isr-isra', name: 'RQ-4 Global Hawk', type: 'air', x: 68, y: 45, status: 'ELINT ACTIVE', mission: 'SURVEILLANCE' }
];

let showAssets = false;

// Blocklist for keywords commonly found in RSS ads/promos
const AD_KEYWORDS = [
    "sponsored", "advertisement", "promotion", "subscribe", "shop",
    "offer", "deal", "limited time", "gift card", "save now",
    "partner content", "special report: sponsored", "buy now"
];

const WAR_KEYWORDS = [
    "iran", "israel", "strike", "missile", "attack", "war", "tehran", "tel aviv",
    "defense", "idf", "irgc", "explosion", "conflict", "military", "strike",
    "drone", "airspace", "siren", "hezbollah", "houthi", "gaza", "lebanon",
    "retaliation", "operation", "threat", "ballistic", "uav", "netanyahu",
    "khamenei", "nuclear", "airstrike", "bombardment", "intercept"
];

const STRONG_WAR_KEYWORDS = ["iran", "israel", "tehran", "irgc", "missile", "idf", "airstrike"];
const STRIKE_KEYWORDS = ["explosion", "strike", "airstrike", "bombardment", "blast", "impacted", "intercepted", "hit", "targeted"];

let currentSource = 'all';
let allNews = [];
let persistentStrikes = []; // Confirmed strikes from news (persistent for 6h)

// DOM Elements
const newsContainer = document.getElementById('news-container');
const alertsContainer = document.getElementById('alerts-container');
const defenseStatus = document.getElementById('defense-status');
const currentTimeDisplay = document.getElementById('current-time');
const filterBtns = document.querySelectorAll('.filter-btn');

/**
 * Security: Sanitize all untrusted string inputs
 */
function escapeHTML(str) {
    if (!str) return "";
    return str.toString()
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

/**
 * Initialize Dashboard
 */
async function init() {
    startClock();
    await fetchAllNews();
    startAlertPolling();
    setupFilters();
    setupTabs();
    initMap();
    setupFullscreenMap();
    setupArticleOverlay();
    setupAssetControls();
}

/**
 * System Clock
 */
function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

function updateClock() {
    const now = new Date();
    currentTimeDisplay.innerText = now.toTimeString().split(' ')[0] + " UTC";
}

/**
 * Fetch news from RSS sources using a proxy and manual XML parsing
 */
async function fetchAllNews() {
    setNewsLoading(true);
    allNews = [];

    const fetchPromises = Object.entries(NEWS_SOURCES).map(async ([key, url]) => {
        try {
            // Using corsproxy.io as primary for better XML support
            const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(url)}`;
            let response = await fetch(proxyUrl);
            let responseText = "";

            if (response.ok) {
                responseText = await response.text();
            } else {
                // Secondary fallback to allorigins
                const altProxy = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
                const altResponse = await fetch(altProxy);
                const altData = await altResponse.json();
                responseText = altData.contents;
            }

            if (responseText) {
                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(responseText, "text/xml");
                const items = xmlDoc.querySelectorAll("item");

                return Array.from(items).map(item => {
                    const title = item.querySelector("title")?.textContent || "No Title";
                    const link = item.querySelector("link")?.textContent || "#";
                    const pubDate = item.querySelector("pubDate")?.textContent || new Date().toISOString();
                    const description = item.querySelector("description")?.textContent || "";

                    const newItem = {
                        title,
                        link,
                        sourceKey: key,
                        sourceName: key.toUpperCase(),
                        timestamp: new Date(pubDate).getTime(),
                        description: description.replace(/<[^>]*>?/gm, '').substring(0, 150) + "..."
                    };

                    if (isAdvertisement(newItem)) return null;
                    if (!isWarRelated(newItem)) return null;
                    if (isNaN(newItem.timestamp)) return null;
                    if (newItem.title.length < 5) return null;

                    return newItem;
                }).filter(item => item !== null);
            } else {
                console.warn(`Source ${key} returned empty contents or was blocked.`);
            }
        } catch (error) {
            console.error(`Error fetching ${key}:`, error);
        }
        return [];
    });

    const results = await Promise.all(fetchPromises);
    allNews = results.flat().sort((a, b) => b.timestamp - a.timestamp);

    calculateEscalationIndex();
    updateNarrativeSync();
    processStrikeDetection();

    setNewsLoading(false);
    renderNews();
}

/**
 * Render News Cards
 */
function renderNews() {
    const filtered = currentSource === 'all'
        ? allNews
        : allNews.filter(n => n.sourceKey === currentSource);

    if (filtered.length === 0) {
        newsContainer.innerHTML = '<div class="placeholder-text">No news articles found for this source.</div>';
        return;
    }

    newsContainer.innerHTML = filtered.map((item, index) => `
        <article class="news-card" data-index="${index}">
            <span class="source">${escapeHTML(item.sourceName)}</span>
            <h3>${escapeHTML(item.title)}</h3>
            <p class="description">${escapeHTML(item.description)}</p>
            <div class="meta">
                <span>${escapeHTML(new Date(item.timestamp).toLocaleString())}</span>
            </div>
        </article>
    `).join('');
}

/**
 * Start Alerts Polling (Now using Real-Time WebSockets + Global Proxy)
 */
function startAlertPolling() {
    // 1. Initial history fetch via proxy
    fetchAlertHistory();

    // 2. Real-time listener via RedAlert (Socket.io)
    // This script must be included in index.html: <script src="https://cdn.socket.io/4.7.2/socket.io.min.js"></script>
    if (typeof io !== 'undefined') {
        const socket = io(RED_ALERT_SOCKET, {
            transports: ['websocket'],
            reconnection: true
        });

        socket.on('connect', () => {
            console.log('Connected to RedAlert Real-Time Feed');
        });

        socket.on('alert', (data) => {
            console.log('Real-time alert received:', data);
            // RedAlert data format: { title: "...", data: ["city1", "city2"], category: 1 }
            updateAlertUI(data);
        });
    }

    // 3. Fallback polling (every 10s) via secondary proxy for non-Israel users
    setInterval(fetchAlertHistory, 10000);
}

/**
 * Fetch alert history via proxy
 */
async function fetchAlertHistory() {
    try {
        // Using allorigins to fetch historical alerts
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(ALERT_URL)}`);
        const data = await response.json();

        if (data && data.contents) {
            const alerts = JSON.parse(data.contents);
            if (alerts && alerts.data && alerts.data.length > 0) {
                updateAlertUI(alerts);
            }
        }
    } catch (error) {
        console.warn("History fetch failed:", error);
    }
}

/**
 * Fetch real-time alerts from Pikud Haoref (Legacy - kept for reference)
 */
async function fetchAlerts() {
    // This is now handled by fetchAlertHistory and the Socket.io listener
}

/**
 * Update the UI with alert data
 */
function updateAlertUI(alertData) {
    if (!alertData || !alertData.data || alertData.data.length === 0) {
        // If it's the initial call and still nominal, show status but clear syncing
        if (alertsContainer.querySelector('.placeholder-text')) {
            alertsContainer.innerHTML = '<div class="nominal-status">No active threats detected in the region.</div>';
        }
        defenseStatus.innerText = "NOMINAL";
        defenseStatus.className = "value nominal";
        return;
    }

    defenseStatus.innerText = "ACTIVE ALERTS";
    defenseStatus.className = "value alert pulse-text";

    // Clear placeholder on first alert
    const placeholder = alertsContainer.querySelector('.placeholder-text');
    if (placeholder) placeholder.remove();

    // Add alert to container if it's new
    const newAlertsHtml = alertData.data.map(city => `
        <div class="alert-item ${alertData.isIntel ? 'intel-alert' : ''}">
            <div class="city">${escapeHTML(city)}</div>
            <div class="desc">${escapeHTML(alertData.title || 'Missile Attack')}</div>
            <div class="time">${escapeHTML(new Date(alertData.timestamp || Date.now()).toLocaleTimeString())}</div>
        </div>
    `).join('');

    alertsContainer.innerHTML = newAlertsHtml + alertsContainer.innerHTML;

    // Limit to last 20 alerts
    const alerts = alertsContainer.querySelectorAll('.alert-item');
    if (alerts.length > 20) {
        for (let i = 20; i < alerts.length; i++) {
            alerts[i].remove();
        }
    }
}

/**
 * Filter Setup
 */
function setupFilters() {
    filterBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            filterBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentSource = btn.dataset.source;
            renderNews();
        });
    });
}

function setNewsLoading(isLoading) {
    if (isLoading) {
        newsContainer.innerHTML = '<div class="skeleton-card"></div>'.repeat(6);
    }
}

/**
 * Filter out ads based on keywords in title or description
 */
function isAdvertisement(item) {
    const content = (item.title + " " + item.description).toLowerCase();
    // Check for common ad keywords
    if (AD_KEYWORDS.some(keyword => content.includes(keyword))) {
        return true;
    }
    // Check for extremely short content which often precedes ads
    if (item.description.length < 20 && !item.title.toLowerCase().includes("breaking")) {
        return true;
    }
    // Filter out items that are just links to shop or subscribe
    if (item.link.includes("/shop/") || item.link.includes("/subscribe")) {
        return true;
    }
    return false;
}

/**
 * Check if the item is related to the Iran strikes or war
 */
function isWarRelated(item) {
    const content = (item.title + " " + item.description).toLowerCase();

    // Check for "strikes" or "war" in combination with "Iran" or "Israel"
    const hasLocation = ["iran", "israel", "tehran", "tel aviv", "idf", "irgc", "middle east"].some(k => content.includes(k));
    const hasConflict = ["strike", "missile", "attack", "war", "military", "explosion", "drone", "defense", "operation"].some(k => content.includes(k));

    // Check for strong war keywords alone
    const hasStrongMatches = STRONG_WAR_KEYWORDS.some(keyword => content.includes(keyword));

    // It's war related if it has BOTH location and conflict OR a strong match
    // Or if it's from JPost/TOI/AlJazeera which are inherently regional
    if (["JPOST", "TOI", "ALJAZEERA"].includes(item.sourceName)) {
        return (hasLocation && hasConflict) || hasStrongMatches || content.includes("strike") || content.includes("missile");
    }

    return (hasLocation && hasConflict) || hasStrongMatches;
}

/**
 * Escalation Index Logic
 */
function calculateEscalationIndex() {
    const recentNews = allNews.slice(0, 30);
    let totalScore = 0;

    const weights = {
        'iran': 2, 'israel': 2, 'idf': 2, 'irgc': 2,
        'strike': 4, 'missile': 5, 'attack': 4, 'war': 6,
        'nuclear': 10, 'ballistic': 8, 'casualty': 7, 'explosion': 4
    };

    recentNews.forEach(item => {
        const content = (item.title + " " + item.description).toLowerCase();
        Object.entries(weights).forEach(([word, weight]) => {
            if (content.includes(word)) totalScore += weight;
        });
    });

    // Normalize to 0-100 range (rough estimation)
    const normalizedScore = Math.min(Math.round((totalScore / 150) * 100), 100);

    const gauge = document.getElementById('escalation-gauge');
    const valueDisp = document.getElementById('escalation-value');

    if (gauge && valueDisp) {
        gauge.style.width = normalizedScore + '%';
        valueDisp.innerText = normalizedScore + '%';

        // Color based on severity
        if (normalizedScore > 75) {
            valueDisp.style.color = '#ff3b3b';
        } else if (normalizedScore > 40) {
            valueDisp.style.color = '#ff9500';
        } else {
            valueDisp.style.color = '#34c759';
        }
    }
}

/**
 * Narrative Sync Logic (Grouping)
 */
function updateNarrativeSync() {
    const syncContainer = document.getElementById('narrative-sync-container');
    if (!syncContainer) return;

    // Simplified grouping: Find common key names in titles
    const topics = [
        { name: 'Tehran Strikes', keys: ['tehran', 'strike', 'explosion'] },
        { name: 'Northern Border', keys: ['lebanon', 'hezbollah', 'north'] },
        { name: 'Missile Defense', keys: ['interception', 'arrow', 'sling', 'missile'] }
    ];

    const stagedGroups = topics.map(topic => {
        const related = allNews.filter(n =>
            topic.keys.some(k => (n.title + n.description).toLowerCase().includes(k))
        ).slice(0, 3); // Take top 3 different perspectives

        if (related.length < 2) return null; // Only show if multiple sources cover it

        return `
            <div class="sync-topic-card">
                <div class="sync-header"><h3>Topic: ${escapeHTML(topic.name)}</h3></div>
                <div class="sync-perspectives">
                    ${related.map(r => `
                        <div class="perspective">
                            <span class="source-label">${escapeHTML(r.sourceName)}</span>
                            <h4>${escapeHTML(r.title)}</h4>
                            <p>${escapeHTML(r.description)}</p>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).filter(Boolean);

    syncContainer.innerHTML = stagedGroups.length > 0
        ? stagedGroups.join('')
        : '<div class="placeholder-text">Insufficient overlapping data for cross-source comparison.</div>';
}

/**
 * Strike Map Logic (Geospatial Visualization)
 */
const CITY_COORDS = {
    'Tehran': { x: 78, y: 35, country: 'Iran' },
    'Isfahan': { x: 74, y: 52, country: 'Iran' },
    'Tel Aviv': { x: 18, y: 55, country: 'Israel' },
    'Jerusalem': { x: 19, y: 56, country: 'Israel' },
    'Haifa': { x: 18, y: 53, country: 'Israel' },
    'Beirut': { x: 19, y: 49, country: 'Lebanon' },
    'Damascus': { x: 23, y: 50, country: 'Syria' },
    'Baghdad': { x: 48, y: 48, country: 'Iraq' },
    'Amman': { x: 22, y: 58, country: 'Jordan' },
    'Riyadh': { x: 55, y: 75, country: 'Saudi Arabia' },
    'Cairo': { x: 5, y: 65, country: 'Egypt' }
};

function initMap() {
    const containers = [
        document.getElementById('strike-map-container'),
        document.getElementById('fullscreen-map-container')
    ];

    const mapHtml = `
        <svg class="map-svg" viewBox="0 0 100 100">
            <!-- Background Water -->
            <rect x="0" y="0" width="100" height="100" fill="#080a0f" />
            
            <!-- Mediterranean Sea -->
            <path d="M0,45 Q10,48 15,55 L0,65 Z" fill="#0c121d" />
            <!-- Red Sea -->
            <path d="M12,75 Q15,85 10,100 L20,100 Q25,85 22,75 Z" fill="#0c121d" />
            <!-- Persian Gulf -->
            <path d="M65,75 Q75,85 90,80 L100,85 L100,70 Q85,65 65,75 Z" fill="#0c121d" />

            <g class="map-countries">
                <!-- Egypt / Sinai -->
                <path class="map-land" d="M0,60 L10,62 L15,75 L0,100 Z" />
                <!-- Israel / Palestine -->
                <path class="map-land" d="M16,52 L19,52 L20,62 L15,62 Z" />
                <!-- Jordan -->
                <path class="map-land" d="M20,58 L28,58 L30,70 L22,72 Z" />
                <!-- Lebanon -->
                <path class="map-land" d="M18,48 L21,48 L21,52 L18,52 Z" />
                <!-- Syria -->
                <path class="map-land" d="M21,42 L35,42 L38,55 L22,55 Z" />
                <!-- Iraq -->
                <path class="map-land" d="M38,45 L58,42 L62,65 L36,68 Z" />
                <!-- Saudi Arabia -->
                <path class="map-land" d="M30,70 L60,70 L70,100 L20,100 Z" />
                <!-- Iran -->
                <path class="map-land" d="M60,30 L95,30 L100,70 L65,75 Z" />
                <!-- Turkey (Partial) -->
                <path class="map-land" d="M20,20 L80,20 L75,30 L25,35 Z" />
            </g>
            
            <!-- Country Labels -->
            <text x="12" y="58" class="map-country-label" transform="rotate(-90, 12, 58)">Israel</text>
            <text x="5" y="85" class="map-country-label">Egypt</text>
            <text x="21" y="65" class="map-country-label" transform="rotate(15,21,65)">Jordan</text>
            <text x="28" y="48" class="map-country-label">Syria</text>
            <text x="45" y="55" class="map-country-label">Iraq</text>
            <text x="80" y="50" class="map-country-label">Iran</text>
            <text x="45" y="90" class="map-country-label">Saudi Arabia</text>
            <text x="18" y="49" class="map-country-label" font-size="3">Lib.</text>

            <g class="map-cities">
                ${Object.entries(CITY_COORDS).map(([name, pos]) => `
                    <circle cx="${pos.x}" cy="${pos.y}" r="0.6" class="map-city-dot" />
                    <text x="${pos.x + 1.5}" y="${pos.y + 1}" class="map-city-label">${escapeHTML(name)}</text>
                `).join('')}
            </g>

            <g class="map-persistent-strikes"></g>
            <g class="map-assets-layer"></g>
            <g class="map-active-strikes-layer"></g>
        </svg>
    `;

    containers.forEach(container => {
        if (container) {
            container.innerHTML = mapHtml;
        }
    });

    // Once HTML is in place, render layers
    renderPersistentStrikes();
    renderAssets();
}

/**
 * Strike Detection & Persistent Markers
 */
function processStrikeDetection() {
    const recentNews = allNews.slice(0, 50); // Scan top 50 recent war reports
    const now = Date.now();
    const sixHours = 6 * 60 * 60 * 1000;

    recentNews.forEach(item => {
        const content = (item.title + " " + item.description).toLowerCase();

        // 1. Is there a strike keyword?
        const hasStrikeWord = STRIKE_KEYWORDS.some(k => content.includes(k));
        if (hasStrikeWord) {
            // 2. Is there a city name in the content?
            const cityMatch = Object.keys(CITY_COORDS).find(city => content.includes(city.toLowerCase()));

            if (cityMatch) {
                // Ensure we don't duplicate strikes for the same event (same city within same hour)
                const isDuplicate = persistentStrikes.some(s =>
                    s.city === cityMatch && Math.abs(s.timestamp - item.timestamp) < (60 * 60 * 1000)
                );

                if (!isDuplicate) {
                    const newStrike = {
                        city: cityMatch,
                        title: item.title,
                        source: item.sourceName,
                        timestamp: item.timestamp,
                        id: `strike-${item.timestamp}`
                    };
                    persistentStrikes.push(newStrike);

                    // Inject confirmed strike into the Alerts Feed as "Intel Alert"
                    updateAlertUI({
                        title: "CONFIRMED STRIKE / EXPLOSION",
                        data: [cityMatch],
                        timestamp: item.timestamp,
                        isIntel: true
                    });
                }
            }
        }
    });

    // Cleanup and Refresh
    persistentStrikes = persistentStrikes.filter(s => (now - s.timestamp) < sixHours);
    renderPersistentStrikes();
}

function renderPersistentStrikes() {
    const layers = document.querySelectorAll('.map-persistent-strikes');
    if (!layers.length) return;

    const strikesHtml = persistentStrikes.map(strike => {
        const pos = CITY_COORDS[strike.city];
        if (!pos) return '';

        return `
            <g class="map-strike-persistent" 
               data-title="${escapeHTML(strike.title)}" 
               data-source="${escapeHTML(strike.source)}">
                <circle class="strike-glow" cx="${pos.x}" cy="${pos.y}" r="3" />
                <circle class="strike-marker" cx="${pos.x}" cy="${pos.y}" r="1.2" />
            </g>
        `;
    }).join('');

    layers.forEach(layer => {
        layer.innerHTML = strikesHtml;
    });

    setupMapTooltips();
}

/**
 * Map Tooltip Interaction Logic
 */
function setupMapTooltips() {
    const tooltip = document.getElementById('map-tooltip');
    const markers = document.querySelectorAll('.map-strike-persistent');

    markers.forEach(marker => {
        marker.onmouseenter = (e) => {
            const title = marker.getAttribute('data-title');
            const source = marker.getAttribute('data-source');

            tooltip.innerHTML = `
                <span class="tooltip-source">${source}</span>
                <div class="tooltip-title">${title}</div>
            `;
            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
        };

        marker.onmousemove = (e) => {
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY + 15) + 'px';
        };

        marker.onmouseleave = () => {
            tooltip.style.display = 'none';
            tooltip.style.opacity = '0';
        };
    });
}

function triggerMapPulse(city) {
    const strikeLayers = document.querySelectorAll('.map-active-strikes-layer');
    if (strikeLayers.length === 0) return;

    const coords = CITY_COORDS[city] || { x: Math.random() * 80 + 10, y: Math.random() * 70 + 10 };

    const pulseHtml = `
        <circle class="strike-point" cx="${coords.x}" cy="${coords.y}" r="1.5" />
        <circle class="strike-pulse" cx="${coords.x}" cy="${coords.y}" r="1.5">
            <animate attributeName="r" from="1.5" to="15" dur="2s" repeatCount="1" />
            <animate attributeName="opacity" from="1" to="0" dur="2s" repeatCount="1" />
        </circle>
    `;

    strikeLayers.forEach(layer => {
        // Use proper SVG namespace for dynamic elements
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.innerHTML = pulseHtml;
        layer.appendChild(g);
        setTimeout(() => g.remove(), 2500);
    });
}

/**
 * Tab Navigation
 */
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
        });
    });
}

/**
 * Fullscreen Map Controls
 */
function setupFullscreenMap() {
    const expandBtn = document.getElementById('expand-map-btn');
    const closeBtn = document.getElementById('close-map-btn');
    const overlay = document.getElementById('fullscreen-map-overlay');

    if (expandBtn && overlay) {
        expandBtn.addEventListener('click', () => {
            overlay.classList.add('active');
            document.body.style.overflow = 'hidden';
        });
    }

    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => {
            overlay.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    }
}

// Intercept alert UI to trigger map pulse
const originalUpdateUI = updateAlertUI;
updateAlertUI = function (data) {
    if (originalUpdateUI) originalUpdateUI(data);
    if (data && data.data) {
        data.data.forEach(city => triggerMapPulse(city));
    }
};

// Start the app
init();

/**
 * Article Summary Overlay Controls
 */
function setupArticleOverlay() {
    const closeBtn = document.getElementById('close-article-btn');
    const overlay = document.getElementById('article-summary-overlay');

    if (closeBtn && overlay) {
        closeBtn.addEventListener('click', () => {
            overlay.classList.remove('active');
            document.body.style.overflow = 'auto';
        });
    }

    // Event Delegation for News Cards (CSP Compliant)
    if (newsContainer) {
        newsContainer.addEventListener('click', (e) => {
            const card = e.target.closest('.news-card');
            if (card) {
                const index = parseInt(card.dataset.index);
                if (!isNaN(index)) {
                    openArticleSummary(index);
                }
            }
        });
    }
}

function openArticleSummary(index) {
    const filtered = currentSource === 'all'
        ? allNews
        : allNews.filter(n => n.sourceKey === currentSource);

    const article = filtered[index];
    if (!article) return;

    const overlay = document.getElementById('article-summary-overlay');
    const titleEl = document.getElementById('summary-title');
    const metaEl = document.getElementById('summary-meta');
    const bodyEl = document.getElementById('summary-body');
    const linkEl = document.getElementById('summary-link');

    if (overlay && titleEl && metaEl && bodyEl && linkEl) {
        titleEl.innerText = article.title;
        metaEl.innerText = `${article.sourceName} | ${new Date(article.timestamp).toLocaleString()}`;

        // Generate Cliff Notes (Bulleted Briefing) synthesized from title and description
        const cliffNotes = generateCliffNotes(article.title + ". " + article.description);

        bodyEl.innerHTML = `
            <div class="cliff-note-section">
                <div class="briefing-header">
                    <span class="pulse-icon small"></span>
                    KEY INTELLIGENCE BRIEFING [CLIFF NOTES]
                </div>
                ${cliffNotes.map(note => `<div class="cliff-note-item">${escapeHTML(note)}</div>`).join('')}
            </div>
            <div class="original-desc">${escapeHTML(article.description)}</div>
        `;

        linkEl.href = article.link;

        overlay.classList.add('active');
        document.body.style.overflow = 'hidden';
    }
}

/**
 * Tactical "Cliff Notes" Generator
 * Parses sentences and extracts key intel points
 */
function generateCliffNotes(text) {
    if (!text || text.length < 10) return ["Intel stream empty. Waiting for further reports..."];

    // 1. Initial split by sentence markers
    let points = text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(s => s.length > 10);

    // 2. If we have less than 3 points, try splitting long sentences at commas or conjunctions
    if (points.length < 3) {
        let expandedPoints = [];
        points.forEach(point => {
            if (point.length > 60 && expandedPoints.length < 5) {
                // Split long sentences at certain markers to create more bullet points
                const subs = point.split(/, and |, but |, as |; /i);
                expandedPoints.push(...subs);
            } else {
                expandedPoints.push(point);
            }
        });
        points = expandedPoints.map(p => p.trim()).filter(p => p.length > 10);
    }

    // 3. Cleanup: Remove trailing punctuation for a cleaner "note" look
    points = points.map(p => p.replace(/[.!?]$/, ''));

    // 4. Ensure we return between 3 and 5 points
    if (points.length > 5) return points.slice(0, 5);
    if (points.length < 3 && points.length > 0) {
        // Fallback for very short articles: just take what we have
        return points;
    }

    return points.length >= 3 ? points.slice(0, 5) : points;
}

/**
 * Tactical Asset Layer Logic
 */
function setupAssetControls() {
    const btn = document.getElementById('toggle-assets-btn');
    if (btn) {
        btn.onclick = () => {
            showAssets = !showAssets;
            btn.classList.toggle('active');
            btn.innerText = showAssets ? 'HIDE ASSETS' : 'SHOW ASSETS';
            renderAssets();
        };
    }
}

function renderAssets() {
    const layers = document.querySelectorAll('.map-assets-layer');
    if (!layers.length) return;

    if (!showAssets) {
        layers.forEach(l => l.innerHTML = '');
        return;
    }

    const assetsHtml = ASSET_DATA.map(asset => {
        let symbol = '◈'; // Defense
        let className = 'asset-defense';

        if (asset.type === 'navy') { symbol = '⬙'; className = 'asset-navy'; }
        if (asset.type === 'air') { symbol = '✈'; className = 'asset-air'; }

        return `
            <g class="asset-icon-group" data-id="${asset.id}" data-type="${asset.type}" 
               data-name="${escapeHTML(asset.name)}" data-status="${escapeHTML(asset.status)}"
               data-mission="${escapeHTML(asset.mission)}">
                
                ${asset.type === 'air' ? `<circle cx="${asset.x}" cy="${asset.y}" r="4" fill="none" stroke="rgba(52, 199, 89, 0.2)" stroke-dasharray="1,1" class="asset-orbit" />` : ''}

                <rect class="asset-main ${className}" x="${asset.x - 1.5}" y="${asset.y - 1.5}" width="3" height="3" rx="0.5" />
                <text x="${asset.x}" y="${asset.y + 0.8}" class="asset-label" text-anchor="middle">${symbol}</text>
            </g>
        `;
    }).join('');

    layers.forEach(layer => {
        layer.innerHTML = assetsHtml;
    });

    setupAssetTooltips();
}

function setupAssetTooltips() {
    const tooltip = document.getElementById('map-tooltip');
    const assetIcons = document.querySelectorAll('.asset-icon-group');

    assetIcons.forEach(icon => {
        icon.onmouseenter = (e) => {
            const name = icon.getAttribute('data-name');
            const status = icon.getAttribute('data-status');
            const mission = icon.getAttribute('data-mission');

            tooltip.innerHTML = `
                <span class="tooltip-source" style="color:var(--accent-green)">ASSET DEPLOYMENT [LIVE]</span>
                <div class="tooltip-title">${name}</div>
                <div style="font-size:0.7rem; margin-top:0.5rem; color: #34c759;">STATUS: ${status}</div>
                <div style="font-size:0.75rem; margin-top:0.2rem; color: #a1a1aa;">MISSION: ${mission}</div>
            `;
            tooltip.style.display = 'block';
            tooltip.style.opacity = '1';
        };

        icon.onmousemove = (e) => {
            tooltip.style.left = (e.clientX + 15) + 'px';
            tooltip.style.top = (e.clientY + 15) + 'px';
        };

        icon.onmouseleave = () => {
            tooltip.style.display = 'none';
        };
    });
}
