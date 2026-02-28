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

let currentSource = 'all';
let allNews = [];

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

    newsContainer.innerHTML = filtered.map(item => `
        <article class="news-card" onclick="window.open('${escapeHTML(item.link)}', '_blank')">
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
        defenseStatus.innerText = "NOMINAL";
        defenseStatus.className = "value nominal";
        return;
    }

    defenseStatus.innerText = "ACTIVE ALERTS";
    defenseStatus.className = "value alert pulse-text";

    // Add alert to container if it's new
    const newAlertsHtml = alertData.data.map(city => `
        <div class="alert-item">
            <div class="city">${escapeHTML(city)}</div>
            <div class="desc">${escapeHTML(alertData.title || 'Missile Attack')}</div>
            <div class="time">${escapeHTML(new Date().toLocaleTimeString())}</div>
        </div>
    `).join('');

    alertsContainer.innerHTML = newAlertsHtml + (alertsContainer.querySelector('.placeholder-text') ? '' : alertsContainer.innerHTML);

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
    'Tehran': { x: 70, y: 35, country: 'Iran' },
    'Isfahan': { x: 65, y: 55, country: 'Iran' },
    'Tel Aviv': { x: 22, y: 55, country: 'Israel' },
    'Jerusalem': { x: 23, y: 56, country: 'Israel' },
    'Haifa': { x: 22, y: 53, country: 'Israel' },
    'Beirut': { x: 23, y: 50, country: 'Lebanon' },
    'Damascus': { x: 26, y: 51, country: 'Syria' },
    'Baghdad': { x: 45, y: 50, country: 'Iraq' }
};

function initMap() {
    const container = document.getElementById('strike-map-container');
    if (!container) return;

    // Detailed minimalist regional map
    // x: 0 (West Mediterranean) to 100 (East Iran)
    // y: 0 (Black Sea / Caucasus) to 100 (Persian Gulf)
    container.innerHTML = `
        <svg class="map-svg" viewBox="0 0 100 100">
            <!-- Israel/Palestine/Jordan Landmass -->
            <path class="map-land" d="M20,40 Q22,50 21,70 L25,72 Q27,60 25,42 Z" />
            <!-- Lebanon/Syria Landmass -->
            <path class="map-land" d="M22,40 Q25,35 30,38 L35,45 Q30,55 25,48 Z" />
            <!-- Iraq Landmass -->
            <path class="map-land" d="M30,45 Q40,40 55,45 L50,65 Q40,70 30,65 Z" />
            <!-- Iran Landmass -->
            <path class="map-land" d="M55,45 Q70,30 90,32 L95,60 Q80,85 55,75 Z" />
            
            <!-- Country Labels -->
            <text x="21" y="65" class="map-country-label" transform="rotate(-90, 21, 65)">Israel/Palestine</text>
            <text x="26" y="38" class="map-country-label" transform="rotate(20, 26, 38)">Syria</text>
            <text x="40" y="58" class="map-country-label">Iraq</text>
            <text x="75" y="55" class="map-country-label">Iran</text>

            <g id="map-cities">
                ${Object.entries(CITY_COORDS).map(([name, pos]) => `
                    <circle cx="${pos.x}" cy="${pos.y}" r="0.6" class="map-city-dot" />
                    <text x="${pos.x + 1.5}" y="${pos.y + 1}" class="map-city-label">${name}</text>
                `).join('')}
            </g>

            <g id="map-active-strikes"></g>
        </svg>
    `;
}

function triggerMapPulse(city) {
    const group = document.getElementById('map-active-strikes');
    if (!group) return;

    const coords = CITY_COORDS[city] || { x: Math.random() * 80 + 10, y: Math.random() * 70 + 10 };

    const id = 'pulse-' + Date.now();
    const pulseHtml = `
        <circle class="strike-point" cx="${coords.x}" cy="${coords.y}" r="1" />
        <circle class="strike-pulse" cx="${coords.x}" cy="${coords.y}" r="1">
            <animate attributeName="r" from="1" to="10" dur="2s" repeatCount="1" />
            <animate attributeName="opacity" from="1" to="0" dur="2s" repeatCount="1" />
        </circle>
    `;

    const div = document.createElement('g');
    div.innerHTML = pulseHtml;
    group.appendChild(div);

    setTimeout(() => div.remove(), 2500);
}

/**
 * Tab Navigation
 */
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;

            // UI Update
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById('tab-' + tabId).classList.add('active');
        });
    });
}

// Intercept alert UI to trigger map pulse
const originalUpdateUI = updateAlertUI;
updateAlertUI = function (data) {
    originalUpdateUI(data);
    if (data && data.data) {
        data.data.forEach(city => triggerMapPulse(city));
    }
};

// Start the app
init();
