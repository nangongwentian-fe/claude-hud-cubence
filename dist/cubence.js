import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';
import { getClaudeConfigDir, getHudPluginDir } from './claude-config-dir.js';
const CACHE_FILE = '.cubence-balance-cache.json';
const CACHE_TTL_MS = 180_000; // 180 seconds
const REQUEST_TIMEOUT_MS = 3_000;
const SUBSCRIPTION_PATH = '/v1/user/subscription-info';
function unitsToDollars(units) {
    return units / 1_000_000;
}
function getCachePath() {
    const homeDir = os.homedir();
    return path.join(getHudPluginDir(homeDir), CACHE_FILE);
}
function loadCache() {
    try {
        const cachePath = getCachePath();
        if (!fs.existsSync(cachePath))
            return null;
        const content = fs.readFileSync(cachePath, 'utf-8');
        const cache = JSON.parse(content);
        if (!cache?.data || typeof cache.cachedAt !== 'number')
            return null;
        return cache;
    }
    catch {
        return null;
    }
}
function saveCache(data) {
    try {
        const cachePath = getCachePath();
        const dir = path.dirname(cachePath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        const cache = { data, cachedAt: Date.now() };
        fs.writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
    }
    catch {
        // Silent failure
    }
}
function isCacheValid(cache) {
    return Date.now() - cache.cachedAt < CACHE_TTL_MS;
}
function readClaudeSettings() {
    try {
        const homeDir = os.homedir();
        const settingsPath = path.join(getClaudeConfigDir(homeDir), 'settings.json');
        if (!fs.existsSync(settingsPath))
            return { token: null, baseUrl: null };
        const content = fs.readFileSync(settingsPath, 'utf-8');
        const settings = JSON.parse(content);
        const env = settings?.env;
        return {
            token: env?.ANTHROPIC_AUTH_TOKEN ?? null,
            baseUrl: env?.ANTHROPIC_BASE_URL ?? null,
        };
    }
    catch {
        return { token: null, baseUrl: null };
    }
}
function fetchSubscriptionInfo(baseUrl, token) {
    return new Promise((resolve) => {
        try {
            const url = new URL(`${baseUrl.replace(/\/+$/, '')}${SUBSCRIPTION_PATH}`);
            const isHttps = url.protocol === 'https:';
            const mod = isHttps ? https : http;
            const startTime = Date.now();
            const req = mod.request({
                hostname: url.hostname,
                port: url.port || (isHttps ? 443 : 80),
                path: url.pathname + url.search,
                method: 'GET',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
                timeout: REQUEST_TIMEOUT_MS,
            }, (res) => {
                if (res.statusCode !== 200) {
                    res.resume();
                    resolve(null);
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    try {
                        const latencyMs = Date.now() - startTime;
                        const body = Buffer.concat(chunks).toString('utf-8');
                        resolve({ resp: JSON.parse(body), latencyMs });
                    }
                    catch {
                        resolve(null);
                    }
                });
                res.on('error', () => resolve(null));
            });
            req.on('timeout', () => {
                req.destroy();
                resolve(null);
            });
            req.on('error', () => resolve(null));
            req.end();
        }
        catch {
            resolve(null);
        }
    });
}
function parseApiResponse(resp, latencyMs) {
    const balance = resp.normal_balance?.amount_dollar ?? 0;
    const fiveHour = resp.subscription_window?.five_hour;
    const weekly = resp.subscription_window?.weekly;
    const fiveHourLimit = fiveHour?.limit ?? 0;
    const weeklyLimit = weekly?.limit ?? 0;
    const hasSubscription = fiveHourLimit > 0 || weeklyLimit > 0;
    return {
        balanceDollar: balance,
        hasSubscription,
        fiveHourUsedDollar: unitsToDollars(fiveHour?.used ?? 0),
        fiveHourLimitDollar: unitsToDollars(fiveHourLimit),
        weeklyUsedDollar: unitsToDollars(weekly?.used ?? 0),
        weeklyLimitDollar: unitsToDollars(weeklyLimit),
        latencyMs,
    };
}
export async function getCubenceBalance() {
    // Check cache first
    const cache = loadCache();
    if (cache && isCacheValid(cache)) {
        return cache.data;
    }
    // Read credentials
    const { token, baseUrl } = readClaudeSettings();
    if (!token || !baseUrl) {
        return cache?.data ?? null; // Return stale cache if available
    }
    // Fetch from API
    const result = await fetchSubscriptionInfo(baseUrl, token);
    if (!result) {
        return cache?.data ?? null; // Fallback to stale cache
    }
    const data = parseApiResponse(result.resp, result.latencyMs);
    saveCache(data);
    return data;
}
//# sourceMappingURL=cubence.js.map