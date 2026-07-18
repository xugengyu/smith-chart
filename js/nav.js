(function() {
  'use strict';

  // Navigation for standalone apps - redirecting back to main site
  const mainSiteUrl = 'https://xugengyu.github.io/paul-blog/';
  
  // Determine active page
  let activePage = 'apps'; // Standalone app is in the apps category

  const navHtml = `
    <div class="nav__inner">
      <a href="${mainSiteUrl}index.html" class="nav__logo">Random Thoughts of a Random Guy</a>
      <button class="nav__hamburger" id="nav-hamburger" aria-label="Toggle menu">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="3" y1="6" x2="21" y2="6"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
      <div class="nav__menu" id="nav-menu">
        <ul class="nav__links">
          <li><a href="${mainSiteUrl}index.html" class="nav__link">About</a></li>
          <li><a href="${mainSiteUrl}posts.html" class="nav__link">Posts</a></li>
          <li><a href="${mainSiteUrl}notes.html" class="nav__link">Notes</a></li>
          <li><a href="${mainSiteUrl}apps.html" class="nav__link nav__link--active">Apps</a></li>
          <li><a href="${mainSiteUrl}hobby.html" class="nav__link">Hobby</a></li>
          <li><a href="${mainSiteUrl}contact.html" class="nav__link">Contact</a></li>
          <li>
            <button class="theme-toggle" id="theme-toggle" aria-label="Toggle theme">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <circle cx="12" cy="12" r="5"/>
                <line x1="12" y1="1" x2="12" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="23"/>
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
                <line x1="1" y1="12" x2="3" y2="12"/>
                <line x1="21" y1="12" x2="23" y2="12"/>
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
              </svg>
            </button>
          </li>
        </ul>
      </div>
    </div>
  `;

  // Inject the nav
  const navEl = document.getElementById('main-nav');
  if (navEl) {
    navEl.innerHTML = navHtml;
  }

  // ---------- Mobile nav listeners ----------
  const hamburger = document.getElementById('nav-hamburger');
  const menu = document.getElementById('nav-menu');

  if (hamburger && menu) {
    hamburger.addEventListener('click', function () {
      menu.classList.toggle('nav__menu--open');
    });

    // Close menu when a link is clicked
    menu.querySelectorAll('.nav__link').forEach(function (link) {
      link.addEventListener('click', function () {
        menu.classList.remove('nav__menu--open');
      });
    });
  }
})();
