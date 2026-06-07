(function () {
  var API = 'https://bauhaus.cascadiacollections.workers.dev/api';
  var CACHE_LOAD_MS = 50;
  var SWIPE_THRESHOLD = 50;
  var now = new Date();
  var pad = function (n) {
    return n < 10 ? '0' + n : '' + n;
  };
  var today = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate());
  var dateParam = '?d=' + today;
  var bg = document.getElementById('bg');
  var attribution = document.getElementById('attribution');

  // Tracks the date currently shown; starts as today, changes on swipe.
  var currentDate = today;

  var attrLink = document.createElement('a');
  attrLink.href = 'https://github.com/cascadiacollections/bauhaus';
  attrLink.rel = 'noopener noreferrer';
  attrLink.textContent = '🎨 bauhaus';
  attribution.appendChild(attrLink);

  function updateAttribution(title) {
    attrLink.textContent = '🎨 ' + title;
  }

  // Returns an ISO date string (YYYY-MM-DD) offset by `days` from `dateStr`.
  function offsetDate(dateStr, days) {
    var d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  // Loads the image and metadata for `date`, fading out then in.
  function loadDate(date) {
    bg.classList.remove('loaded');
    bg.onerror = function () {
      if (bg.src.indexOf('data:image/svg') !== 0) {
        bg.onerror = null;
        bg.src = FALLBACK;
        updateAttribution('bauhaus (offline fallback)');
      }
    };
    var imageLoadStart = Date.now();
    bg.onload = function () {
      if (Date.now() - imageLoadStart < CACHE_LOAD_MS) {
        bg.style.transition = 'none';
      } else {
        bg.style.transition = '';
      }
      bg.classList.add('loaded');
    };
    bg.src = date === today ? API + '/today' + dateParam : API + '/' + date;

    // Update attribution text immediately while fetch completes.
    if (date === today) {
      try {
        var cachedTitle = localStorage.getItem('bg-title');
        var cachedDate = localStorage.getItem('bg-date');
        if (cachedDate === today && cachedTitle) {
          updateAttribution(cachedTitle);
          return;
        }
      } catch (_e) {
        /* localStorage unavailable */
      }
    }

    var metaUrl = date === today ? API + '/today.json' + dateParam : API + '/' + date + '.json';
    fetch(metaUrl)
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (data && data.title) {
          if (date === today) {
            try {
              localStorage.setItem('bg-date', today);
              localStorage.setItem('bg-title', data.title);
            } catch (_e) {
              /* localStorage unavailable */
            }
          }
          updateAttribution(data.title);
        }
      })
      .catch(function () {
        /* attribution is non-critical */
      });
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

  // ── Touch swipe navigation ──────────────────────────
  // Swipe right → previous day; swipe left → next day (capped at today).
  var touchStartX = 0;
  var touchStartY = 0;

  document.addEventListener(
    'touchstart',
    function (e) {
      touchStartX = e.changedTouches[0].clientX;
      touchStartY = e.changedTouches[0].clientY;
    },
    { passive: true }
  );

  document.addEventListener(
    'touchend',
    function (e) {
      var dx = e.changedTouches[0].clientX - touchStartX;
      var dy = e.changedTouches[0].clientY - touchStartY;
      // Require a mostly-horizontal swipe to avoid triggering on scrolls.
      if (Math.abs(dx) < SWIPE_THRESHOLD || Math.abs(dx) < Math.abs(dy)) return;

      var nextDate;
      if (dx > 0) {
        // Swipe right → go back one day.
        nextDate = offsetDate(currentDate, -1);
      } else {
        // Swipe left → go forward one day, but not past today.
        var candidate = offsetDate(currentDate, 1);
        if (candidate > today) return;
        nextDate = candidate;
      }

      currentDate = nextDate;
      loadDate(currentDate);
    },
    { passive: true }
  );
})();
