/* ============================================
   main.js — Shared functionality
   Theme toggle · Mobile nav · Active links
   ============================================ */

(function () {
  'use strict';

  // ---------- Theme toggle ----------
  const toggle = document.getElementById('theme-toggle');
  const root = document.documentElement;

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('blog-theme', theme);
  }

  // Restore saved preference or respect system preference
  const saved = localStorage.getItem('blog-theme');
  if (saved) {
    setTheme(saved);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setTheme('dark');
  }

  if (toggle) {
    toggle.addEventListener('click', function () {
      const current = root.getAttribute('data-theme');
      setTheme(current === 'dark' ? 'light' : 'dark');
    });
  }

  // Listen for OS-level changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!localStorage.getItem('blog-theme')) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });


  // ---------- Contact form validation & submit ----------
  const form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      // Clear previous errors
      document.querySelectorAll('.form-error').forEach(function (el) {
        el.classList.remove('form-error--visible');
      });

      const name = document.getElementById('contact-name');
      const email = document.getElementById('contact-email');
      const message = document.getElementById('contact-message');
      let valid = true;

      if (!name.value.trim()) {
        document.getElementById('error-name').classList.add('form-error--visible');
        valid = false;
      }
      if (!email.value.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) {
        document.getElementById('error-email').classList.add('form-error--visible');
        valid = false;
      }
      if (!message.value.trim()) {
        document.getElementById('error-message').classList.add('form-error--visible');
        valid = false;
      }

      if (!valid) return;

      const submitBtn = document.getElementById('contact-submit');
      submitBtn.textContent = 'Sending…';
      submitBtn.disabled = true;

      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
          form.reset();
          document.getElementById('form-success').classList.add('form-success--visible');
          submitBtn.textContent = 'Sent ✓';
          setTimeout(function () {
            submitBtn.textContent = 'Send message';
            submitBtn.disabled = false;
          }, 3000);
        } else {
          throw new Error('Form submission failed');
        }
      } catch (err) {
        submitBtn.textContent = 'Send message';
        submitBtn.disabled = false;
        alert('Something went wrong. Please try again or email me directly.');
      }
    });
  }
})();
