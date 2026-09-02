// 缓存版本：必须与 js/accounting.js 中的 APP_VERSION 保持一致
const CACHE_NAME = 'life-manager-v5.4';
const ASSETS = [
    './',
    './index.html',
    './css/accounting.css',
    './css/birthday.css',
    './js/accounting.js',
    './js/birthday.js',
    './manifest.json',
    './lib/lunar.min.js',
    './lib/supabase.min.js',
    './lib/chart.umd.min.js'
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return Promise.allSettled(
                ASSETS.map(url => cache.add(url).catch(() => {}))
            );
        })
    );
    self.skipWaiting();
});

// 激活：清理旧缓存，通知页面有新版本
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
            );
        }).then(() => {
            return self.clients.matchAll({ type: 'window' }).then(clients => {
                clients.forEach(client => {
                    client.postMessage({ type: 'SW_UPDATED' });
                });
            });
        })
    );
    self.clients.claim();
});

// 请求拦截：API 请求直接走网络，App 资源走缓存优先
self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    const url = event.request.url;

    if (url.startsWith('chrome-extension://')) return;

    // Supabase API 请求：直接走网络
    if (url.includes('supabase.co')) {
        return;
    }

    // App 静态资源：缓存优先 + 网络回退
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const fetchPromise = fetch(event.request).then((response) => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, clone);
                    });
                }
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
