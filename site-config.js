// Site switches. Edit this file only; index.html loads it as a module.
//
// steamUrl: leave empty until the Steam store page exists. While it is empty,
//   "Coming to Steam" shows as plain text, not a link. Set it to the store URL
//   (e.g. "https://store.steampowered.com/app/<id>/Salt_Line/") to turn every
//   [data-steam] element into a link labelled with steamLinkLabel.
// showSponsors: false hides every [data-sponsors] element ("Support the work").
export const siteConfig = {
  steamUrl: '',
  steamLinkLabel: 'Wishlist on Steam',
  showSponsors: true,
  sponsorsUrl: 'https://github.com/sponsors/KevinTCoughlin',
};

function apply({ steamUrl, steamLinkLabel, showSponsors, sponsorsUrl }) {
  if (steamUrl) {
    for (const el of document.querySelectorAll('[data-steam]')) {
      const a = document.createElement('a');
      a.href = steamUrl;
      a.className = el.className.replace('button-pending', 'button-secondary');
      a.rel = 'noopener noreferrer';
      a.textContent = steamLinkLabel;
      el.replaceWith(a);
    }
  }
  for (const el of document.querySelectorAll('[data-sponsors]')) {
    el.hidden = !showSponsors;
    for (const a of el.querySelectorAll('a[data-sponsors-link]')) a.href = sponsorsUrl;
  }
}

apply(siteConfig);
