import { onCLS, onFCP, onINP, onLCP, onTTFB } from '/web-vitals.js';

const API = 'https://bauhaus.cascadiacollections.workers.dev/api';

function beacon(url, body) {
  const fetchFallback = () => {
    void fetch(url, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).catch(() => {
      /* telemetry is non-critical */
    });
  };

  try {
    if (navigator.sendBeacon && navigator.sendBeacon(url, body)) {
      return;
    } else {
      fetchFallback();
    }
  } catch (_e) {
    fetchFallback();
  }
}

function sendVital(metric) {
  beacon(
    API + '/web_vitals',
    JSON.stringify({ name: metric.name, value: metric.value, rating: metric.rating, id: metric.id })
  );
}

onCLS(sendVital);
onFCP(sendVital);
onINP(sendVital);
onLCP(sendVital);
onTTFB(sendVital);

addEventListener('error', function (e) {
  if (!(e instanceof ErrorEvent)) return;
  beacon(
    API + '/err',
    JSON.stringify({
      message: e.message,
      source: e.filename,
      lineno: e.lineno,
      colno: e.colno,
      stack: e.error?.stack?.slice(0, 1024),
    })
  );
});

addEventListener('unhandledrejection', function (e) {
  beacon(
    API + '/err',
    JSON.stringify({ message: String(e.reason), stack: e.reason?.stack?.slice(0, 1024) })
  );
});
