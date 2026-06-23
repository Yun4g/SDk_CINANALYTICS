(function () {
    'use strict';

    const script = document.getElementById("featureTrackSDK");
    const project_key = script?.getAttribute('data-proj-key');
    const customEndpoint = script?.getAttribute('data-endpoint');

    const ENDPOINT = customEndpoint || 'https://cinanalytics-backend-10qi.onrender.com/api';

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

    function getRoutePath() {
        return location.pathname + (location.hash || '');
    }
    async function VerifySdk() {
        if (init) return true;
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

    VerifySdk().then(verified => {
        if (verified) {
            lastRoute = getRoutePath();
            captureLocation();
            push('page_view', { hash: location.hash || null });
        }
    });


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
        const routePath = getRoutePath();
        const event = {
            project_key,
            visitor_id: visitorId,
            session_id: sessionId, type,
            url: location.href,
            path: routePath,
            page_name: routePath,
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

            const ipRes = await fetch('https://ipapi.co/json');
            const ipData = await ipRes.json();

            if (ipData.city) {
                push('location', {
                    country: ipData.country_name,
                    country_code: ipData.country_code,
                    city: ipData.city,
                    region: ipData.region,
                    isp: ipData.org,
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




    let lastPath = location.pathname;
    let lastHash = location.hash;
    let lastRoute = '';


    const _pushState = history.pushState.bind(history);
    const _replaceState = history.replaceState.bind(history);









    history.pushState = function (...args) {
        _pushState(...args);
        const route = getRoutePath();
        if (route !== lastRoute && init) {
            lastRoute = route;
            push('page_view', { hash: location.hash || null });
        }
    };

    history.replaceState = function (...args) {
        _replaceState(...args);
        const route = getRoutePath();
        if (route !== lastRoute && init) {
            lastRoute = route;
            push('page_view', { hash: location.hash || null });
        }
    };

    window.addEventListener('popstate', () => {
        const route = getRoutePath();
        if (route !== lastRoute && init) {
            lastRoute = route;
            push('page_view', { hash: location.hash || null });
        }
    });

    window.addEventListener('hashchange', () => {
        const route = getRoutePath();
        if (route !== lastRoute && init) {
            lastRoute = route;
            push('page_view', { hash: location.hash || null });
        }
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
        const feature_key = getFeatureKey(fingerprint, getRoutePath());
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


    function looksLikeUserContent(text) {
        // Too long = probably user-generated content, not a feature label
        if (text.length > 40) return true;

        // Matches ANY emoji, symbol, or pictograph using Unicode ranges
        if (/[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27BF}|\u{2300}-\u{23FF}|\u{2B00}-\u{2BFF}|\u{FE00}-\u{FEFF}|\u{1F900}-\u{1F9FF}|\u{1FA00}-\u{1FA9F}|\u{E000}-\u{F8FF}]/u.test(text)) return true;

        // Email addresses (user profile text leaking in)
        if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text)) return true;

        // Phone numbers (various formats)
        if (/(\+?\d[\d\s\-().]{7,}\d)/.test(text)) return true;

        // URLs
        if (/https?:\/\/|www\./i.test(text)) return true;

        // Looks like a WhatsApp group ID or any numeric ID
        if (/\d{10,}/.test(text)) return true;

        // Contains line breaks (multi-line = user-written description)
        if (/[\r\n]/.test(text)) return true;

        // Multiple sentences (user-written bio/description)
        if ((text.match(/[.!?]/g) || []).length >= 2) return true;

        // Starts with a number (group names like "4 Guys" or "3rd class 2020")
        // but allow things like "2FA" or "3D" which are real feature names
        if (/^\d+\s+[a-z]/i.test(text)) return true;

        // All caps and long (usually a group name or announcement)
        if (text === text.toUpperCase() && text.length > 15 && /[A-Z]/.test(text)) return true;

        // Excessive punctuation or special chars (chat group descriptions)
        if ((text.match(/[!*_~`|\\]/g) || []).length >= 2) return true;

        // Foreign scripts mixed with latin (usually user names — optional, be careful)
        // if (/[\u0600-\u06FF\u0900-\u097F\u4E00-\u9FFF]/.test(text)) return true;

        return false;
    }


    // 
    function getMeaningfulText(el) {
        // 1. aria-label or similar attributes
        const label = getA11yLabel(el);
        if (label) return label;

        // 2. Visible text on the element itself
        const text = el.textContent?.trim()
            .replace(/[\u{1F300}-\u{1FFFF}]/gu, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 100);
        if (text) return text;

        // 3. data attributes
        const dataLabel = el.getAttribute('data-track') || el.getAttribute('data-feature');
        if (dataLabel) return dataLabel;

        // 4. Icon-only button — build name from surrounding context
        if (el.tagName.toLowerCase() === 'button' || el.getAttribute('role') === 'button') {

            // Try SVG title first
            const svg = el.querySelector('svg');
            if (svg) {
                const svgTitle = svg.querySelector('title')?.textContent?.trim();
                if (svgTitle) return svgTitle;
                const svgAriaLabel = svg.getAttribute('aria-label');
                if (svgAriaLabel) return svgAriaLabel;
            }

            // Try nearby label or heading in the same container
            const container = el.closest('li, tr, td, article, section, [class*="card"], [class*="item"], [class*="row"]');
            if (container) {
                const nearbyText = container.querySelector('h1, h2, h3, h4, h5, h6, label, [class*="name"], [class*="title"]')
                    ?.textContent?.trim()
                    .replace(/\s+/g, ' ')
                    .slice(0, 60);
                if (nearbyText && !looksLikeUserContent(nearbyText)) return `${nearbyText} button`;
            }

            // Try previous sibling text
            const prevSibling = el.previousElementSibling;
            const prevText = prevSibling?.textContent?.trim().slice(0, 60);
            if (prevSibling?.textContent?.trim() && !looksLikeUserContent(prevText)) {
                return `${prevSibling.textContent.trim().slice(0, 60)} button`;
            }

            // Try parent's text content excluding this button's text
            const parentText = el.parentElement?.childNodes;
            if (parentText) {
                const siblingText = [...parentText]
                    .filter(n => n !== el && n.nodeType === Node.TEXT_NODE)
                    .map(n => n.textContent.trim())
                    .filter(Boolean)
                    .join(' ')
                    .slice(0, 60);
                if (siblingText && !looksLikeUserContent(siblingText)) return `${siblingText} button`;
            }

            // Last resort: use class name to infer purpose
            const classes = el.className?.toString() || '';
            // Add these patterns to the blocklist
            const JUNK_CLASS_PATTERN = /^(btn|button|icon|svg|w-|h-|p-|m-|gap-|flex|grid|bg-|text-|rounded|border|cursor|opacity|absolute|relative|fixed|sticky|inset|z-|overflow|block|inline|hidden|space-|ring-|shadow|transition|duration|ease|translate|rotate|scale|transform|pointer|select|outline|sr-|not-|group|peer|hover|focus|active|disabled|dark|sm:|md:|lg:|xl:|container|max-|min-|aspect|object|from-|to-|via-)/;
            const meaningfulClass = classes
                .split(/\s+/)
                .find(c => !JUNK_CLASS_PATTERN.test(c) && c.length > 3);
            if (meaningfulClass) return meaningfulClass.replace(/[-_]/g, ' ').trim();

            return null; // let resolveFeatureName try
        }

        if (el.tagName.toLowerCase() === 'a') return null;

        return null;
    }

    function resolveFeatureName(el, context) {
        const handlerName = getRingHandlerName(el);

        // Filter out useless handler names
        const uselessNames = ['bound pp', 'click handler', 'pp', 'bound '];
        const cleanHandler = handlerName && !uselessNames.some(n => handlerName.includes(n))
            ? handlerName
            : null;

        if (context.aria_label && cleanHandler) return `${context.aria_label} – ${cleanHandler}`;
        if (context.aria_label) return context.aria_label;

        const text = context.inner_text;
        if (text && cleanHandler) return `${text} – ${cleanHandler}`;
        if (text) return text;

        if (cleanHandler) return cleanHandler;

        const dataLabel = el.getAttribute('data-track') || el.getAttribute('data-feature') || el.getAttribute('data-project-key');
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
        return /(?:navigate|window\.location|document\.location|location\.href|location\.pathname|location\.assign|location\.replace|router\.(?:push|replace|go)|history\.(?:push|replace)|useNavigate|\$router\.(?:push|replace|go)|this\.router\.navigate)\b/.test(fnStr);
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

    // --- Instrumentation: record added event listeners and tag dynamic elements 
    // Store listeners so we can identify attached handlers later (works when functions are added via addEventListener or jQuery.on)
    const __listenerStore = new WeakMap();

    const __origAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, handler, options) {
        try {
            if (typeof handler === 'function') {
                const existing = __listenerStore.get(this) || [];
                existing.push({ type, handler, name: handler.name || null, src: handler.toString() });
                __listenerStore.set(this, existing);
            }
        } catch (e) { }
        return __origAddEventListener.call(this, type, handler, options);
    };

    const __origRemoveEventListener = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.removeEventListener = function (type, handler, options) {
        try {
            const existing = __listenerStore.get(this);
            if (existing && handler) {
                for (let i = existing.length - 1; i >= 0; i--) {
                    if (existing[i].handler === handler && existing[i].type === type) existing.splice(i, 1);
                }
                if (existing.length) __listenerStore.set(this, existing);
                else __listenerStore.delete(this);
            }
        } catch (e) { }
        return __origRemoveEventListener.call(this, type, handler, options);
    };

    // Patch jQuery `.on` to record delegated handlers (if jQuery present)
    try {
        if (window.jQuery) {
            const _$on = jQuery.fn.on;
            jQuery.fn.on = function (...args) {
                try {
                    // event type usually first arg (string) and handler last
                    const types = typeof args[0] === 'string' ? args[0].split(/\s+/) : [];
                    const handler = args[args.length - 1];
                    if (typeof handler === 'function') {
                        this.each(function () {
                            const existing = __listenerStore.get(this) || [];
                            types.forEach(t => existing.push({ type: t, handler, name: handler.name || null, src: handler.toString() }));
                            __listenerStore.set(this, existing);
                        });
                    }
                } catch (e) { }
                return _$on.apply(this, args);
            };
        }
    } catch (e) { }

    // MutationObserver to auto-tag dynamically added interactive elements with a data-track if missing
    try {
        const mo = new MutationObserver(muts => {
            for (const m of muts) {
                for (const node of m.addedNodes) {
                    if (!(node instanceof HTMLElement)) continue;
                    // find interactive elements inside the added subtree
                    const interactive = node.matches && node.matches('[data-track], button, [role="button"], input[type="button"], input[type="submit"]') ? [node] : Array.from(node.querySelectorAll('[data-track], button, [role="button"], input[type="button"], input[type="submit"]'));
                    interactive.forEach(el => {
                        if (!el.getAttribute('data-track') && !el.getAttribute('data-feature')) {
                            const label = getMeaningfulText(el) || getA11yLabel(el) || el.id || el.getAttribute('name');
                            if (label) el.setAttribute('data-track', label.slice(0, 100));
                        }
                    });
                }
            }
        });
        mo.observe(document.documentElement || document.body, { childList: true, subtree: true });
    } catch (e) { }

    function findRecordedHandlerName(el) {
        try {
            let node = el;
            while (node) {
                const rec = __listenerStore.get(node);
                if (rec) {
                    const click = rec.find(r => /click|mousedown|pointerdown/.test(r.type));
                    if (click) {
                        if (click.name) return camelToWords(click.name);
                        // try to infer from source
                        const m = click.src && click.src.match(/function\s+([a-zA-Z0-9_$]+)/);
                        if (m) return camelToWords(m[1]);
                        const arrow = click.src && click.src.slice(0, 200).match(/([a-zA-Z0-9_$]+)\s*=>/);
                        if (arrow) return camelToWords(arrow[1]);
                        return 'click handler';
                    }
                }
                node = node.parentElement;
            }
        } catch (e) { }
        return null;
    }


    function isJunkTarget(el) {
        const text = el.textContent?.trim() || '';

        // Time picker options (--:-- --, 3:00 PM, etc.)
        if (/^--:--/.test(text)) return true;
        if (/^\d{1,2}:\d{2}\s*(AM|PM)$/.test(text)) return true;

        // Loading/transitional states
        if (/^(saving|loading|submitting|please wait)\.*$/i.test(text)) return true;

        // Pure number or single character (pagination arrows like ›, ‹, page numbers)
        if (/^[\d›‹<>←→]+$/.test(text)) return true;

        // Option elements inside select dropdowns

        try {
            if (el.tagName === 'OPTION' || el.closest('select')) return true;
        } catch (e) { }

        return false;
    }

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
        if (isJunkTarget(el)) return;

        const urlBefore = location.href;

        setTimeout(() => {
            // URL changed or navigation click, discard
            if (location.href !== urlBefore) return;

            const context = getElementContext(el);
            // Try visible/a11y text first, then framework-extracted name, then any recorded handler name
            const recordedHandler = findRecordedHandlerName(el);
            const feature_name = getMeaningfulText(el) || resolveFeatureName(el, context) || recordedHandler;

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
            push('engagement_time', { duration: totalEngaged });
        } else {
            engageStart = Date.now();
        }
    });






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