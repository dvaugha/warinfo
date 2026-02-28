const NEWS_SOURCES = {
    fox: "http://feeds.foxnews.com/foxnews/world",
    cnn: "http://rss.cnn.com/rss/edition_world.rss",
    cbs: "https://www.cbsnews.com/world/rss",
    abc: "https://abcnews.go.com/abcnews/internationalheadlines",
    jpost: "https://rss.jpost.com/rss/rssfeedsiran.aspx",
    aljazeera: "https://www.aljazeera.com/xml/rss/all.xml"
};

const ALERT_URL = "https://www.oref.org.il/WarningMessages/alert/alerts.json";
const CORS_PROXY = "https://api.allorigins.win/raw?url=";

let currentSource = 'all';
let allNews = [];

// DOM Elements
const newsContainer = document.getElementById('news-container');
const alertsContainer = document.getElementById('alerts-container');
const defenseStatus = document.getElementById('defense-status');
const currentTimeDisplay = document.getElementById('current-time');
const filterBtns = document.querySelectorAll('.filter-btn');

/**
 * Initialize Dashboard
 */
async function init() {
    startClock();
    await fetchAllNews();
    startAlertPolling();
    setupFilters();
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
 * Fetch news from RSS sources via rss2json
 */
async function fetchAllNews() {
    setNewsLoading(true);
    allNews = [];

    const fetchPromises = Object.entries(NEWS_SOURCES).map(async ([key, url]) => {
        try {
            const response = await fetch(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(url)}`);
            const data = await response.json();
            if (data.status === 'ok') {
                return data.items.map(item => ({
                    ...item,
                    sourceKey: key,
                    sourceName: key.toUpperCase(),
                    timestamp: new Date(item.pubDate).getTime()
                }));
            }
        } catch (error) {
            console.error(`Error fetching ${key}:`, error);
        }
        return [];
    });

    const results = await Promise.all(fetchPromises);
    allNews = results.flat().sort((a, b) => b.timestamp - a.timestamp);

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
        <article class="news-card" onclick="window.open('${item.link}', '_blank')">
            <span class="source">${item.sourceName}</span>
            <h3>${item.title}</h3>
            <div class="meta">
                <span>${new Date(item.timestamp).toLocaleString()}</span>
            </div>
        </article>
    `).join('');
}

/**
 * Start Alerts Polling
 */
function startAlertPolling() {
    // Poll every 5 seconds for new alerts
    fetchAlerts();
    setInterval(fetchAlerts, 5000);
}

/**
 * Fetch real-time alerts from Pikud Haoref
 */
async function fetchAlerts() {
    try {
        // Note: oref.org.il might block non-Israeli IPs. 
        // Using allorigins as a proxy to bypass simple CORS and IP blocks.
        const response = await fetch(`${CORS_PROXY}${encodeURIComponent(ALERT_URL)}`);

        // The API returns 204 No Content if there are no active alerts
        if (response.status === 204) {
            updateAlertUI(null);
            return;
        }

        const data = await response.json();
        // data looks like: { id: "...", title: "...", data: ["city1", "city2"], desc: "..." }
        updateAlertUI(data);
    } catch (error) {
        console.warn("Could not fetch real-time alerts (likely regional block):", error);
        // If block occurs, we'll keep the dashboard running but show a status warning
    }
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
            <div class="city">${city}</div>
            <div class="desc">${alertData.title || 'Missile Attack'}</div>
            <div class="time">${new Date().toLocaleTimeString()}</div>
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

// Start the app
init();
