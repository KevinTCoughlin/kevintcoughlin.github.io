(function () {
  var API = 'https://bauhaus.cascadiacollections.workers.dev/api';
  var CACHE_LOAD_MS = 50;
  var now = new Date();
  var pad = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var dateParam = '?d=' + today;
  var bg = document.getElementById('bg');
  var attribution = document.getElementById('attribution');

  var attrLink = document.createElement('a');
  attrLink.href = 'https://github.com/cascadiacollections/bauhaus';
  attrLink.target = '_blank';
  attrLink.rel = 'noopener noreferrer';
  attrLink.textContent = '🎨 bauhaus';
  attribution.appendChild(attrLink);

  function updateAttribution(title) {
    attrLink.textContent = '🎨 ' + title;
  }

  var loadStart = Date.now();
  bg.onload = function () {
    if (Date.now() - loadStart < CACHE_LOAD_MS) {
      bg.style.transition = 'none';
    }
    bg.classList.add('loaded');
  };
  // Inline SVG fallback — used when the bauhaus Worker is unreachable so
  // visitors don't see a blank hero. Small (~1KB), Bauhaus-palette nod.
  var FALLBACK =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#1a1a1a"/><stop offset="1" stop-color="#3a2a1a"/>' +
        '</linearGradient></defs>' +
        '<rect width="1200" height="800" fill="url(#g)"/>' +
        '<circle cx="380" cy="320" r="170" fill="#ff5f2e"/>' +
        '<rect x="600" y="120" width="320" height="320" fill="#f3c623"/>' +
        '<rect x="180" y="540" width="780" height="40" fill="#0b7a75"/>' +
        '</svg>'
    );

  bg.onerror = function () {
    // Don't tear the element down — swap to the offline fallback so the
    // hero never goes blank. The bauhaus Worker is otherwise a SPOF.
    if (bg.src.indexOf('data:image/svg') !== 0) {
      bg.onerror = null;
      bg.src = FALLBACK;
      updateAttribution('bauhaus (offline fallback)');
    }
  };
  bg.crossOrigin = 'anonymous';
  bg.src = API + '/today' + dateParam;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () {
        /* best effort */
      });
    });
  }

  try {
    var cachedDate = localStorage.getItem('bg-date');
    var cachedTitle = localStorage.getItem('bg-title');
    if (cachedDate === today && cachedTitle) {
      updateAttribution(cachedTitle);
      return;
    }
  } catch (_e) {
    /* localStorage unavailable */
  }

  fetch(API + '/today.json' + dateParam)
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (data && data.title) {
        try {
          localStorage.setItem('bg-date', today);
          localStorage.setItem('bg-title', data.title);
        } catch (_e) {
          /* localStorage unavailable */
        }
        updateAttribution(data.title);
      }
    })
    .catch(function () {
      /* attribution is non-critical */
    });
})();
