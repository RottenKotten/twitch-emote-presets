// ==UserScript==
// @name         Twitch Emote Presets
// @namespace    https://github.com/RottenKotten/
// @version      0.8.9
// @description  ...
// @match        https://dashboard.twitch.tv/*
// @updateURL    https://rottenkotten.github.io/twitch-emote-presets/rktep.meta.js
// @downloadURL  https://rottenkotten.github.io/twitch-emote-presets/rktep.user.js
// @run-at       document-start
// @sandbox      raw
// @grant        none
// ==/UserScript==

// =============================================================================
// Twitch persisted-query SHA-256 hashes.
// If Twitch changes an internal GQL document, this is the first place to update.
// Every value must be exactly 64 hexadecimal characters.
// =============================================================================
const TWITCH_GQL_HASHES = Object.freeze({
    CoreActionsCurrentUser: '6b5b63a013cf66a995d61f71a508ab5c8e4473350c5d4136f846ba65e8101e95',
    EmotesSettings: '23abe449fce786da5653071a0b5107fa0f79ff6729eeb22695f1bea91d0cd5fd',
    AssignEmoteToSubscriptionProduct: '67401d9c5ff0b14aa973f7457e09fda058b68d38042b3d9ea58d1099313e16f5',
    EmotesSettingsRemoveEmoteFromGroup: '2331017fd3263fda8f994c2953049fd9d566458c0d7793dc029f70873fe6e947',
    AssignEmoteToFollowerSlot: 'c882c575e57325f0b449e97dec414593c39d243ec6db05e341df4aa37bd3736c',
    AssignEmoteToBitsTier: '8f4daaba69b7e5fd0b8979c21eeef2d5a9f686ec4c74317148e20198bfa5225b',
    EmotesSettingsUpdateEmoteOrders: 'e6a1498745091b1db116b82a05d0d5e45da6b55bd30d88b8498bc969f40df843',
});

(() => {
    'use strict';

    const LOG = '[TEP]';
    const STORAGE_KEY = 'kttn.twitch-emote-presets.v3';
    const OLD_STORAGE_KEY = 'kttn.twitch-emote-presets.v2';
    const CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    const GQL_URL = 'https://gql.twitch.tv/gql#origin=twilight';
    const INTEGRITY_URL = 'https://gql.twitch.tv/integrity';
    const DEFAULT_DELAY_MS = 700;

    const twitchRuntime = {
        clientVersion: null,
        clientSessionId: readClientSessionId(),
    };

    // Capture native requests immediately; UI startup waits for the DOM below.
    installTwitchFetchHook();
    logTwitchRuntime();

    function readClientSessionId() {
        try {
            const raw = localStorage.getItem('local_storage_app_session_id');
            if (!raw) return null;
            let value = raw;
            try { value = JSON.parse(raw); } catch {}
            return typeof value === 'string' && value.trim() ? value : null;
        } catch {
            return null;
        }
    }

    function logTwitchRuntime() {
        console.log(LOG, 'Twitch runtime context', {
            hasClientVersion: Boolean(twitchRuntime.clientVersion),
            hasClientSessionId: Boolean(twitchRuntime.clientSessionId),
        });
    }

    function captureTwitchHeaders(headers) {
        if (!headers) return;
        let changed = false;
        const capture = (name, value) => {
            const field = name === 'client-version' ? 'clientVersion' : 'clientSessionId';
            if (typeof value === 'string' && value.trim() && twitchRuntime[field] !== value) {
                twitchRuntime[field] = value;
                changed = true;
            }
        };
        const isContextHeader = name => name === 'client-version' || name === 'client-session-id';

        // Read only the two context values, never credentials or integrity tokens.
        if (headers instanceof Headers) {
            for (const name of ['client-version', 'client-session-id']) capture(name, headers.get(name));
        } else if (Array.isArray(headers)) {
            for (const pair of headers) {
                const name = typeof pair?.[0] === 'string' ? pair[0].toLowerCase() : '';
                if (isContextHeader(name)) capture(name, pair[1]);
            }
        } else {
            for (const key of Object.keys(headers)) {
                const name = key.toLowerCase();
                if (isContextHeader(name)) capture(name, headers[key]);
            }
        }
        if (changed) logTwitchRuntime();
    }

    function installTwitchFetchHook() {
        const originalFetch = window.fetch;
        window.fetch = function () {
            try {
                const [input, init] = arguments;
                const url = new URL(input instanceof Request ? input.url : input, location.href);
                if (url.protocol === 'https:' && url.hostname === 'gql.twitch.tv' && url.pathname === '/gql') {
                    // Explicit init headers replace Request.headers, just as in fetch.
                    const headers = init?.headers;
                    captureTwitchHeaders(headers === undefined && input instanceof Request ? input.headers : headers);
                }
            } catch {
                // Inspection must never prevent or replace the original request.
            }
            return Reflect.apply(originalFetch, this, arguments);
        };
    }
    

    const OPS = {
        currentUser: { operationName: 'CoreActionsCurrentUser', sha256Hash: TWITCH_GQL_HASHES.CoreActionsCurrentUser },
        emotesSettings: { operationName: 'EmotesSettings', sha256Hash: TWITCH_GQL_HASHES.EmotesSettings },
        assignSubscription: { operationName: 'AssignEmoteToSubscriptionProduct', sha256Hash: TWITCH_GQL_HASHES.AssignEmoteToSubscriptionProduct },
        removeFromGroup: { operationName: 'EmotesSettingsRemoveEmoteFromGroup', sha256Hash: TWITCH_GQL_HASHES.EmotesSettingsRemoveEmoteFromGroup },
        assignFollower: { operationName: 'AssignEmoteToFollowerSlot', sha256Hash: TWITCH_GQL_HASHES.AssignEmoteToFollowerSlot },
        assignBits: { operationName: 'AssignEmoteToBitsTier', sha256Hash: TWITCH_GQL_HASHES.AssignEmoteToBitsTier },
        updateOrders: { operationName: 'EmotesSettingsUpdateEmoteOrders', sha256Hash: TWITCH_GQL_HASHES.EmotesSettingsUpdateEmoteOrders },
    };

    for (const [name, hash] of Object.entries(TWITCH_GQL_HASHES)) {
        if (!/^[0-9a-f]{64}$/i.test(hash)) {
            throw new Error(`[TEP] Invalid persisted-query hash for ${name}: ${hash}`);
        }
    }

    const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
    const uuid = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    function cookie(name) {
        const prefix = `${name}=`;
        const item = document.cookie.split('; ').find(v => v.startsWith(prefix));
        return item ? decodeURIComponent(item.slice(prefix.length)) : null;
    }

    function emoteUrl(id, scale = '2.0') {
        return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/${scale}`;
    }

    function dashboardLogin() {
        const m = location.pathname.match(/^\/u\/([^/]+)/i);
        return m ? decodeURIComponent(m[1]) : null;
    }

    function prettyThreshold(n) {
        n = Number(n);
        if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}m`;
        if (n >= 1000 && n % 1000 === 0) return `${n / 1000}k`;
        return String(n);
    }

    function loadState() {
        let raw = null;
        try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch {}

        if (!raw) {
            // Soft migration from v0.4: keep presets and assign old items to Tier1_N.
            // The user can edit those slots afterwards; old storage is left untouched.
            try {
                const old = JSON.parse(localStorage.getItem(OLD_STORAGE_KEY) || 'null');
                if (old) {
                    raw = {
                        delayMs: old.delayMs,
                        panel: old.panel,
                        presets: (old.presets || []).map(p => ({
                            id: p.id || uuid(),
                            name: p.name || 'Imported preset',
                            assignments: (p.emotes || []).map((e, i) => ({
                                slotKey: `legacy:${p.productID || '400473071'}:${i + 1}`,
                                slotLabel: `Tier1_${i + 1}`,
                                emoteID: e.id,
                                emoteLabel: e.label || '',
                            })),
                        })),
                    };
                    console.log(LOG, 'imported v0.4 presets');
                }
            } catch (e) {
                console.warn(LOG, 'v0.4 migration failed', e);
            }
        }

        raw ||= {};
        return {
            presets: Array.isArray(raw.presets) ? raw.presets : [],
            delayMs: Number.isFinite(raw.delayMs) ? raw.delayMs : DEFAULT_DELAY_MS,
            disclosureAccepted: raw.disclosureAccepted === true,
            disclosureDeclined: raw.disclosureDeclined === true,
            panel: {
                left: Number.isFinite(raw.panel?.left) ? raw.panel.left : null,
                top: Number.isFinite(raw.panel?.top) ? raw.panel.top : 72,
                collapsed: Boolean(raw.panel?.collapsed),
                presetCollapsed: raw.panel?.presetCollapsed && typeof raw.panel.presetCollapsed === 'object' ? raw.panel.presetCollapsed : {},
                editorCollapsed: raw.panel?.editorCollapsed !== false,
                width: Number.isFinite(raw.panel?.width) ? raw.panel.width : null,
                height: Number.isFinite(raw.panel?.height) ? raw.panel.height : null,
            },
        };
    }

    const state = loadState();
    let draft = { id: null, name: '', mode: 'patch', scope: null, assignments: [] };
    let live = {
        loaded: false,
        loading: false,
        login: null,
        userID: null,
        catalog: new Map(),
        slots: [],
        slotMap: new Map(),
        raw: null,
    };
    let running = false;
    let stopRequested = false;
    let panel = null;
    let statusBarEl = null;
    let statusEl = null;
    let statusStopEl = null;
    let statusText = '';
    let statusKind = '';
    let statusClearTimer = null;
    let pickerPopup = null;
    let confirmDialog = null;
    let selectedSlotKey = '';
    let selectedEmoteID = '';
    let draggedDraftSlotKey = null;
    let suppressSlotClickUntil = 0;
    let draftOpen = false;
    let draftNameEditing = false;
    let draftNameBeforeEdit = '';

    function saveState() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }

    function syncStatusBar() {
        if (!statusBarEl) return;
        const visible = Boolean(statusText) || running;
        statusBarEl.hidden = !visible;
        statusBarEl.dataset.kind = statusKind || '';
        if (statusEl) statusEl.textContent = statusText || (running ? 'Working…' : '');
        if (statusStopEl) statusStopEl.hidden = !running;
    }

    function setStatus(text, kind = '') {
        statusText = String(text || '');
        statusKind = kind || '';
        if (statusText) console.log(LOG, statusText);
        if (statusClearTimer) clearTimeout(statusClearTimer);
        statusClearTimer = null;
        syncStatusBar();

        // Informational/success messages disappear on their own. Errors stay until the
        // next action so a failed mutation is not easy to miss.
        if (statusText && kind !== 'error' && !running) {
            statusClearTimer = setTimeout(() => {
                statusText = '';
                statusKind = '';
                syncStatusBar();
            }, 4500);
        }
    }

    function getAuthContext() {
        const oauth = cookie('auth-token');
        const deviceID = cookie('unique_id') || cookie('unique_id_durable');
        return { oauth, deviceID };
    }

    async function getIntegrityToken() {
        if (!state.disclosureAccepted) throw new Error('AI Disclosure must be accepted before Twitch requests are allowed');
        const { oauth, deviceID } = getAuthContext();
        if (!oauth) throw new Error('auth-token cookie not found. Twitch login is required.');

        const headers = {
            'Client-ID': CLIENT_ID,
            'Authorization': `OAuth ${oauth}`,
        };
        if (deviceID) headers['X-Device-Id'] = deviceID;

        const res = await window.fetch(INTEGRITY_URL, {
            method: 'POST',
            headers,
            body: null,
            mode: 'cors',
            credentials: 'omit',
        });

        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok) throw new Error(`integrity HTTP ${res.status}: ${text.slice(0, 250)}`);
        if (!json?.token) throw new Error(`integrity response has no token: ${text.slice(0, 250)}`);
        return json.token;
    }

    function gqlHeaders(integrity) {
        const { oauth, deviceID } = getAuthContext();
        if (!oauth) throw new Error('auth-token cookie not found');
        const headers = {
            'Accept': '*/*',
            'Client-ID': CLIENT_ID,
            'Authorization': `OAuth ${oauth}`,
            'Client-Integrity': integrity,
            'Content-Type': 'text/plain;charset=UTF-8',
        };
        if (twitchRuntime.clientVersion) headers['Client-Version'] = twitchRuntime.clientVersion;
        if (twitchRuntime.clientSessionId) headers['Client-Session-Id'] = twitchRuntime.clientSessionId;
        if (deviceID) headers['X-Device-Id'] = deviceID;
        return headers;
    }

    async function gql(operation, integrity) {
        if (!state.disclosureAccepted) throw new Error('AI Disclosure must be accepted before Twitch requests are allowed');
        const res = await window.fetch(GQL_URL, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            headers: gqlHeaders(integrity),
            body: JSON.stringify([operation]),
        });

        const text = await res.text();
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        if (!res.ok) throw new Error(`GQL HTTP ${res.status}: ${text.slice(0, 300)}`);
        const payload = Array.isArray(json) ? json[0] : json;
        if (payload?.errors?.length) {
            throw new Error(payload.errors.map(x => x.message || JSON.stringify(x)).join('; '));
        }
        return payload;
    }

    function persistedOperation(def, variables = {}) {
        return {
            operationName: def.operationName,
            variables,
            extensions: { persistedQuery: { version: 1, sha256Hash: def.sha256Hash } },
        };
    }

    async function withIntegrityRetry(fn, integrity) {
        try {
            return { result: await fn(integrity), integrity };
        } catch (e) {
            if (!/integrity|401|403|unauth|authorization|token/i.test(String(e.message))) throw e;
            console.warn(LOG, 'refreshing integrity token', e);
            const next = await getIntegrityToken();
            return { result: await fn(next), integrity: next };
        }
    }

    async function testAuth() {
        if (!state.disclosureAccepted) return;
        try {
            setStatus('Testing Twitch auth / integrity…');
            const { oauth, deviceID } = getAuthContext();
            console.log(LOG, 'diagnostics', {
                hasOAuthCookie: Boolean(oauth),
                hasUniqueIdCookie: Boolean(deviceID),
                hasKPSDK: Boolean(window.KPSDK),
                fetchName: window.fetch?.name,
            });
            await getIntegrityToken();
            setStatus('✓ Auth + integrity OK', 'ok');
        } catch (e) {
            console.error(LOG, 'auth test failed', e);
            setStatus(`✗ ${e.message}`, 'error');
        }
    }

    async function fetchLiveData({ quiet = false } = {}) {
        if (!isEmotesPage()) return false;
        if (!state.disclosureAccepted) return false;
        if (live.loading) return;
        live.loading = true;
        if (!quiet) setStatus('Loading Twitch emote library…');
        render();

        try {
            let integrity = await getIntegrityToken();
            const cur = await gql(persistedOperation(OPS.currentUser), integrity);
            const currentUser = cur?.data?.currentUser;
            if (!currentUser?.id || !currentUser?.login) throw new Error('CoreActionsCurrentUser returned no user');

            const login = dashboardLogin() || currentUser.login;
            if (login.toLowerCase() !== currentUser.login.toLowerCase()) {
                console.warn(LOG, 'dashboard login differs from current user; using current user ID', { login, currentUser });
            }

            const op = persistedOperation(OPS.emotesSettings, {
                login,
                id: currentUser.id,
                includeLibrary: true,
            });
            const settings = await gql(op, integrity);
            const data = settings?.data;
            if (!data?.user || !data?.userEmoteSettings) throw new Error('EmotesSettings returned unexpected response');

            parseLiveData(data, login, currentUser.id);
            migrateLegacySlots();
            migrateFollowerSlotKeys();
            setStatus(`✓ ${live.catalog.size} emotes · ${live.slots.length} slots`, 'ok');
            console.log(LOG, 'live emote data', live);
            return true;
        } catch (e) {
            console.error(LOG, 'live data load failed', e);
            setStatus(`✗ ${e.message}`, 'error');
            return false;
        } finally {
            live.loading = false;
            render();
        }
    }

    function parseLiveData(data, login, userID) {
        const catalog = new Map();
        const attrs = data.userEmoteSettings?.ownedEmoteAttributions || [];
        for (const item of attrs) {
            const e = item?.emote;
            if (!e?.id) continue;
            catalog.set(e.id, {
                id: e.id,
                label: e.token || e.suffix || e.id,
                suffix: e.suffix || '',
                token: e.token || '',
                state: e.state || '',
                type: e.type || '',
                assetType: e.assetType || 'STATIC',
                setID: e.setID || null,
                order: Number.isFinite(e.order) ? e.order : 0,
                imageSource: e.imageSource || '',
            });
        }

        const slots = [];
        const products = [...(data.user?.subscriptionProducts || [])]
            .sort((a, b) => Number(a.tier) - Number(b.tier));

        for (const product of products) {
            const tierNum = Number(product.tier) / 1000;
            const groups = product.emoteGroups || [];
            const staticGroup = groups.find(g => g.assetType === 'STATIC');
            const animatedGroup = groups.find(g => g.assetType === 'ANIMATED');
            const staticEmotes = [...(staticGroup?.emotes || [])].sort((a, b) => a.order - b.order);
            const animatedEmotes = [...(animatedGroup?.emotes || [])].sort((a, b) => a.order - b.order);
            const staticByOrder = new Map(staticEmotes.map(e => [Number(e.order) || 0, e]));
            const animatedByOrder = new Map(animatedEmotes.map(e => [Number(e.order) || 0, e]));
            const staticLimit = Math.max(Number(product.emoteLimit) || 0, staticEmotes.length);
            const extraAnimated = (product.additionalEmoteLimits || [])
                .filter(x => x?.isUnlocked)
                .reduce((sum, x) => sum + (Number(x.animatedEmoteLimit) || 0), 0);
            const animatedLimit = Math.max((Number(product.animatedEmoteLimit) || 0) + extraAnimated, animatedEmotes.length);

            for (let i = 0; i < staticLimit; i++) {
                slots.push({
                    key: `sub:${product.id}:STATIC:${i + 1}`,
                    label: `Tier${tierNum}_${i + 1}`,
                    kind: 'subscription',
                    assetType: 'STATIC',
                    index: i,
                    productID: product.id,
                    tier: String(product.tier),
                    groupKey: `sub:${product.id}:STATIC`,
                    currentEmoteID: staticByOrder.get(i)?.id || null,
                    currentEmote: staticByOrder.get(i) || null,
                    writable: true,
                });
            }
            for (let i = 0; i < animatedLimit; i++) {
                slots.push({
                    key: `sub:${product.id}:ANIMATED:${i + 1}`,
                    label: `Tier${tierNum}_A${i + 1}`,
                    kind: 'subscription',
                    assetType: 'ANIMATED',
                    index: i,
                    productID: product.id,
                    tier: String(product.tier),
                    groupKey: `sub:${product.id}:ANIMATED`,
                    currentEmoteID: animatedByOrder.get(i)?.id || null,
                    currentEmote: animatedByOrder.get(i) || null,
                    writable: true,
                });
            }
        }

        const follower = attrs.map(x => x?.emote).filter(e => e?.type === 'FOLLOWER' && e?.state === 'ACTIVE')
            .sort((a, b) => a.order - b.order);
        const followerByOrder = new Map(follower.map(e => [Number(e.order) || 0, e]));
        const followerLimit = Math.max(5, ...follower.map(e => (Number(e.order) || 0) + 1));
        for (let i = 0; i < followerLimit; i++) {
            slots.push({
                // Follower slots belong to the channel, not to a stable emote set ID.
                // Keep keys stable even if the group is temporarily empty during an apply.
                key: `follower:${i + 1}`,
                label: `Free${i + 1}`,
                kind: 'follower',
                assetType: 'STATIC',
                index: i,
                channelID: userID,
                groupKey: 'follower',
                currentEmoteID: followerByOrder.get(i)?.id || null,
                currentEmote: followerByOrder.get(i) || null,
                writable: true,
            });
        }

        const bitsTiers = (data.user?.settings?.cheer?.badges?.tiers || [])
            .filter(t => t?.canUploadEmoticons)
            .sort((a, b) => Number(a.threshold) - Number(b.threshold));
        bitsTiers.forEach((tier, i) => {
            const cur = tier.emoticons?.[0] || null;
            slots.push({
                key: `bits:${tier.threshold}`,
                label: `Bits_${i + 1} · ${prettyThreshold(tier.threshold)}`,
                kind: 'bits',
                assetType: 'STATIC',
                index: i,
                threshold: Number(tier.threshold),
                channelID: userID,
                groupKey: `bits:${tier.threshold}`,
                currentEmoteID: cur?.id || null,
                currentEmote: cur,
                writable: true,
            });
        });

        live = {
            loaded: true,
            loading: false,
            login,
            userID,
            catalog,
            slots,
            slotMap: new Map(slots.map(s => [s.key, s])),
            raw: data,
        };
    }

    function migrateLegacySlots() {
        let changed = false;
        for (const preset of state.presets) {
            for (const a of preset.assignments || []) {
                if (!a.slotKey?.startsWith('legacy:')) continue;
                const [, productID, num] = a.slotKey.split(':');
                const em = live.catalog.get(a.emoteID);
                const assetType = em?.assetType === 'ANIMATED' ? 'ANIMATED' : 'STATIC';
                const slot = live.slots.find(s => s.kind === 'subscription' && s.productID === productID && s.assetType === assetType && s.index === Number(num) - 1)
                    || live.slots.find(s => s.kind === 'subscription' && s.assetType === assetType && s.index === Number(num) - 1);
                if (slot) {
                    a.slotKey = slot.key;
                    a.slotLabel = slot.label;
                    changed = true;
                }
            }
        }
        if (changed) saveState();
    }

    function migrateFollowerSlotKeys() {
        let changed = false;
        const migrateKey = key => {
            const m = String(key || '').match(/^follower:[^:]+:(\d+)$/);
            return m ? `follower:${m[1]}` : key;
        };

        for (const preset of state.presets) {
            for (const a of preset.assignments || []) {
                const next = migrateKey(a.slotKey);
                if (next !== a.slotKey) {
                    a.slotKey = next;
                    const slot = live.slotMap.get(next);
                    if (slot) a.slotLabel = slot.label;
                    changed = true;
                }
            }
            if (Array.isArray(preset.scope)) {
                const nextScope = preset.scope.map(migrateKey);
                if (nextScope.some((k, i) => k !== preset.scope[i])) {
                    preset.scope = nextScope;
                    changed = true;
                }
            }
        }
        if (changed) {
            console.log(LOG, 'migrated follower slot keys to stable follower:N form');
            saveState();
        }
    }

    function catalogItemsForSlot(slot) {
        const items = [...live.catalog.values()]
            .filter(e => e.state === 'ACTIVE' || e.state === 'ARCHIVED')
            .filter(e => {
                if (!slot) return true;
                if (slot.assetType === 'ANIMATED') return e.assetType === 'ANIMATED';
                return e.assetType !== 'ANIMATED';
            });
        items.sort((a, b) => {
            const aa = a.state === 'ARCHIVED' ? 1 : 0;
            const bb = b.state === 'ARCHIVED' ? 1 : 0;
            return aa - bb || a.label.localeCompare(b.label);
        });
        return items;
    }

    function addOrReplaceDraftAssignment(slotKey, emoteID) {
        const slot = live.slotMap.get(slotKey);
        const emote = live.catalog.get(emoteID);
        if (!slot) return setStatus('Choose a slot first', 'error');
        if (!emote) return setStatus('Choose an emote first', 'error');

        const incompatible = slot.assetType === 'ANIMATED' ? emote.assetType !== 'ANIMATED' : emote.assetType === 'ANIMATED';
        if (incompatible) return setStatus(`${slot.label} requires ${slot.assetType.toLowerCase()} emote`, 'error');

        const next = {
            slotKey: slot.key,
            slotLabel: slot.label,
            emoteID: emote.id,
            emoteLabel: emote.label,
        };
        const idx = draft.assignments.findIndex(a => a.slotKey === slot.key);
        if (idx >= 0) draft.assignments[idx] = next;
        else draft.assignments.push(next);

        selectedEmoteID = '';
        sortAssignments(draft.assignments);
        render();
    }

    function slotOrder(slotKey) {
        const i = live.slots.findIndex(s => s.key === slotKey);
        return i < 0 ? 999999 : i;
    }

    function sortAssignments(arr) {
        arr.sort((a, b) => slotOrder(a.slotKey) - slotOrder(b.slotKey) || a.slotLabel.localeCompare(b.slotLabel));
    }

    function currentSlotsForEmote(emoteID) {
        if (!emoteID) return [];
        return live.slots.filter(s => s.currentEmoteID === emoteID);
    }

    function moveSources(emoteID, targetSlotKey) {
        const target = live.slotMap.get(targetSlotKey) || null;
        return currentSlotsForEmote(emoteID).filter(s => {
            if (s.key === targetSlotKey) return false;
            if (target && slotCategoryKey(s) === slotCategoryKey(target)) return false;
            return true;
        });
    }

    function moveWarningText(emoteID, targetSlotKey) {
        const sources = moveSources(emoteID, targetSlotKey);
        if (!sources.length) return '';
        return `⚠ will be moved from ${sources.map(s => s.label).join(', ')}`;
    }

    function preflightPreset(preset) {
        const byEmote = new Map();
        for (const a of preset.assignments || []) {
            if (!a?.emoteID) continue;
            if (!byEmote.has(a.emoteID)) byEmote.set(a.emoteID, []);
            byEmote.get(a.emoteID).push(a);
        }

        const duplicates = [...byEmote.entries()].filter(([, items]) => items.length > 1);
        if (duplicates.length) {
            const text = duplicates.map(([id, items]) => {
                const em = live.catalog.get(id);
                return `${em?.label || id} → ${items.map(x => live.slotMap.get(x.slotKey)?.label || x.slotLabel || x.slotKey).join(', ')}`;
            }).join('; ');
            throw new Error(`Same emote is assigned to multiple target slots: ${text}`);
        }

        const moves = [];
        for (const a of preset.assignments || []) {
            const target = live.slotMap.get(a.slotKey);
            for (const source of moveSources(a.emoteID, a.slotKey)) {
                moves.push({ emoteID: a.emoteID, target, source });
            }
        }
        return { moves };
    }

    function resetDraft() {
        draft = { id: null, name: '', mode: 'patch', scope: null, assignments: [] };
        draftOpen = false;
        draftNameEditing = false;
        draftNameBeforeEdit = '';
    }

    function saveDraft() {
        const name = draft.name.trim();
        if (!name) return setStatus('Preset name is empty', 'error');
        if (!draft.assignments.length && draft.mode !== 'snapshot') return setStatus('Preset has no slot assignments', 'error');

        const data = {
            name,
            mode: draft.mode || 'patch',
            scope: draft.mode === 'snapshot' ? structuredClone(draft.scope || []) : null,
            assignments: structuredClone(draft.assignments),
        };
        if (draft.id) {
            const p = state.presets.find(x => x.id === draft.id);
            if (p) Object.assign(p, data);
        } else {
            state.presets.push({ id: uuid(), ...data, createdAt: Date.now() });
        }
        saveState();
        resetDraft();
        setStatus(`Saved ${name}`);
        render();
    }

    function editPreset(preset) {
        draft = {
            id: preset.id,
            name: preset.name,
            mode: preset.mode || 'patch',
            scope: preset.mode === 'snapshot' ? structuredClone(preset.scope || []) : null,
            assignments: structuredClone(preset.assignments || []),
        };
        sortAssignments(draft.assignments);
        draftOpen = true;
        draftNameEditing = false;
        draftNameBeforeEdit = draft.name;
        state.panel.editorCollapsed = false;
        saveState();
        render();
    }

    function deletePreset(id) {
        state.presets = state.presets.filter(p => p.id !== id);
        saveState();
        if (draft.id === id) resetDraft();
        render();
    }

    function sanitizeFileName(name) {
        return String(name || 'preset').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'preset';
    }

    function downloadTextFile(filename, text) {
        const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function duplicatePreset(preset) {
        const copy = structuredClone(preset);
        copy.id = uuid();
        copy.createdAt = Date.now();
        copy.name = `${preset.name} Copy`;
        state.presets.unshift(copy);
        saveState();
        setStatus(`Duplicated ${preset.name}`, 'ok');
        render();
    }

    function exportPreset(preset) {
        const payload = {
            type: 'twitch-emote-preset',
            version: 1,
            exportedAt: new Date().toISOString(),
            preset: structuredClone(preset),
        };
        downloadTextFile(`twitch-emote-preset-${sanitizeFileName(preset.name)}.json`, JSON.stringify(payload, null, 2));
        setStatus(`Exported ${preset.name}`, 'ok');
    }

    function presetCollapsedMap() {
        if (!state.panel.presetCollapsed || typeof state.panel.presetCollapsed !== 'object') state.panel.presetCollapsed = {};
        return state.panel.presetCollapsed;
    }

    function isPresetCollapsed(id) {
        return Boolean(presetCollapsedMap()[id]);
    }

    function togglePresetCollapsed(id) {
        const map = presetCollapsedMap();
        map[id] = !map[id];
        saveState();
        render();
    }

    function confirmAction(options) {
        confirmDialog = options;
        render();
    }

    function closeConfirm() {
        confirmDialog = null;
        render();
    }

    function isEditorCollapsed() {
        return Boolean(state.panel.editorCollapsed);
    }

    function toggleEditorCollapsed() {
        state.panel.editorCollapsed = !state.panel.editorCollapsed;
        saveState();
        render();
    }

    function focusDraftNameInput(selectAll = false) {
        requestAnimationFrame(() => {
            const input = panel?.querySelector('.tep-editor-name-input');
            if (!input) return;
            input.focus();
            if (selectAll) input.select();
        });
    }

    function beginDraftNameEdit() {
        draftNameBeforeEdit = draft.name;
        draftNameEditing = true;
        render();
        focusDraftNameInput(true);
    }

    function finishDraftNameEdit(cancel = false) {
        if (cancel) draft.name = draftNameBeforeEdit;
        draftNameEditing = false;
        draftNameBeforeEdit = '';
        render();
    }

    function newPresetDraft() {
        resetDraft();
        draftOpen = true;
        draftNameEditing = true;
        state.panel.editorCollapsed = false;
        saveState();
        render();
        focusDraftNameInput(false);
    }

    function displayEmoteName(emote) {
        if (!emote) return '';
        return emote.suffix || emote.label || emote.token || emote.id || '';
    }

    function defaultSnapshotName() {
        const d = new Date();
        const pad = n => String(n).padStart(2, '0');
        return `Backup ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    async function copyCurrentIntoEditor() {
        if (running || live.loading) return;
        const ok = await fetchLiveData({ quiet: true });
        if (!ok || !live.loaded) return;

        const scope = live.slots.map(s => s.key);
        const assignments = live.slots
            .filter(s => s.currentEmoteID)
            .map(s => {
                const em = live.catalog.get(s.currentEmoteID);
                return {
                    slotKey: s.key,
                    slotLabel: s.label,
                    emoteID: s.currentEmoteID,
                    emoteLabel: em?.label || s.currentEmoteID,
                };
            });
        sortAssignments(assignments);

        draft = { id: null, name: '', mode: 'snapshot', scope, assignments };
        draftOpen = true;
        draftNameEditing = true;
        state.panel.editorCollapsed = false;
        saveState();
        selectedSlotKey = '';
        selectedEmoteID = '';
        setStatus(`Copied current layout into editor: ${assignments.length} emotes / ${scope.length} slots`, 'ok');
        render();
        focusDraftNameInput(false);
    }

    function assignSubscriptionOperation(emoteID, productID) {
        return persistedOperation(OPS.assignSubscription, {
            input: { emoteID: String(emoteID), productID: String(productID) },
        });
    }

    function assignFollowerOperation(emoteID, channelID) {
        return persistedOperation(OPS.assignFollower, {
            input: { channelID: String(channelID), emoteID: String(emoteID) },
        });
    }

    function assignBitsOperation(emoteID, channelID, tierThreshold) {
        return persistedOperation(OPS.assignBits, {
            input: {
                channelID: String(channelID),
                emoteID: String(emoteID),
                tierThreshold: Number(tierThreshold),
            },
        });
    }

    function updateEmoteOrdersOperation(orders) {
        return persistedOperation(OPS.updateOrders, {
            input: {
                orders: orders.map(x => ({
                    emoteID: String(x.emoteID),
                    groupID: String(x.groupID),
                    order: Number(x.order),
                })),
            },
        });
    }

    function removeOperation(emoteID) {
        return persistedOperation(OPS.removeFromGroup, {
            input: { emoteID: String(emoteID) },
        });
    }

async function removeEmote(emoteID, integrity) {
    const payload = await gql(removeOperation(emoteID), integrity);
    const result = payload?.data?.removeEmoteFromGroup;

    if (result?.error)
        throw new Error(`Remove ${emoteID}: ${JSON.stringify(result.error)}`);

    return payload;
}

    async function assignSubscription(emoteID, productID, integrity) {
        const payload = await gql(assignSubscriptionOperation(emoteID, productID), integrity);
        const result = payload?.data?.assignEmoteToSubscriptionProduct;
        if (!result) throw new Error(`Unexpected subscription assign response for ${emoteID}`);
        if (result.error) throw new Error(`Assign ${emoteID}: ${JSON.stringify(result.error)}`);
        return payload;
    }

    async function assignFollower(emoteID, channelID, integrity) {
        const payload = await gql(assignFollowerOperation(emoteID, channelID), integrity);
        const result = payload?.data?.assignEmoteToFollowerSlot;
        if (!result) throw new Error(`Unexpected follower assign response for ${emoteID}`);
        if (result.error) throw new Error(`Assign follower ${emoteID}: ${JSON.stringify(result.error)}`);
        return payload;
    }

    async function assignBits(emoteID, channelID, tierThreshold, integrity) {
        const payload = await gql(assignBitsOperation(emoteID, channelID, tierThreshold), integrity);
        const result = payload?.data?.assignEmoteToBitsTier;
        if (!result) throw new Error(`Unexpected Bits assign response for ${emoteID}`);
        if (result.error) throw new Error(`Assign Bits ${emoteID}: ${JSON.stringify(result.error)}`);
        return payload;
    }

    async function updateEmoteOrders(orders, integrity) {
        if (!orders.length) return null;
        const payload = await gql(updateEmoteOrdersOperation(orders), integrity);
        const result = payload?.data?.updateEmoteOrders;
        if (!result) throw new Error('Unexpected UpdateEmoteOrders response');
        if (result.error) throw new Error(`Update emote order: ${JSON.stringify(result.error)}`);
        return payload;
    }

    function applyPlanError(message) {
        throw new Error(`Internal apply plan error: ${message}`);
    }

    function compareApplySlots(a, b) {
        const kinds = { subscription: 0, follower: 1, bits: 2 };
        const assets = { STATIC: 0, ANIMATED: 1 };
        const text = (x, y) => String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0;
        return (kinds[a.kind] ?? 99) - (kinds[b.kind] ?? 99)
            || Number(a.tier || 0) - Number(b.tier || 0)
            || (assets[a.assetType] ?? 99) - (assets[b.assetType] ?? 99)
            || Number(a.threshold || 0) - Number(b.threshold || 0)
            || text(a.groupKey, b.groupKey)
            || a.index - b.index || text(a.key, b.key);
    }

    function applyEmoteName(id) {
        return id ? live.catalog.get(id)?.label || id : 'empty';
    }

    function buildApplyPlan(preset) {
        // Validate raw assignments before any Map can hide duplicate destinations.
        const assignments = preset.assignments || [];
        const destinations = new Set();
        for (const a of assignments) {
            const slot = live.slotMap.get(a.slotKey);
            if (!slot?.writable) applyPlanError(`unavailable destination ${a.slotLabel || a.slotKey}`);
            if (destinations.has(a.slotKey)) applyPlanError(`duplicate destination ${slot.label}`);
            destinations.add(a.slotKey);
            const emote = live.catalog.get(a.emoteID);
            if (!emote) applyPlanError(`unknown emote ${a.emoteID}`);
            if ((slot.assetType === 'ANIMATED') !== (emote.assetType === 'ANIMATED')) {
                applyPlanError(`incompatible emote ${applyEmoteName(a.emoteID)} → ${slot.label}`);
            }
        }
        let preflight;
        try { preflight = preflightPreset(preset); } catch (e) { applyPlanError(e.message); }
        const scope = new Set(preset.mode === 'snapshot' ? preset.scope || [] : destinations);
        for (const key of scope) {
            if (!live.slotMap.get(key)?.writable) applyPlanError(`unavailable scoped slot ${key}`);
        }
        for (const key of destinations) {
            if (!scope.has(key)) applyPlanError(`assignment outside snapshot scope: ${key}`);
        }

        const slots = [...live.slots].sort(compareApplySlots);
        const desired = new Map(slots.map(s => [s.key, s.currentEmoteID || null]));
        if (preset.mode === 'snapshot') for (const key of scope) desired.set(key, null);
        // Clear sources even outside scope, including moves within one category.
        const sources = [...preflight.moves.map(m => m.source)];
        for (const a of assignments) sources.push(...currentSlotsForEmote(a.emoteID).filter(s => s.key !== a.slotKey));
        for (const source of sources) desired.set(source.key, null);
        for (const a of assignments) desired.set(a.slotKey, a.emoteID);
        const expected = new Map([...scope].map(key => [key, desired.get(key)]));
        const groups = new Map();
        for (const slot of slots) {
            if (!groups.has(slot.groupKey)) groups.set(slot.groupKey, []);
            groups.get(slot.groupKey).push(slot);
        }
        const plan = { removes: [], assigns: [], followerOrders: [], expected, slots, desired };
        const removeIDs = new Set();
        const remove = id => { if (id) removeIDs.add(id); };
        for (const group of groups.values()) {
            if (group.every(s => (s.currentEmoteID || null) === desired.get(s.key))) continue;
            const first = group[0];
            if (first.kind === 'subscription') {
                // Sequential subscription assigns can only reproduce a compact list.
                const target = group.map(s => desired.get(s.key)).filter(Boolean);
                const current = group.map(s => s.currentEmoteID).filter(Boolean);
                // Appending to an already correct compact prefix needs no rebuild.
                const appendOnly = group.every((s, i) => (s.currentEmoteID || null) === (current[i] || null))
                    && current.every((id, i) => id === target[i]);
                group.forEach((s, i) => desired.set(s.key, target[i] || null));
                for (const slot of group) {
                    if (expected.has(slot.key) && expected.get(slot.key) !== desired.get(slot.key)) {
                        applyPlanError(`${slot.label}: subscription ordering cannot preserve a gap; use a compact target layout`);
                    }
                    if (!appendOnly) remove(slot.currentEmoteID);
                    const emoteID = desired.get(slot.key);
                    if (emoteID && (!appendOnly || !slot.currentEmoteID)) plan.assigns.push({ emoteID, slot });
                }
            } else if (first.kind === 'follower' || first.kind === 'bits') {
                for (const slot of group) {
                    const emoteID = desired.get(slot.key);
                    if ((slot.currentEmoteID || null) === emoteID) continue;
                    remove(slot.currentEmoteID);
                    if (emoteID) plan.assigns.push({ emoteID, slot });
                }
                if (first.kind === 'follower') {
                    const orders = group.filter(s => desired.get(s.key)).map(s => ({ emoteID: desired.get(s.key), slot: s, order: s.index }));
                    if (orders.length) plan.followerOrders.push({ groupKey: first.groupKey, orders });
                }
            } else applyPlanError(`unsupported category ${first.kind}`);
        }
        // An assign must be preceded by removal of any existing membership.
        for (const op of plan.assigns) for (const source of currentSlotsForEmote(op.emoteID)) remove(source.currentEmoteID);
        for (const id of removeIDs) {
            const source = slots.find(s => s.currentEmoteID === id);
            if (!source) applyPlanError(`missing removal source ${applyEmoteName(id)}`);
            plan.removes.push({ emoteID: id, slot: source });
        }
        plan.removes.sort((a, b) => compareApplySlots(a.slot, b.slot));
        plan.assigns.sort((a, b) => compareApplySlots(a.slot, b.slot));
        plan.followerOrders.sort((a, b) => compareApplySlots(a.orders[0].slot, b.orders[0].slot));
        validateApplyPlan(plan);
        return plan;
    }

    function validateApplyPlan(plan) {
        const removed = new Set();
        for (const op of plan.removes) {
            if (removed.has(op.emoteID)) applyPlanError(`duplicate remove ${applyEmoteName(op.emoteID)}`);
            removed.add(op.emoteID);
        }
        const pairs = new Set(), destinations = new Set(), assigned = new Set(), finalIDs = new Set();
        for (const id of plan.desired.values()) {
            if (!id) continue;
            if (finalIDs.has(id)) applyPlanError(`multiple final destinations for ${applyEmoteName(id)}`);
            finalIDs.add(id);
        }
        for (const op of plan.assigns) {
            const key = JSON.stringify([op.emoteID, op.slot.key]);
            if (pairs.has(key) || assigned.has(op.emoteID)) applyPlanError(`duplicate assign ${applyEmoteName(op.emoteID)} → ${op.slot.label}`);
            if (destinations.has(op.slot.key)) applyPlanError(`duplicate destination ${op.slot.label}`);
            pairs.add(key);
            assigned.add(op.emoteID);
            destinations.add(op.slot.key);
            if (currentSlotsForEmote(op.emoteID).length && !removed.has(op.emoteID)) applyPlanError(`missing source removal ${applyEmoteName(op.emoteID)}`);
            if (plan.desired.get(op.slot.key) !== op.emoteID) applyPlanError(`assign disagrees with target ${op.slot.label}`);
        }
        // Every desired membership must survive removals or have exactly one assign.
        for (const slot of plan.slots) {
            const id = plan.desired.get(slot.key);
            if (id && !assigned.has(id) && (removed.has(id) || slot.currentEmoteID !== id)) {
                applyPlanError(`missing assign ${applyEmoteName(id)} → ${slot.label}`);
            }
        }
    }

    function logApplyPlan(plan) {
        const lines = ['Apply plan', 'REMOVE:', ...plan.removes.map(x => `  ${applyEmoteName(x.emoteID)} <- ${x.slot.label}`),
            'ASSIGN:', ...plan.assigns.map(x => `  ${applyEmoteName(x.emoteID)} -> ${x.slot.label}`),
            'ORDER:', ...plan.followerOrders.flatMap(g => g.orders.map(x => `  ${x.slot.label} = ${applyEmoteName(x.emoteID)} (order ${x.order})`))];
        console.log(LOG, lines.join('\n'));
    }

    async function refreshApplyState(phase) {
        if (stopRequested) throw new Error('Stopped');
        if (!await fetchLiveData({ quiet: true })) throw new Error(`Could not refresh emote layout ${phase}`);
        if (stopRequested) throw new Error('Stopped');
    }

    function validateAfterRemoves(plan) {
        const removed = new Set(plan.removes.map(x => x.emoteID));
        // Compare membership, not compact slot indices, which removals can shift.
        const memberships = slots => slots.map(s => JSON.stringify([s.groupKey, s.currentEmoteID])).sort();
        const expected = memberships(plan.slots.filter(s => s.currentEmoteID && !removed.has(s.currentEmoteID)));
        const actual = memberships(live.slots.filter(s => s.currentEmoteID));
        if (JSON.stringify(expected) !== JSON.stringify(actual)) {
            throw new Error('Apply state changed after removals: membership differs from the plan. Reload and try again.');
        }
        for (const op of plan.assigns) {
            const slot = live.slotMap.get(op.slot.key);
            if (!slot?.writable || ['kind', 'groupKey', 'productID', 'channelID', 'threshold', 'assetType'].some(k => slot[k] !== op.slot[k])) {
                throw new Error(`Apply destination changed after removals: ${op.slot.label}`);
            }
        }
    }

    async function executeApplyMutation(execution, label, mutate) {
        if (stopRequested) throw new Error('Stopped');
        setStatus(`${execution.name}: ${label}`);
        const result = await withIntegrityRetry(token => {
            // Also protect a retry after an integrity refresh from a pending Stop.
            if (stopRequested) throw new Error('Stopped');
            return mutate(token);
        }, execution.integrity);
        execution.integrity = result.integrity;
        execution.operationsDone++;
        await sleep(state.delayMs);
    }

    async function executeRemovePhase(plan, execution) {
        for (const op of plan.removes) {
            await executeApplyMutation(execution, `remove ${applyEmoteName(op.emoteID)} ← ${op.slot.label}`, token => removeEmote(op.emoteID, token));
        }
    }

    async function executeAssignPhase(plan, execution) {
        for (const op of plan.assigns) {
            const slot = live.slotMap.get(op.slot.key);
            await executeApplyMutation(execution, `assign ${applyEmoteName(op.emoteID)} → ${slot.label}`, token => {
                if (slot.kind === 'subscription') return assignSubscription(op.emoteID, slot.productID, token);
                if (slot.kind === 'follower') return assignFollower(op.emoteID, slot.channelID || live.userID, token);
                return assignBits(op.emoteID, slot.channelID || live.userID, slot.threshold, token);
            });
        }
    }

    async function executeReorderPhase(plan, execution) {
        if (!plan.followerOrders.length) return;
        await refreshApplyState('before Free ordering');
        for (const group of plan.followerOrders) {
            const followerSlots = live.slots.filter(s => s.groupKey === group.groupKey && s.currentEmoteID);
            const present = new Set(followerSlots.map(s => s.currentEmoteID));
            if (present.size !== group.orders.length || group.orders.some(x => !present.has(x.emoteID))) {
                throw new Error('Free ordering: membership differs from the plan after assign');
            }
            const groupID = followerSlots.map(s => s.currentEmote?.setID || live.catalog.get(s.currentEmoteID)?.setID).find(Boolean);
            if (!groupID) throw new Error('Free ordering: follower groupID not found');
            const orders = group.orders.map(x => ({ emoteID: x.emoteID, groupID, order: x.order }));
            await executeApplyMutation(execution, 'order Free slots', token => updateEmoteOrders(orders, token));
        }
    }

    function verifyAppliedPreset(plan) {
        const mismatches = [];
        for (const slot of plan.slots) {
            if (!plan.expected.has(slot.key)) continue;
            const expected = plan.expected.get(slot.key);
            const actual = live.slotMap.get(slot.key);
            if (!actual || (actual.currentEmoteID || null) !== expected) {
                mismatches.push(`${slot.label}: expected ${applyEmoteName(expected)}, got ${actual ? applyEmoteName(actual.currentEmoteID) : 'missing slot'}`);
            }
        }
        if (mismatches.length) throw new Error(`Preset verification failed: ${mismatches.join('; ')}`);
    }

    async function applyPreset(preset) {
        if (running) return;
        if (!twitchRuntime.clientVersion) {
            setStatus('Twitch Client-Version has not been captured yet. Reload the dashboard page and try again.', 'error');
            return;
        }
        running = true;
        stopRequested = false;
        render();
        try {
            await refreshApplyState('before planning');
            const plan = buildApplyPlan(preset);
            logApplyPlan(plan);
            const execution = { name: preset.name, integrity: await getIntegrityToken(), operationsDone: 0 };
            await executeRemovePhase(plan, execution);
            await refreshApplyState('after removals');
            validateAfterRemoves(plan);
            await executeAssignPhase(plan, execution);
            await executeReorderPhase(plan, execution);
            await refreshApplyState('before verification');
            verifyAppliedPreset(plan);
            setStatus(`✓ ${preset.name}: ${execution.operationsDone} requests`, 'ok');
        } catch (e) {
            if (e.message === 'Stopped') setStatus('Stopped');
            else {
                console.error(LOG, 'preset apply failed', e);
                setStatus(`✗ ${e.message}`, 'error');
            }
        } finally {
            running = false;
            if (statusText && statusKind !== 'error') setStatus(statusText, statusKind);
            render();
        }
    }

    function h(tag, attrs = {}, ...children) {
        const el = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') el.className = v;
            else if (k === 'text') el.textContent = v;
            else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
            else if (k === 'value') el.value = v ?? '';
            else if (k === 'checked') el.checked = Boolean(v);
            else if (k === 'disabled') el.disabled = Boolean(v);
            else if (v !== undefined && v !== null && v !== false) el.setAttribute(k, String(v));
        }
        for (const child of children.flat()) {
            if (child == null) continue;
            el.append(child instanceof Node ? child : document.createTextNode(String(child)));
        }
        return el;
    }

    function closePicker() {
        if (pickerPopup) pickerPopup.remove();
        pickerPopup = null;
    }

    function openEmotePicker(anchor, slot, onPick) {
        closePicker();

        const usedInDraft = new Set((draft.assignments || []).map(a => a.emoteID).filter(Boolean));
        const items = catalogItemsForSlot(slot).filter(e => !usedInDraft.has(e.id));

        const popup = h('div', { class: 'tep-picker-popup' });
        const search = h('input', { class: 'tep-input tep-picker-search', placeholder: 'Search emotes…', autocomplete: 'off' });
        const grid = h('div', { class: 'tep-picker-grid' });
        popup.append(search, grid);

        const draw = () => {
            const q = search.value.trim().toLowerCase();
            grid.replaceChildren();
            const filtered = items.filter(e => !q || `${e.label || ''} ${e.suffix || ''} ${e.token || ''} ${e.id}`.toLowerCase().includes(q));

            for (const e of filtered.slice(0, 180)) {
                const name = displayEmoteName(e) || e.id;
                grid.append(h('button', {
                    class: 'tep-picker-tile',
                    title: `${name}${e.assetType === 'ANIMATED' ? ' · animated' : ''}${e.state === 'ARCHIVED' ? ' · archived' : ''}`,
                    onclick: ev => { ev.preventDefault(); onPick(e); closePicker(); },
                },
                    h('img', { src: emoteUrl(e.id), alt: name }),
                    e.assetType === 'ANIMATED' ? h('span', { class: 'tep-picker-tile-badge', text: 'A' }) : null,
                    e.state === 'ARCHIVED' ? h('span', { class: 'tep-picker-tile-state', text: 'archive' }) : null,
                ));
            }

            if (!filtered.length) {
                grid.append(h('div', {
                    class: 'tep-muted tep-picker-empty',
                    text: items.length ? 'No matching emotes' : 'All compatible emotes are already used in this preset',
                }));
            }
        };

        search.addEventListener('input', draw);
        draw();

        panel.append(popup);
        pickerPopup = popup;
        const ar = anchor.getBoundingClientRect();
        const pr = panel.getBoundingClientRect();
        const popupWidth = Math.min(360, Math.max(250, pr.width - 20));
        popup.style.width = `${popupWidth}px`;
        const top = Math.min(ar.bottom - pr.top + 4, pr.height - 320);
        popup.style.top = `${Math.max(46, top)}px`;
        popup.style.left = `${Math.max(8, Math.min(ar.left - pr.left, pr.width - popupWidth - 8))}px`;
        requestAnimationFrame(() => search.focus());
    }

    function emoteChoiceButton(slot, emoteID, onPick) {
        const em = emoteID ? live.catalog.get(emoteID) : null;
        const button = h('button', {
            class: 'tep-emote-choice',
            title: em ? em.id : 'Choose emote',
            onclick: e => openEmotePicker(e.currentTarget, slot, onPick),
        },
            em ? h('img', { src: emoteUrl(em.id), alt: '' }) : h('span', { class: 'tep-choice-plus', text: '+' }),
            h('span', { class: 'tep-choice-name', text: em?.label || 'Choose emote…' }),
            h('span', { class: 'tep-chevron', text: '▾' }),
        );
        return button;
    }

    function assignmentList(assignments, removable = false) {
        const box = h('div', { class: 'tep-assignment-list' });
        if (!assignments?.length) return box;
        const sorted = [...assignments];
        sortAssignments(sorted);
        for (const a of sorted) {
            const slot = live.slotMap.get(a.slotKey);
            const em = live.catalog.get(a.emoteID) || { id: a.emoteID, label: a.emoteLabel || a.emoteID };
            box.append(h('div', { class: 'tep-assignment' },
                h('span', { class: `tep-slot-name ${slot && !slot.writable ? 'tep-slot-readonly' : ''}`, title: slot?.unsupportedReason || '', text: slot?.label || a.slotLabel || a.slotKey }),
                h('img', { src: emoteUrl(em.id), alt: '' }),
                h('span', { class: 'tep-assignment-name', text: em.label || em.id }),
                slot && !slot.writable ? h('span', { class: 'tep-lock', title: slot.unsupportedReason, text: '⚠' }) : null,
                removable ? h('button', {
                    class: 'tep-remove', title: 'Remove assignment', onclick: () => {
                        draft.assignments = draft.assignments.filter(x => x.slotKey !== a.slotKey);
                        render();
                    },
                }, '×') : null,
            ));
        }
        return box;
    }

    function selectedSlot() {
        return live.slotMap.get(selectedSlotKey) || null;
    }

    function slotCategoryKey(slot) {
        if (slot.kind === 'follower') return 'follower';
        if (slot.kind === 'bits') return 'bits';
        if (slot.kind === 'subscription') return `subscription:${slot.tier}:${slot.assetType}`;
        return slot.groupKey || slot.kind;
    }

    function slotCategoryName(slot) {
        if (slot.kind === 'follower') return 'Free';
        if (slot.kind === 'bits') return 'Bits';
        if (slot.kind === 'subscription') {
            const tierLabel = `Tier ${Number(slot.tier) / 1000 || slot.tier}`;
            return slot.assetType === 'ANIMATED' ? `${tierLabel} Animated` : tierLabel;
        }
        return slot.kind;
    }

    function slotBadgeText(slot) {
        if (slot.kind === 'bits') return prettyThreshold(slot.threshold);
        return String(slot.index + 1);
    }


    function assignmentMapFor(assignments) {
        return new Map((assignments || []).map(a => [a.slotKey, a]));
    }

    function renderSlotTokenLabel(slot, emote) {
        const name = displayEmoteName(emote);
        if (name) return name;
        if (slot.kind === 'bits') return `Bits ${prettyThreshold(slot.threshold)}`;
        return 'Empty';
    }

    function collectLayoutCategories(assignments) {
        const map = assignmentMapFor(assignments);
        const categories = [];
        const byKey = new Map();

        for (const slot of live.slots) {
            const key = slotCategoryKey(slot);
            let cat = byKey.get(key);
            if (!cat) {
                cat = { key, name: slotCategoryName(slot), slots: [], total: 0, used: 0 };
                byKey.set(key, cat);
                categories.push(cat);
            }
            const assignment = map.get(slot.key) || null;
            cat.slots.push({ slot, assignment });
            cat.total += 1;
            if (assignment?.emoteID) cat.used += 1;
        }
        return categories;
    }

    function removeDraftAssignment(slotKey) {
        draft.assignments = draft.assignments.filter(x => x.slotKey !== slotKey);
        render();
    }

    function draftAssignmentForSlot(slotKey) {
        return (draft.assignments || []).find(a => a.slotKey === slotKey) || null;
    }

    function clearDragHighlights() {
        if (!panel) return;
        panel.querySelectorAll('.tep-dragging,.tep-drop-target').forEach(el => {
            el.classList.remove('tep-dragging', 'tep-drop-target');
        });
    }

    function canDragSortSlot(slot, assignment) {
        return Boolean(slot && assignment?.emoteID && slot.writable && slot.kind !== 'bits');
    }

    function canDropDraftSlot(sourceKey, targetKey) {
        if (!sourceKey || !targetKey || sourceKey === targetKey) return false;
        const source = live.slotMap.get(sourceKey);
        const target = live.slotMap.get(targetKey);
        if (!source || !target || !source.writable || !target.writable) return false;
        if (source.kind === 'bits' || target.kind === 'bits') return false;
        if (slotCategoryKey(source) !== slotCategoryKey(target)) return false;
        if (!draftAssignmentForSlot(sourceKey)?.emoteID) return false;

        // A patch cannot express "clear the old slot". Swapping two assigned slots is safe,
        // while moving into an empty slot is only deterministic for snapshots.
        if (draft.mode !== 'snapshot' && !draftAssignmentForSlot(targetKey)) return false;
        return true;
    }

    function rebindAssignment(assignment, slot) {
        if (!assignment || !slot) return null;
        return {
            ...assignment,
            slotKey: slot.key,
            slotLabel: slot.label,
        };
    }

    function dragSortDraft(sourceKey, targetKey) {
        if (!canDropDraftSlot(sourceKey, targetKey)) {
            const targetAssignment = draftAssignmentForSlot(targetKey);
            if (draft.mode !== 'snapshot' && !targetAssignment) {
                setStatus('Patch preset: drag to an empty slot is ambiguous. Use Copy current/snapshot or assign that slot first.', 'error');
            }
            return false;
        }

        const sourceSlot = live.slotMap.get(sourceKey);
        const targetSlot = live.slotMap.get(targetKey);
        const sourceAssignment = draftAssignmentForSlot(sourceKey);
        const targetAssignment = draftAssignmentForSlot(targetKey);

        draft.assignments = draft.assignments.filter(a => a.slotKey !== sourceKey && a.slotKey !== targetKey);
        if (targetAssignment) draft.assignments.push(rebindAssignment(targetAssignment, sourceSlot));
        draft.assignments.push(rebindAssignment(sourceAssignment, targetSlot));

        if (draft.mode === 'snapshot') {
            const scope = new Set(draft.scope || []);
            scope.add(sourceKey);
            scope.add(targetKey);
            draft.scope = [...scope];
        }

        sortAssignments(draft.assignments);
        setStatus(`${displayEmoteName(live.catalog.get(sourceAssignment.emoteID)) || sourceAssignment.emoteLabel || 'Emote'} → ${targetSlot.label}`, 'ok');
        render();
        return true;
    }

    function slotWarning(slot, emoteID) {
        if (!emoteID) return '';
        return moveWarningText(emoteID, slot.key);
    }

    function renderSlotCard(slot, assignment, options = {}) {
        const editable = Boolean(options.editable);
        const emoteID = assignment?.emoteID || null;
        const emote = emoteID ? (live.catalog.get(emoteID) || { id: emoteID, label: assignment?.emoteLabel || emoteID }) : null;
        const warning = slotWarning(slot, emoteID);
        const dragEnabled = editable && canDragSortSlot(slot, assignment);
        const classes = ['tep-slot-card'];
        if (editable) classes.push('tep-slot-editable');
        if (dragEnabled) classes.push('tep-slot-draggable');
        if (!emote) classes.push('tep-slot-empty');
        if (warning) classes.push('tep-slot-warning');
        if (!slot.writable && editable) classes.push('tep-slot-disabled');

        const card = h('div', {
            class: classes.join(' '),
            draggable: dragEnabled ? 'true' : null,
            title: warning || (slot.writable ? `${slot.label}${emote ? ` · ${emote.label}` : ''}` : (slot.unsupportedReason || slot.label)),
            onclick: editable && slot.writable ? (e => {
                if (Date.now() < suppressSlotClickUntil) return;
                openEmotePicker(e.currentTarget, slot, picked => addOrReplaceDraftAssignment(slot.key, picked.id));
            }) : null,
            ondragstart: dragEnabled ? (e => {
                draggedDraftSlotKey = slot.key;
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', slot.key);
                requestAnimationFrame(() => e.currentTarget.classList.add('tep-dragging'));
            }) : null,
            ondragend: dragEnabled ? (e => {
                draggedDraftSlotKey = null;
                suppressSlotClickUntil = Date.now() + 180;
                clearDragHighlights();
            }) : null,
            ondragover: editable ? (e => {
                const sourceKey = draggedDraftSlotKey || e.dataTransfer.getData('text/plain');
                if (!canDropDraftSlot(sourceKey, slot.key)) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                e.currentTarget.classList.add('tep-drop-target');
            }) : null,
            ondragleave: editable ? (e => {
                e.currentTarget.classList.remove('tep-drop-target');
            }) : null,
            ondrop: editable ? (e => {
                const sourceKey = draggedDraftSlotKey || e.dataTransfer.getData('text/plain');
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.classList.remove('tep-drop-target');
                suppressSlotClickUntil = Date.now() + 180;
                dragSortDraft(sourceKey, slot.key);
                draggedDraftSlotKey = null;
                clearDragHighlights();
            }) : null,
        },
            editable && emote ? h('button', {
                class: 'tep-slot-clear',
                title: draft.mode === 'snapshot' ? 'Clear slot in preset' : 'Remove slot from preset',
                onclick: ev => { ev.preventDefault(); ev.stopPropagation(); removeDraftAssignment(slot.key); },
            }, '×') : null,
            h('div', { class: 'tep-slot-visual' },
                emote ? h('img', { src: emoteUrl(emote.id), alt: '' }) : h('span', { class: 'tep-slot-plus', text: '+' }),
            ),
            h('div', { class: 'tep-slot-label' },
                h('span', { class: 'tep-slot-token', text: slotBadgeText(slot) }),
                h('span', { class: 'tep-slot-token', text: emote ? renderSlotTokenLabel(slot, emote) : 'Empty' }),
                warning ? h('span', { class: 'tep-slot-warning-icon', text: '⚠', 'aria-hidden': 'true' }) : null,
            ),
        );
        return card;
    }

    function renderCategory(category, options = {}) {
        return h('section', { class: 'tep-category' },
            h('div', { class: 'tep-category-name' },
                h('span', { class: 'tep-category-title', text: category.name }),
                h('span', { class: 'tep-category-count', text: `(${category.used}/${category.total})` }),
            ),
            h('div', { class: 'tep-slot-grid' },
                category.slots.map(item => renderSlotCard(item.slot, item.assignment, options)),
            ),
        );
    }

    function renderPresetLayout(assignments, options = {}) {
        const categories = collectLayoutCategories(assignments);
        return h('div', { class: 'tep-layout' }, categories.map(cat => renderCategory(cat, options)));
    }

    function renderEditorSection() {
        const collapsed = isEditorCollapsed();
        const showNameInput = !draft.id || draftNameEditing;
        const nameControl = showNameInput
            ? h('input', {
                class: 'tep-input tep-editor-name-input',
                placeholder: 'Preset name',
                value: draft.name,
                onclick: e => e.stopPropagation(),
                oninput: e => { draft.name = e.target.value; },
                onkeydown: e => {
                    if (e.key === 'Enter') { e.preventDefault(); finishDraftNameEdit(false); }
                    if (e.key === 'Escape' && draft.id) { e.preventDefault(); finishDraftNameEdit(true); }
                },
                onblur: () => { if (draft.id && draftNameEditing) finishDraftNameEdit(false); },
            })
            : h('div', { class: 'tep-editor-title-row' },
                h('div', { class: 'tep-card-title', text: draft.name || 'Untitled preset' }),
                h('button', {
                    class: 'tep-name-edit',
                    title: 'Rename preset',
                    onclick: e => { e.preventDefault(); e.stopPropagation(); beginDraftNameEdit(); },
                }, '✎'),
            );

        const card = h('section', { class: `tep-card tep-editor-card${collapsed ? ' tep-card-collapsed' : ''}` },
            h('div', {
                class: 'tep-card-head tep-editor-head',
                onclick: e => { if (!e.target.closest('button,input')) toggleEditorCollapsed(); },
            },
                h('div', { class: 'tep-card-head-main tep-editor-head-main' },
                    h('button', {
                        class: 'tep-disclosure',
                        title: collapsed ? 'Expand editor' : 'Collapse editor',
                        onclick: e => { e.preventDefault(); e.stopPropagation(); toggleEditorCollapsed(); },
                    }, collapsed ? '▸' : '▾'),
                    h('div', { class: 'tep-card-title-wrap tep-editor-title-wrap' },
                        nameControl,
                        h('div', { class: 'tep-card-subtitle', text: draft.mode === 'snapshot' ? 'Snapshot restores empty slots too.' : 'Click a slot to choose an emote.' }),
                    ),
                ),
                h('div', { class: 'tep-inline-actions tep-editor-actions' },
                    h('button', { class: 'tep-btn', onclick: e => { e.stopPropagation(); copyCurrentIntoEditor(); }, disabled: running || live.loading }, 'Copy current'),
                    h('button', { class: 'tep-btn', onclick: e => { e.stopPropagation(); resetDraft(); render(); }, disabled: running }, 'Cancel'),
                ),
            ),
        );

        if (collapsed) return card;

        card.append(
            renderPresetLayout(draft.assignments, { editable: true }),
            h('div', { class: 'tep-editor-footer' },
                h('div', { class: 'tep-muted', text: draft.mode === 'snapshot' ? 'Yellow outline means this emote will be moved from another category.' : 'Empty slots in patch presets stay untouched when applied.' }),
                h('div', { class: 'tep-inline-actions' },
                    h('button', { class: 'tep-btn tep-save', onclick: saveDraft, disabled: running }, draft.id ? 'Update preset' : 'Save preset'),
                ),
            ),
        );
        return card;
    }

    function presetSummaryText(preset) {
        const count = preset.assignments?.length || 0;
        if (preset.mode === 'snapshot') return `snapshot · ${count} emotes / ${(preset.scope?.length || 0)} slots`;
        return `${count} assigned slot${count === 1 ? '' : 's'}`;
    }

    function renderPresetCard(preset) {
        const collapsed = isPresetCollapsed(preset.id);
        const header = h('div', {
            class: 'tep-card-head tep-preset-head',
            onclick: e => { if (!e.target.closest('button')) togglePresetCollapsed(preset.id); },
        },
            h('div', { class: 'tep-card-head-main' },
                h('button', {
                    class: 'tep-disclosure',
                    title: collapsed ? 'Expand' : 'Collapse',
                    onclick: e => { e.preventDefault(); e.stopPropagation(); togglePresetCollapsed(preset.id); },
                }, collapsed ? '▸' : '▾'),
                h('div', { class: 'tep-card-title-wrap' },
                    h('div', { class: 'tep-card-title', text: `Preset: ${preset.name}` }),
                    h('div', { class: 'tep-card-subtitle', text: presetSummaryText(preset) }),
                ),
            ),
            h('div', { class: 'tep-inline-actions tep-preset-actions' },
                h('button', {
                    class: 'tep-btn tep-run',
                    disabled: running,
                    onclick: e => {
                        e.preventDefault();
                        e.stopPropagation();
                        confirmAction({
                            tone: 'apply',
                            title: 'Apply preset?',
                            body: 'This will replace active emotes in the affected slots.',
                            confirmText: 'Apply',
                            onConfirm: () => { closeConfirm(); applyPreset(preset); },
                        });
                    },
                }, 'Apply'),
                h('button', { class: 'tep-btn', disabled: running, onclick: e => { e.preventDefault(); e.stopPropagation(); editPreset(preset); } }, 'Edit'),
                h('button', { class: 'tep-btn', disabled: running, onclick: e => { e.preventDefault(); e.stopPropagation(); duplicatePreset(preset); } }, 'Duplicate'),
                h('button', { class: 'tep-btn', disabled: running, onclick: e => { e.preventDefault(); e.stopPropagation(); exportPreset(preset); } }, 'Export'),
                h('button', {
                    class: 'tep-btn tep-danger',
                    disabled: running,
                    onclick: e => {
                        e.preventDefault();
                        e.stopPropagation();
                        confirmAction({
                            tone: 'delete',
                            title: 'Delete preset?',
                            body: 'This action cannot be undone.',
                            confirmText: 'Delete',
                            onConfirm: () => { deletePreset(preset.id); closeConfirm(); setStatus(`Deleted ${preset.name}`); },
                        });
                    },
                }, 'Delete'),
            ),
        );

        const card = h('section', { class: `tep-card tep-preset-card${collapsed ? ' tep-card-collapsed' : ''}` }, header);
        if (!collapsed) card.append(renderPresetLayout(preset.assignments || [], { editable: false }));
        return card;
    }

    function renderConfirmDialog() {
        if (!confirmDialog) return null;
        const toneClass = confirmDialog.tone === 'delete' ? 'tep-modal-danger' : 'tep-modal-apply';
        return h('div', {
            class: 'tep-modal-overlay',
            onclick: e => { if (e.target === e.currentTarget) closeConfirm(); },
        },
            h('div', { class: `tep-modal ${toneClass}` },
                h('button', { class: 'tep-modal-close', onclick: closeConfirm, title: 'Close' }, '×'),
                h('div', { class: 'tep-modal-title', text: confirmDialog.title || 'Confirm action' }),
                h('div', { class: 'tep-modal-body', text: confirmDialog.body || '' }),
                h('div', { class: 'tep-modal-actions' },
                    h('button', { class: 'tep-btn', onclick: closeConfirm }, 'Cancel'),
                    h('button', {
                        class: `tep-btn ${confirmDialog.tone === 'delete' ? 'tep-danger-fill' : 'tep-run'}`,
                        onclick: () => {
                            const action = confirmDialog.onConfirm;
                            if (typeof action === 'function') action();
                        },
                    }, confirmDialog.confirmText || 'OK'),
                ),
            ),
        );
    }

    function renderCreditCard() {
        return h('a', {
            class: 'tep-credit-banner',
            href: 'https://www.twitch.tv/elrottenkotten/about',
            target: '_blank',
            rel: 'noopener noreferrer',
            title: 'elRottenKotten on Twitch',
        },
            h('img', {
                class: 'tep-credit-banner-img',
                src: 'https://rottenkotten.github.io/twitch-emote-presets/banner.png',
                alt: 'AI output · Mimic direction · elRottenKotten',
            }),
        );
    }

    function declineDisclosure() {
        state.disclosureAccepted = false;
        state.disclosureDeclined = true;
        saveState();
        render();
    }

    function reconsiderDisclosure() {
        state.disclosureAccepted = false;
        state.disclosureDeclined = false;
        saveState();
        render();
    }

    function acceptDisclosure() {
        state.disclosureAccepted = true;
        state.disclosureDeclined = false;
        saveState();
        render();
        fetchLiveData();
    }

    function renderDisclosure() {
        return h('div', { class: 'tep-disclosure-overlay' },
            h('div', { class: 'tep-disclosure-card' },
                h('div', { class: 'tep-disclosure-title', text: 'AI Disclosure' }),
                h('p', { text: 'This userscript was written by AI under engineering direction and review by elRottenKotten.' }),
                h('p', { text: 'It interacts with Twitch internal, unsupported APIs. AI-generated code can contain bugs and Twitch can change those APIs without notice.' }),
                h('p', { text: 'If you do not want to run AI-authored code, choose Not now. No Twitch requests are sent until you explicitly accept.' }),
                h('div', { class: 'tep-disclosure-actions' },
                    h('button', { class: 'tep-btn', onclick: declineDisclosure }, 'Not now'),
                    h('button', { class: 'tep-btn tep-run', onclick: acceptDisclosure }, 'I understand and agree'),
                ),
            ),
        );
    }

    function renderDeclinedDisclosure() {
        return h('div', { class: 'tep-disclosure-overlay' },
            h('div', { class: 'tep-disclosure-card tep-declined-card' },
                h('pre', { class: 'tep-sad-cat', text: ` /\_/\
( o.o )
 > ^ <` }),
                h('div', { class: 'tep-declined-text', text: 'ну и ладно, ну и не надо.\nУдали меня что ли' }),
                h('div', { class: 'tep-disclosure-actions tep-declined-actions' },
                    h('button', { class: 'tep-btn tep-run', onclick: reconsiderDisclosure }, 'Я передумал'),
                ),
            ),
        );
    }

    function render() {
        if (!panel) return;
        closePicker();
        panel.querySelectorAll('.tep-modal-overlay,.tep-disclosure-overlay').forEach(x => x.remove());
        const body = panel.querySelector('.tep-body');
        body.replaceChildren();

        syncHeaderControls();
        syncStatusBar();

        if (!state.disclosureAccepted) {
            panel.append(state.disclosureDeclined ? renderDeclinedDisclosure() : renderDisclosure());
            return;
        }

        if (!live.loaded) {
            body.append(h('div', { class: 'tep-warning' }, 'Loading Twitch emote data…'));
        }

        body.append(h('div', { class: 'tep-list-head' },
            h('div', { class: 'tep-card-title', text: 'Presets' }),
            h('div', { class: 'tep-card-subtitle', text: state.presets.length ? `${state.presets.length} saved` : 'No presets yet' }),
        ));

        // A brand-new draft has no preset card to replace, so put it at the start.
        if (live.loaded && draftOpen && !draft.id) body.append(renderEditorSection());

        if (!state.presets.length && !draftOpen) {
            body.append(h('div', { class: 'tep-empty-presets' }, 'No presets yet. Use New preset in the title bar.'));
        } else {
            for (const preset of state.presets) {
                // Editing happens in place: the editor replaces only the preset being edited.
                if (live.loaded && draftOpen && draft.id === preset.id) body.append(renderEditorSection());
                else body.append(renderPresetCard(preset));
            }
        }

        body.append(renderCreditCard());

        const modal = renderConfirmDialog();
        if (modal) panel.append(modal);
    }

    function syncHeaderControls() {
        if (!panel) return;
        const allowed = state.disclosureAccepted === true;
        const reload = panel.querySelector('.tep-header-reload');
        const auth = panel.querySelector('.tep-header-auth');
        const newPreset = panel.querySelector('.tep-header-new');
        const delay = panel.querySelector('.tep-header-delay-input');
        if (reload) {
            reload.disabled = !allowed || running || live.loading;
            reload.textContent = live.loading ? 'Loading…' : 'Reload';
        }
        if (auth) auth.disabled = !allowed || running;
        if (newPreset) newPreset.disabled = !allowed || running || live.loading || !live.loaded;
        if (delay) delay.disabled = !allowed;
    }

    function installResizePersistence() {
        let resizing = false;
        panel.addEventListener('pointerdown', e => {
            if (state.panel.collapsed) return;
            const r = panel.getBoundingClientRect();
            resizing = e.clientX >= r.right - 20 && e.clientY >= r.bottom - 20;
        }, true);
        window.addEventListener('pointerup', () => {
            if (!resizing || !panel) return;
            resizing = false;
            const r = panel.getBoundingClientRect();
            state.panel.width = Math.max(360, Math.round(r.width));
            state.panel.height = Math.max(210, Math.round(r.height));
            saveState();
        }, true);
    }

    function installDrag(header) {
        let dragging = false;
        let startX = 0, startY = 0, startLeft = 0, startTop = 0;
        header.addEventListener('pointerdown', e => {
            if (e.button !== 0 || e.target.closest('button,input,select,a')) return;
            dragging = true;
            header.setPointerCapture(e.pointerId);
            const r = panel.getBoundingClientRect();
            startX = e.clientX; startY = e.clientY; startLeft = r.left; startTop = r.top;
            e.preventDefault();
        });
        header.addEventListener('pointermove', e => {
            if (!dragging) return;
            const left = Math.max(0, Math.min(window.innerWidth - 80, startLeft + e.clientX - startX));
            const top = Math.max(0, Math.min(window.innerHeight - 36, startTop + e.clientY - startY));
            panel.style.left = `${left}px`;
            panel.style.top = `${top}px`;
            panel.style.right = 'auto';
        });
        const finish = () => {
            if (!dragging) return;
            dragging = false;
            const r = panel.getBoundingClientRect();
            state.panel.left = r.left; state.panel.top = r.top;
            saveState();
        };
        header.addEventListener('pointerup', finish);
        header.addEventListener('pointercancel', finish);
    }

    function toggleCollapsed() {
        state.panel.collapsed = !state.panel.collapsed;
        panel.classList.toggle('tep-collapsed', state.panel.collapsed);
        panel.querySelector('.tep-collapse').textContent = state.panel.collapsed ? '▸' : '▾';
        saveState();
    }

    function injectStyle() {
        const style = document.createElement('style');
        style.textContent = `
            #tep-panel {
                position: fixed; z-index: 2147483647;
                width: 760px; max-width: calc(100vw - 16px);
                min-width: 360px; min-height: 210px; max-height: calc(100vh - 16px);
                display: flex; flex-direction: column; resize: both; overflow: hidden;
                background: #0e0e10; color: #efeff1;
                border: 1px solid #2f2f35; border-radius: 8px;
                box-shadow: 0 8px 28px rgba(0,0,0,.55);
                font: 13px/1.35 Inter, Roobert, Helvetica Neue, Helvetica, Arial, sans-serif;
                height: fit-content;
            }
            #tep-panel * { box-sizing: border-box; }
            #tep-panel.tep-collapsed { min-height: 42px; height: 42px !important; resize: none; }
            #tep-panel.tep-collapsed .tep-body, #tep-panel.tep-collapsed .tep-status-top { display: none; }

            .tep-header {
                height: 42px; min-height: 42px; display: flex; align-items: center; gap: 6px;
                padding: 0 8px 0 10px; background: #18181b;
                border-bottom: 1px solid #2f2f35; cursor: move; user-select: none;
            }
            .tep-title { flex: 1; min-width: 0; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .tep-header-actions { display: flex; align-items: center; gap: 5px; }
            .tep-header-btn, .tep-collapse, .tep-help {
                height: 28px; display: inline-grid; place-items: center; padding: 0 9px;
                border: 0; border-radius: 4px; background: #26262c; color: #efeff1;
                cursor: pointer; line-height: 1; font: 600 12px/1 Inter, Roobert, sans-serif;
                text-decoration: none;
            }
            .tep-collapse, .tep-help { width: 28px; padding: 0; font-size: 16px; }
            .tep-header-btn:hover, .tep-collapse:hover, .tep-help:hover { background: #3a3a3d; }
            .tep-header-btn:disabled { opacity: .45; cursor: default; }

            .tep-body { flex: 1 1 auto; min-height: 0; padding: 8px; overflow: auto; background: #0e0e10; }
            .tep-status-top {
                flex: 0 0 auto; min-height: 30px; padding: 4px 8px;
                display: flex; align-items: center; gap: 8px;
                border-bottom: 1px solid #2f2f35; background: #18181b; color: #adadb8;
            }
            .tep-status-top[hidden] { display: none !important; }
            .tep-status-text { min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .tep-status-top[data-kind='ok'] .tep-status-text { color: #7ee787; }
            .tep-status-top[data-kind='error'] .tep-status-text { color: #ff8280; }
            .tep-status-stop[hidden] { display: none !important; }

            .tep-inline-actions { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; }
            .tep-btn {
                min-height: 28px; display: inline-flex; align-items: center; justify-content: center;
                border: 0; border-radius: 4px; background: #2f2f35; color: #efeff1;
                padding: 5px 9px; cursor: pointer; white-space: nowrap; line-height: 1.2;
            }
            .tep-btn:hover { background: #3a3a3d; }
            .tep-btn:disabled, .tep-slot-card.tep-slot-disabled { opacity: .45; cursor: default; }
            .tep-run, .tep-save { background: #9147ff; color: #fff; }
            .tep-run:hover, .tep-save:hover { background: #772ce8; }
            .tep-danger { color: #ff8280; background: #2f2f35; }
            .tep-danger:hover { background: #3a2327; }
            .tep-danger-fill { background: #e91916; color: #fff; }
            .tep-danger-fill:hover { background: #c51613; }

            .tep-input {
                border: 2px solid #2f2f35; border-radius: 4px; background: #18181b; color: #efeff1;
                outline: none; transition: border-color .12s ease, box-shadow .12s ease;
            }
            .tep-input:hover { border-color: #53535f; }
            .tep-input:focus { border-color: #9147ff; box-shadow: 0 0 0 1px #9147ff; }
            .tep-editor-title-wrap { min-width: 120px; max-width: min(360px, 42vw); }
            .tep-editor-title-row { min-width: 0; display: flex; align-items: center; gap: 4px; }
            .tep-editor-name-input { width: min(320px, 36vw); height: 28px; padding: 4px 7px; font-size: 13px; font-weight: 700; }
            .tep-name-edit {
                flex: 0 0 24px; width: 24px; height: 24px; padding: 0; display: grid; place-items: center;
                border: 0; border-radius: 4px; background: transparent; color: #adadb8; cursor: pointer; font-size: 14px;
            }
            .tep-name-edit:hover { background: #3a3a3d; color: #efeff1; }
            .tep-header-delay { height: 28px; color: #adadb8; white-space: nowrap; display: flex; align-items: center; gap: 4px; font-size: 10px; cursor: default; }
            .tep-header-delay-input {
                width: 52px; height: 26px; border: 1px solid #2f2f35; border-radius: 4px;
                background: #0e0e10; color: #efeff1; padding: 2px 4px; outline: none; font-size: 11px;
            }
            .tep-header-delay-input:hover { border-color: #53535f; }
            .tep-header-delay-input:focus { border-color: #9147ff; box-shadow: 0 0 0 1px #9147ff; }

            .tep-warning { margin-bottom: 6px; padding: 7px 8px; border-left: 3px solid #ffd37a; background: #18181b; color: #ffd37a; border-radius: 3px; }
            .tep-muted, .tep-card-subtitle, .tep-category-count { color: #adadb8; }

            .tep-card { border: 1px solid #2f2f35; border-radius: 6px; background: #18181b; margin-bottom: 7px; overflow: hidden; }
            .tep-card-head {
                min-height: 38px; display: flex; align-items: center; justify-content: space-between; gap: 7px;
                padding: 5px 7px; background: #1f1f23; border-bottom: 1px solid #2f2f35;
            }
            .tep-card-head-main { display: flex; align-items: center; gap: 6px; min-width: 0; }
            .tep-card-title-wrap { min-width: 0; }
            .tep-card-title { font-size: 13px; line-height: 1.2; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .tep-card-subtitle { font-size: 10px; line-height: 1.2; margin-top: 1px; }
            .tep-disclosure {
                flex: 0 0 25px; width: 25px; height: 25px; padding: 0;
                display: grid; place-items: center; border: 0; border-radius: 4px;
                background: transparent; color: #efeff1; cursor: pointer; font: 16px/1 sans-serif;
            }
            .tep-disclosure:hover { background: #3a3a3d; }
            .tep-editor-card.tep-card-collapsed > :not(.tep-card-head), .tep-preset-card.tep-card-collapsed > :not(.tep-card-head) { display: none; }
            .tep-editor-actions, .tep-preset-actions { justify-content: flex-end; }

            .tep-layout { padding: 0 8px 6px; }
            .tep-category { display: grid; grid-template-columns: 96px minmax(0,1fr); gap: 8px; padding: 7px 0; border-top: 1px solid #2f2f35; }
            .tep-category:first-child { border-top: 0; }
            .tep-category-name { display: flex; align-items: baseline; gap: 4px; padding-top: 4px; }
            .tep-category-title { font-size: 12px; font-weight: 700; }
            .tep-category-count { font-size: 10px; }
            .tep-slot-grid { display: flex; flex-wrap: wrap; gap: 6px; align-items: flex-start; }
            .tep-slot-card {
                --emote-size: 56px;
                --icon-pad: 8px;
                --label-height: 16px;
                --label-gap: 4px;
                position: relative;
                width: calc(var(--emote-size) + var(--icon-pad) * 2 + 2px);
                height: calc(var(--icon-pad) + var(--emote-size) + var(--label-gap) + var(--label-height) + var(--icon-pad) );
                display: grid;
                grid-template-rows: var(--emote-size) var(--label-height);
                gap: var(--label-gap);
                align-content: start;
                padding: var(--icon-pad);
                border: 1px solid #2f2f35; border-radius: 5px; background: #1f1f23; color: #efeff1;
                text-align: center; transition: background .12s ease, border-color .12s ease; overflow: hidden;
            }
            .tep-slot-card.tep-slot-editable { cursor: pointer; }
            .tep-slot-card.tep-slot-draggable { cursor: grab; }
            .tep-slot-card.tep-slot-draggable:active { cursor: grabbing; }
            .tep-slot-card.tep-slot-editable:hover { background: #26262c; border-color: #53535f; }
            .tep-slot-card.tep-dragging { opacity: .35; transform: scale(.97); }
            .tep-slot-card.tep-drop-target { border-color: #9147ff !important; box-shadow: inset 0 0 0 1px #9147ff, 0 0 0 1px rgba(145,71,255,.25); background: #26262c; }
            .tep-slot-card.tep-slot-empty { border-style: dashed; color: #adadb8; }
            .tep-slot-card.tep-slot-warning { border-color: #ffd37a; box-shadow: inset 0 0 0 1px rgba(255,211,122,.18); }

            .tep-slot-visual {
                width: var(--emote-size); height: var(--emote-size);
                display: grid; place-items: center;
            }
            .tep-slot-visual img { width: var(--emote-size); height: var(--emote-size); object-fit: contain; }

            /* Empty state: center + against the whole slot, not only the image row. */
            .tep-slot-empty .tep-slot-plus {
                position: absolute; inset: 0;
                display: grid; place-items: center;
                font-size: 24px; line-height: 1; color: #adadb8;
                pointer-events: none;
            }

            /* Slot number, token and warning share one line. */
            .tep-slot-label {
                min-width: 0; height: var(--label-height);
                display: flex; align-items: center; justify-content: center; gap: 3px;
                line-height: var(--label-height); font-size: 11px; font-weight: 600;
                white-space: nowrap;
            }
            .tep-slot-number { flex: 0 0 auto; color: #adadb8; font-size: 9px; font-weight: 500; }
            .tep-slot-token { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
            .tep-slot-warning .tep-slot-label, .tep-slot-warning .tep-slot-number { color: #ffd37a; }
            .tep-slot-warning-icon { flex: 0 0 auto; font-size: 10px; line-height: 1; }

            .tep-slot-clear {
                position: absolute; right: 4px; top: 4px; width: 18px; height: 18px; padding: 0;
                display: grid; place-items: center; border: 0; border-radius: 3px; background: #2f2f35; color: #ff8280; cursor: pointer;
            }
            .tep-slot-clear:hover { background: #3a3a3d; }

            .tep-editor-footer { display: flex; align-items: center; justify-content: space-between; gap: 7px; padding: 0 8px 7px; flex-wrap: wrap; }
            .tep-list-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; padding: 2px 1px 5px; }
            .tep-empty-presets { padding: 14px; border: 1px dashed #2f2f35; border-radius: 5px; color: #adadb8; text-align: center; background: #18181b; }

            .tep-credit-banner { height: 64px;     display: flex;     align-items: center;     justify-content: center;
                margin-top: 7px;
                overflow: hidden; background: #0e0e10; line-height: 0; cursor: pointer;
                transition: border-color .12s ease, opacity .12s ease;
            }
            .tep-credit-banner-img:hover { border-color: #53535f; opacity: .94; }
            .tep-credit-banner-img {  border: 1px solid #2f2f35; border-radius: 6px; height: 64px;
    max-width: 100%;
    width: auto;
    object-fit: contain;
    display: block; }

            .tep-disclosure-overlay {
                position: absolute; inset: 42px 0 0; z-index: 60; display: grid; place-items: center;
                padding: 18px; background: rgba(14,14,16,.94); backdrop-filter: blur(4px);
            }
            .tep-disclosure-card {
                width: min(500px, 100%); padding: 18px; border: 1px solid #3a3a3d; border-radius: 8px;
                background: #18181b; box-shadow: 0 12px 36px rgba(0,0,0,.65);
            }
            .tep-disclosure-title { margin-bottom: 10px; font-size: 18px; font-weight: 700; }
            .tep-disclosure-card p { margin: 8px 0; color: #c7c7cc; line-height: 1.45; }
            .tep-disclosure-actions { margin-top: 16px; display: flex; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
            .tep-declined-card { text-align: center; }
            .tep-sad-cat {
                margin: 2px auto 14px; width: max-content; color: #adadb8; background: transparent;
                font: 700 20px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre;
            }
            .tep-declined-text { color: #c7c7cc; white-space: pre-line; line-height: 1.45; }
            .tep-declined-actions { justify-content: center; }

            .tep-picker-popup { position: absolute; z-index: 10; max-height: 310px; padding: 6px; background: #18181b; border: 1px solid #3a3a3d; border-radius: 6px; box-shadow: 0 8px 24px rgba(0,0,0,.6); }
            .tep-picker-search { width: 100%; height: 30px; padding: 5px 8px; margin-bottom: 6px; }
            .tep-picker-grid { max-height: 255px; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(42px, 1fr)); gap: 4px; align-content: start; }
            .tep-picker-tile { position: relative; aspect-ratio: 1; min-width: 0; display: grid; place-items: center; border: 1px solid transparent; border-radius: 4px; padding: 3px; background: transparent; color: #efeff1; cursor: pointer; transition: background .12s ease, border-color .12s ease; }
            .tep-picker-tile:hover { background: #26262c; border-color: #3a3a3d; }
            .tep-picker-tile img { width: 34px; height: 34px; max-width: 100%; max-height: 100%; object-fit: contain; }
            .tep-picker-tile-badge { position: absolute; top: 1px; right: 2px; font-size: 8px; line-height: 1; color: #bf94ff; font-weight: 700; }
            .tep-picker-tile-state { position: absolute; left: 2px; bottom: 1px; font-size: 7px; line-height: 1; color: #adadb8; background: rgba(14,14,16,.82); border-radius: 2px; padding: 1px 2px; }
            .tep-picker-empty { grid-column: 1 / -1; padding: 14px 8px; text-align: center; }

            .tep-modal-overlay { position: absolute; inset: 0; display: grid; place-items: center; padding: 16px; background: rgba(0,0,0,.68); z-index: 40; }
            .tep-modal { position: relative; width: min(370px,100%); padding: 18px; border-radius: 8px; border: 1px solid #3a3a3d; background: #18181b; box-shadow: 0 10px 30px rgba(0,0,0,.65); }
            .tep-modal-title { font-size: 18px; font-weight: 700; text-align: center; margin: 10px 0 7px; }
            .tep-modal-body { color: #adadb8; text-align: center; margin-bottom: 14px; }
            .tep-modal-actions { display: flex; justify-content: center; align-items: stretch; gap: 7px; }
            .tep-modal-actions .tep-btn { min-width: 110px; min-height: 32px; display: flex; align-items: center; justify-content: center; text-align: center; }
            .tep-modal-close { position: absolute; right: 7px; top: 7px; width: 25px; height: 25px; padding: 0; display: grid; place-items: center; border: 0; border-radius: 4px; background: transparent; color: #adadb8; cursor: pointer; font-size: 17px; line-height: 1; }
            .tep-modal-close:hover { background: #26262c; color: #efeff1; }

            @media (max-width: 520px) {
                .tep-category { grid-template-columns: 1fr; gap: 4px; }
                .tep-category-name { padding-top: 0; }
                .tep-card-head { align-items: flex-start; }
                .tep-preset-actions, .tep-editor-actions { max-width: 55%; }
            }
        `;
        document.head.append(style);
    }

    function isEmotesPage() {
        return /^\/u\/[^/]+\/viewer-rewards\/emotes\/?$/.test(location.pathname);
    }

    let wasOnEmotesPage = false;

    function syncRoute() {
        if (!panel) return;
        const onEmotesPage = isEmotesPage();
        const enteredEmotesPage = onEmotesPage && !wasOnEmotesPage;
        wasOnEmotesPage = onEmotesPage;

        panel.style.display = onEmotesPage ? '' : 'none';

        if (enteredEmotesPage && state.disclosureAccepted && !live.loading) {
            fetchLiveData();
        }
    }

    function installRouteWatcher() {
        const routeChanged = () => queueMicrotask(syncRoute);

        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function (...args) {
                const result = original.apply(this, args);
                routeChanged();
                return result;
            };
        }

        window.addEventListener('popstate', routeChanged);
    }

    function mount() {
        if (document.querySelector('#tep-panel')) return;
        injectStyle();
        panel = h('div', { id: 'tep-panel' });
        const header = h('div', { class: 'tep-header' },
            h('button', { class: 'tep-collapse', title: 'Collapse panel', onclick: toggleCollapsed }, state.panel.collapsed ? '▸' : '▾'),
            h('div', { class: 'tep-title', text: 'Twitch Emote Presets · v0.8.9' }),
            h('div', { class: 'tep-header-actions' },
                h('label', { class: 'tep-header-delay', title: 'Delay between Twitch mutations' },
                    h('span', { text: 'Delay' }),
                    h('input', {
                        class: 'tep-header-delay-input',
                        type: 'number', min: '100', step: '100', value: String(state.delayMs),
                        onchange: e => {
                            state.delayMs = Math.max(100, Number(e.target.value) || DEFAULT_DELAY_MS);
                            e.target.value = String(state.delayMs);
                            saveState();
                        },
                    }),
                    h('span', { text: 'ms' }),
                ),
                h('button', { class: 'tep-header-btn tep-header-new', title: 'Create preset', onclick: newPresetDraft }, 'New preset'),
                h('button', { class: 'tep-header-btn tep-header-reload', title: 'Reload emote data', onclick: () => fetchLiveData() }, 'Reload'),
                h('button', { class: 'tep-header-btn tep-header-auth', title: 'Test Twitch auth / integrity', onclick: testAuth }, 'Auth'),
                h('a', {
                    class: 'tep-help', href: 'https://rottenkotten.github.io/twitch-emote-presets/',
                    target: '_blank', rel: 'noopener noreferrer', title: 'Help', 'aria-label': 'Help',
                }, '?'),
            ),
        );
        header.addEventListener('dblclick', e => { if (!e.target.closest('button,a')) toggleCollapsed(); });
        statusEl = h('div', { class: 'tep-status-text' });
        statusStopEl = h('button', {
            class: 'tep-btn tep-danger tep-status-stop',
            hidden: true,
            onclick: () => { stopRequested = true; setStatus('Stopping…'); },
        }, 'Stop');
        statusBarEl = h('div', { class: 'tep-status-top', hidden: true }, statusEl, statusStopEl);
        panel.append(header, statusBarEl, h('div', { class: 'tep-body' }));
        document.body.append(panel);

        if (state.panel.width) panel.style.width = `${Math.max(360, state.panel.width)}px`;
        if (state.panel.height) panel.style.height = `${Math.max(210, state.panel.height)}px`;

        if (state.panel.left != null) {
            panel.style.left = `${state.panel.left}px`;
            panel.style.top = `${state.panel.top}px`;
        } else {
            panel.style.right = '8px';
            panel.style.top = `${state.panel.top}px`;
        }
        panel.classList.toggle('tep-collapsed', state.panel.collapsed);
        installDrag(header);
        installResizePersistence();
        render();
        installRouteWatcher();
        syncRoute();

        document.addEventListener('pointerdown', e => {
            if (pickerPopup && !pickerPopup.contains(e.target) && !e.target.closest('.tep-slot-card')) closePicker();
        }, true);
    }

    console.log(LOG, 'v0.8.9 boot', { href: location.href, sandbox: 'raw' });
    // Styles, panel, route watcher and UI listeners require a ready document.
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true });
    else mount();
})();
