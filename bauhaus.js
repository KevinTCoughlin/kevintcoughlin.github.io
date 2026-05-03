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
  bg.onerror = function () {
    bg.parentNode.removeChild(bg);
    attribution.parentNode.removeChild(attribution);
  };
  bg.src = API + '/today' + dateParam;

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
