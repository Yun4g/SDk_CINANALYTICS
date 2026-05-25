(function () {
    'use strict';

    const script = document.getElementById("featureTrackSDK");
    const project_key = script?.getAttribute('data-proj-key');
    const customEndpoint = script?.getAttribute('data-endpoint');

    const ENDPOINT = customEndpoint || 'https://cinanalytics-backend.onrender.com/api';
    const HEARTBEAT_INTERVAL = 30000;
    const FLUSH_INTERVAL = 5000;
    const MAX_QUEUE = 20;

    const favicon = document.querySelector("link[rel~='icon']");
    const icon = favicon?.href;
    const projectName = window.document.title;

    let init = false;
    const projectKey = project_key || localStorage.getItem('_vnow_project_key');
    if (!projectKey) {
        console.error('[FeatureTracker] Error: project_key is required. Please add it as a data attribute to the script tag.');
        return;
    }
    async function VerifySdk() {
        if (init) return;
        try {
            const response = await fetch(`${ENDPOINT}/project/verify-project`, {
                method: "POST",
                headers: { "Content-type": "application/json" },
                body: JSON.stringify({ projectKey, projectIcon: icon, projectName }),
                credentials: "include"
            });

            if (!response.ok) return false;
            const data = await response.json();
            if (data.status === "success") init = true;
            return data.status === "success";
        } catch (error) {
            console.error("[FeatureTracker] sdkInitialised error:", error);
            return false;
        }
    }

    VerifySdk();

    //Session / Visitor ID 
    function uid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            const r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
    }

    let visitorId = localStorage.getItem('_vnow_vid');
    if (!visitorId) { visitorId = uid(); localStorage.setItem('_vnow_vid', visitorId); }

  
    const sessionId = sessionStorage.getItem('_vnow_sid') || uid();

    sessionStorage.setItem('_vnow_sid', sessionId);
    const sessionStart = Date.now();

    const nav = window.navigator;

    //  Environment browser
    function getEnv() {
        const ua = nav.userAgent;

        let browser = 'Other';
        if (/Edg\//.test(ua)) browser = 'Edge';
        else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
        else if (/Chrome\//.test(ua)) browser = 'Chrome';
        else if (/Safari\//.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
        else if (/Firefox\//.test(ua)) browser = 'Firefox';


        const uaIsMobile = /Mobi|Android|iPhone|iPad/.test(ua);
        const screenIsMobile = window.screen.width <= 768;
        const device = (uaIsMobile && screenIsMobile) ? 'Mobile' : 'Desktop';


        let os = 'Other';

        if (/Windows NT/.test(ua)) {
            os = 'Windows';
        } else if (/iPhone|iPad/.test(ua)) {
            os = 'iOS';
        } else if (/Android/.test(ua) && device === 'Mobile') {
            os = 'Android';
        } else if (/Android/.test(ua) && device === 'Desktop') {

            if (/Mac OS X/.test(ua)) os = 'macOS';
            else os = 'Windows';
        } else if (/Mac OS X/.test(ua)) {
            os = 'macOS';
        } else if (/Linux/.test(ua)) {
            os = 'Linux';
        }

        return {
            browser, os, device,
            screen: `${window.screen.width}x${window.screen.height}`,
            language: nav.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            referrer: document.referrer || null,
        };
    }

    const env = getEnv();

    if (nav.brave?.isBrave) {
        nav.brave.isBrave().then(isBrave => {
            if (isBrave) env.browser = 'Brave';
        });
    }

    //  Event Queue & Flush
    let queue = [];

    function push(type, data = {}) {
        const event = {
            project_key,                   
            visitor_id: visitorId,         
            session_id: sessionId, type,
            url: location.href,
            path: location.pathname,
            title: document.title,
            timestamp: Date.now(),
            ...env,
            ...data,
        };
        queue.push(event);
        console.log(' queued event:', event);
        if (queue.length >= MAX_QUEUE) flush();
    }

    function flush() {
        if (!queue.length) return;
        const batch = queue.splice(0);
        const payload = JSON.stringify({ eventData: batch });
        if (nav.sendBeacon) {
            nav.sendBeacon(`${ENDPOINT}/events`, new Blob([payload], { type: 'application/json' }));
        } else {
            fetch(`${ENDPOINT}/events`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
                keepalive: true,
            }).catch(() => { });
        }
    }

    setInterval(flush, FLUSH_INTERVAL);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flush();
    });

    //  Geolocation 
    // Replace your current captureLocation() with this:
async function captureLocation() {
    try {
  
        const ipRes = await fetch('http://ip-api.com/json');
        const ipData = await ipRes.json();

        if (ipData.status === 'success') {
            push('location', {
                country: ipData.country,
                country_code: ipData.countryCode,
                city: ipData.city,
                region: ipData.regionName,
                isp: ipData.isp,
                source: 'ip',
            });
        }

        
        if (!nav.geolocation) return;
        nav.geolocation.getCurrentPosition(
            async (pos) => {
                const lat = pos.coords.latitude;
                const lng = pos.coords.longitude;

              
                const geoRes = await fetch(
                    `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`
                );
                const geoData = await geoRes.json();

                push('location', {
                    lat,
                    lng,
                    accuracy: pos.coords.accuracy,
                    country: geoData.countryName,
                    country_code: geoData.countryCode,
                    city: geoData.city,
                    region: geoData.principalSubdivision,
                    source: 'gps',
                });
            },
            () => { }, // silently fail if user denies GPS
            { timeout: 5000, maximumAge: 60000 }
        );

    } catch (err) {
        // Location is non-critical — never crash the SDK over it
    }
}
    captureLocation();

    // Page View 
    push('page_view');

    let lastPath = location.pathname;
    const _pushState = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);

    history.pushState = function (...args) {
        _pushState(...args);
        if (location.pathname !== lastPath) { lastPath = location.pathname; push('page_view'); }
    };
    history.replaceState = function (...args) {
        _replaceState(...args);
        if (location.pathname !== lastPath) { lastPath = location.pathname; push('page_view'); }
    };
    window.addEventListener('popstate', () => {
        if (location.pathname !== lastPath) { lastPath = location.pathname; push('page_view'); }
    });

    window.addEventListener('beforeunload', () => {
        push('session_end', { duration: Date.now() - sessionStart });
        flush();
    });

    // Heartbeat 
    let isActive = true;
    ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'].forEach(e =>
        document.addEventListener(e, () => { isActive = true; }, { passive: true })
    );
    setInterval(() => {
        if (isActive) {
            push('heartbeat', { duration: Date.now() - sessionStart });
            isActive = false;
        }
    }, HEARTBEAT_INTERVAL);


    // CSS Selector Fingerprint 
    // Builds a stable 4-level CSS path that survives re-renders.
    // Stops early if it hits an ID (globally unique).
    function getCSSFingerprint(el) {
        const parts = [];
        let node = el;
        let depth = 0;

        while (node && node !== document.body && depth < 4) {
            let part = node.tagName.toLowerCase();

            if (node.id) {
                parts.unshift(`#${node.id}`);
                break;
            }

            // Only keep classes that describe structure, not state
            const stableClasses = [...node.classList]
                .filter(c => !/^(active|hover|focus|selected|open|closed|visible|hidden|loading|disabled|is-|has-)/.test(c))
                .slice(0, 2);

            if (stableClasses.length) part += '.' + stableClasses.join('.');

            parts.unshift(part);
            node = node.parentElement;
            depth++;
        }

        return parts.join(' > ') || null;
    }


    // NEW: Stable Feature Key (hashed from fingerprint) 
    // Same element always produces the same key — no matter the session.
    // Sent to backend so it can group events under one feature identity.
    function getFeatureKey(fingerprint, path) {
        if (!fingerprint) return null;
        const raw = `${projectKey}|${path}|${fingerprint}`;
        // djb2 hash — fast, no crypto needed
        let hash = 5381;
        for (let i = 0; i < raw.length; i++) {
            hash = ((hash << 5) + hash) + raw.charCodeAt(i);
            hash |= 0; // force 32-bit int
        }
        return 'feat_' + Math.abs(hash).toString(16).padStart(12, '0');
    }


    // ─── A11y Label 
    function getA11yLabel(el) {
        return (
            el.getAttribute('aria-label') ||
            (el.getAttribute('aria-labelledby') &&
                document.getElementById(el.getAttribute('aria-labelledby'))?.textContent?.trim()) ||
            (el.getAttribute('aria-describedby') &&
                document.getElementById(el.getAttribute('aria-describedby'))?.textContent?.trim()) ||
            el.getAttribute('title') ||
            el.getAttribute('alt') ||
            el.getAttribute('placeholder') ||
            el.getAttribute('name') ||
            null
        );
    }



    // Collects everything the backend needs to enrich and name a feature.
    // Separates raw signal (fingerprint, ariaLabel) from resolved display name.
    function getElementContext(el) {
        const fingerprint = getCSSFingerprint(el);
        const feature_key = getFeatureKey(fingerprint, location.pathname);
        const a11yLabel = getA11yLabel(el);
        const innerText = el.textContent?.trim()
            .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
            .trim()
            .slice(0, 100) || null;

        const container = el.parentElement;


        return {
            feature_key,
            container_selector_fingerprint: fingerprint,

            aria_label: a11yLabel,
            inner_text: innerText,
            role: el.getAttribute('role') || null,
            name: el.getAttribute('name') || null,

            container_tag: container?.tagName?.toLowerCase() || null,
            container_id: container?.id || null,
            container_classes: container?.className || null,

            tag: el.tagName.toLowerCase(),
            element_id: el.id || null,
            classes: el.className || null,
            href: el.getAttribute('href') || null,
        };
    }


    // 
    function getMeaningfulText(el) {
        const label = getA11yLabel(el);
        if (label) return label;

        const text = el.textContent?.trim()
            .replace(/[ --	-]/g, '')
            .replace(/[ -]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
        if (text) return text;

        const title = el.getAttribute('title');
        if (title) return title;

        const dataLabel = el.getAttribute('data-track') || el.getAttribute('data-feature');
        if (dataLabel) return dataLabel;

        if (el.tagName.toLowerCase() === 'button') {
            const svg = el.querySelector('svg');
            if (svg) return 'button click';
            return 'button click';
        }

        if (el.tagName.toLowerCase() === 'a') return 'link click';

        return null;
    }

    function resolveFeatureName(el, context) {
        const handlerName = getRingHandlerName(el);

        // Priority 1: a11y label + handler
        if (context.aria_label && handlerName) return `${context.aria_label} – ${handlerName}`;
        if (context.aria_label) return context.aria_label;

        // Priority 2: visible text + handler
        const text = context.inner_text;
        if (text && handlerName) return `${text} – ${handlerName}`;
        if (text) return text;

        // Priority 3: handler alone
        if (handlerName) return handlerName;

        // Priority 4: data attributes
        const dataLabel = el.getAttribute('data-track') || el.getAttribute('data-feature');
        if (dataLabel) return dataLabel;

        return null;
    }


    //  Framework Handler Detection 
    function getRingHandlerName(el) {
        // React fiber
        const fiberKey = Object.keys(el).find(k =>
            k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
        );
        if (fiberKey) {
            let fiber = el[fiberKey];
            while (fiber) {
                const props = fiber.memoizedProps || fiber.pendingProps;
                if (props) {
                    const handler = props.onClick || props.onMouseDown || props.onPointerDown;
                    if (typeof handler === 'function' && handler.name &&
                        handler.name !== 'bound ' && handler.name !== 'onClick') {
                        return camelToWords(handler.name);
                    }
                    if (typeof handler === 'function') {
                        const eventKey = props.onClick ? 'click' :
                            props.onMouseDown ? 'mouse down' :
                            props.onPointerDown ? 'pointer down' :
                            'click';
                        const descriptor = getA11yLabel(el) || el.textContent?.trim().slice(0, 100) || el.id || el.tagName.toLowerCase();
                        const cleanDescriptor = descriptor?.replace(/\s+/g, ' ').trim();

                        if (fiber.type?.displayName || fiber.type?.name) {
                            const comp = fiber.type.displayName || fiber.type.name;
                            if (comp && comp !== 'div' && comp !== 'span') {
                                return `${eventKey} handler for ${cleanDescriptor} in ${comp}`;
                            }
                        }

                        return `${eventKey} handler for ${cleanDescriptor}`;
                    }
                    if (fiber.type?.displayName || fiber.type?.name) {
                        const comp = fiber.type.displayName || fiber.type.name;
                        if (comp && comp !== 'div' && comp !== 'span' && props.onClick?.name) {
                            return `${camelToWords(props.onClick.name)} in ${comp}`;
                        }
                    }
                }
                fiber = fiber.return;
            }
        }

        // Vue 3
        const vue = el.__vueParentComponent;
        if (vue) {
            const vnodeProps = vue.vnode?.props || {};
            const handler = vnodeProps.onClick || vnodeProps['onUpdate:modelValue'];
            if (typeof handler === 'function' && handler.name) return camelToWords(handler.name);
            if (vue.type?.name || vue.type?.__name) return camelToWords(vue.type.name || vue.type.__name);
        }

        // Angular
        const ng = el.__ngContext;
        if (ng && Array.isArray(ng)) {
            const dir = ng.find(x => x?.constructor?.name &&
                x.constructor.name !== 'Object' && x.constructor.name !== 'Array');
            if (dir?.constructor?.name) return camelToWords(dir.constructor.name);
        }

        // Raw onclick
        const raw = el.onclick || el.onmousedown || el.onpointerdown;
        if (typeof raw === 'function') {
            if (raw.name && raw.name !== 'onclick' && raw.name !== '') return camelToWords(raw.name);
            const attr = el.getAttribute('onclick');
            if (attr) {
                const match = attr.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
                if (match) return camelToWords(match[1]);
            }
            if (el.id) return camelToWords(el.id);
            return 'click handler';
        }

        // HTML attribute onclick
        const attrOnclick = el.getAttribute('onclick');
        if (attrOnclick) {
            const match = attrOnclick.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)/);
            return match ? camelToWords(match[1]) : 'click handler';
        }

        // jQuery
        try {
            const jq = window.jQuery || window.$;
            if (jq) {
                const events = jq._data?.(el, 'events') || jq(el).data('events');
                const clickHandlers = events?.click;
                if (clickHandlers?.length) {
                    const name = clickHandlers[0].handler?.name;
                    if (name) return camelToWords(name);
                }
            }
        } catch (_) { }

        return null;
    }

    function camelToWords(name) {
        return name
            .replace(/^(handle|on|_+)/i, '')
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .toLowerCase()
            .trim();
    }

    function isNavigationFnString(fnStr) {
        return /(?:navigate|window\.location|document\.location|location\.href|location\.pathname|location\.assign|location\.replace|router\.(?:push|replace|go)|history\.(?:push|replace)|useNavigate|\$router\.(?:push|replace|go)|this\.router\.navigate)\b/.test(fnStr);
    }

    function isNavigationClick(el) {

  
    const href = el.getAttribute('href');
    if (href && !href.startsWith('#') && !href.startsWith('javascript')) return true;

  
    const parentAnchor = el.closest('a');
    if (parentAnchor) {
        const parentHref = parentAnchor.getAttribute('href');
        if (parentHref && !parentHref.startsWith('#') && !parentHref.startsWith('javascript')) return true;
    }


    const fiberKey = Object.keys(el).find(k =>
        k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );
    if (fiberKey) {
        let fiber = el[fiberKey];
        while (fiber) {
            const props = fiber.memoizedProps || fiber.pendingProps;
            if (props?.onClick && typeof props.onClick === 'function') {
                const fnStr = props.onClick.toString();
                if (isNavigationFnString(fnStr)) return true;
            }
            fiber = fiber.return;
        }
    }

  
    const vue = el.__vueParentComponent;
    if (vue) {
        const vnodeProps = vue.vnode?.props || {};
        const handler = vnodeProps.onClick;
        if (typeof handler === 'function') {
            const fnStr = handler.toString();
            if (isNavigationFnString(fnStr)) return true;
        }
    }

    if (el.getAttribute('data-navigate') || el.getAttribute('data-route')) return true;

    return false;
}
    //  Click Tracking 
document.addEventListener('click', function (e) {

    //  Always find the real interactive element 
    // Click target might be svg, path, img, span insde a button
    // closest() walks up the DOM to find the actual button
    const el = e.target.closest(
        '[data-track],' +
        'button,' +
        '[role="button"],' +
        'input[type="button"],' +
        'input[type="submit"]'
    );


    if (!el) return;
    if (isNavigationClick(el)) return;

    const urlBefore = location.href;

    setTimeout(() => {
        // URL changed or navigation click, discard
        if (location.href !== urlBefore) return;

        const context = getElementContext(el);
        const feature_name = getMeaningfulText(el) || resolveFeatureName(el, context);

        if (!feature_name && !context.feature_key) return;

        push('feature_click', {
            ...context,
            feature_name,
        });

    }, 150);

}, true);


    //  Input Tracking 
    document.addEventListener('input', (e) => {
        const target = e.target;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            push('input_change', {
                tag: target.name,
                inputValue: target.value,
                placeholder: target.placeholder,
            });
        }
    });


    // Scroll Depth 
    let maxScroll = 0;
    window.addEventListener('scroll', function () {
        const scrolled = Math.round(
            (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100
        );
        if (scrolled > maxScroll) {
            maxScroll = scrolled;
            if (maxScroll % 25 === 0) push('scroll_depth', { depth: maxScroll });
        }
    }, { passive: true });


    //  Engagement Time
    let engageStart = Date.now();
    let totalEngaged = 0;
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            totalEngaged += Date.now() - engageStart;
        } else {
            engageStart = Date.now();
        }
    });


    // ─── Public API 
    window.vnow = {
        track(eventName, props = {}) { push('custom', { eventName, ...props }); },
        identify(userId, traits = {}) {
            push('identify', { userId, traits });
            localStorage.setItem('_vnow_uid', userId);
        },
        flush,
    };

    console.log('[visitors.now] SDK loaded ✓ project_key:', project_key.slice(0, 8) + '...');
})();