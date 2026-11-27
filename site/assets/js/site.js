// Download label by OS, theme toggle, mobile menu, tabs, copy buttons, reveal on scroll, demo video.
// No network requests, no cookies; localStorage holds only the theme choice ('sf-theme').
(function () {
  'use strict'
  var root = document.documentElement
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

  // ---- Download button label ----
  function detectOs() {
    var p = (navigator.userAgentData && navigator.userAgentData.platform) || ''
    var ua = navigator.userAgent || ''
    var s = (p + ' ' + ua).toLowerCase()
    if (/android|iphone|ipad|ipod/.test(s)) return null
    if (/mac/.test(s)) return 'macOS'
    if (/win/.test(s)) return 'Windows'
    if (/linux|x11|cros/.test(s)) return 'Linux'
    return null
  }
  var os = detectOs()
  if (os) {
    document.querySelectorAll('[data-download-label]').forEach(function (el) {
      el.textContent = 'Download for ' + os
    })
  }

  // ---- Theme toggle ----
  function applyTheme(theme) {
    root.setAttribute('data-theme', theme)
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (m) {
      m.setAttribute('content', theme === 'light' ? '#ffffff' : '#000000')
    })
    document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
      b.setAttribute('aria-label', theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme')
    })
  }
  applyTheme(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark')
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    b.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light'
      applyTheme(next)
      try {
        localStorage.setItem('sf-theme', next)
      } catch (e) {
        /* storage blocked: the choice lasts for this page only */
      }
    })
  })

  // ---- Mobile menu ----
  var menuBtn = document.querySelector('[data-menu-toggle]')
  var nav = document.getElementById('site-nav')
  if (menuBtn && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open)
      menuBtn.setAttribute('aria-expanded', String(open))
      menuBtn.setAttribute('aria-label', open ? 'Close menu' : 'Open menu')
    }
    menuBtn.addEventListener('click', function () {
      setOpen(menuBtn.getAttribute('aria-expanded') !== 'true')
    })
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false)
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false)
        menuBtn.focus()
      }
    })
  }

  // ---- Tabs (roving tabindex, arrow keys, Home/End) ----
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var tabs = Array.prototype.slice.call(list.querySelectorAll('[role="tab"]'))
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab
        t.setAttribute('aria-selected', String(on))
        t.tabIndex = on ? 0 : -1
        var panel = document.getElementById(t.getAttribute('aria-controls'))
        if (panel) panel.hidden = !on
      })
      if (focus) tab.focus()
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () {
        select(t, false)
      })
      t.addEventListener('keydown', function (e) {
        var next = null
        if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length]
        else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length]
        else if (e.key === 'Home') next = tabs[0]
        else if (e.key === 'End') next = tabs[tabs.length - 1]
        if (next) {
          e.preventDefault()
          select(next, true)
        }
      })
    })
  })

  // ---- Copy buttons ----
  function fallbackCopy(text) {
    var ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.className = 'visually-hidden'
    document.body.appendChild(ta)
    ta.select()
    var ok = false
    try {
      ok = document.execCommand('copy')
    } catch (e) {
      ok = false
    }
    document.body.removeChild(ta)
    return ok ? Promise.resolve() : Promise.reject(new Error('copy failed'))
  }
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    var label = btn.querySelector('.copy-label')
    var status = btn.parentElement.querySelector('.copy-status')
    btn.addEventListener('click', function () {
      var target = document.getElementById(btn.getAttribute('data-copy'))
      if (!target) return
      var text = target.textContent
      var p = navigator.clipboard && window.isSecureContext ? navigator.clipboard.writeText(text) : fallbackCopy(text)
      p.catch(function () {
        return fallbackCopy(text)
      }).then(
        function () {
          btn.setAttribute('data-copied', '')
          if (label) label.textContent = 'Copied'
          if (status) status.textContent = 'Copied to clipboard'
          setTimeout(function () {
            btn.removeAttribute('data-copied')
            if (label) label.textContent = 'Copy'
            if (status) status.textContent = ''
          }, 2000)
        },
        function () {
          if (status) status.textContent = 'Copy failed. Select the text and copy it by hand.'
        }
      )
    })
  })

  // ---- Click to zoom: screenshots open full size in a dialog (without JS the link opens the image) ----
  var zoomLinks = document.querySelectorAll('a[data-zoom]')
  if (zoomLinks.length && typeof HTMLDialogElement === 'function') {
    var box = document.createElement('dialog')
    box.className = 'lightbox'
    box.setAttribute('aria-label', 'Screenshot')
    var bar = document.createElement('div')
    bar.className = 'lightbox-bar'
    var caption = document.createElement('p')
    var close = document.createElement('button')
    close.type = 'button'
    close.className = 'btn btn-secondary btn-sm'
    close.textContent = 'Close'
    bar.appendChild(caption)
    bar.appendChild(close)
    var big = document.createElement('img')
    big.decoding = 'async'
    big.alt = ''
    box.appendChild(bar)
    box.appendChild(big)
    document.body.appendChild(box)
    var opener = null
    close.addEventListener('click', function () {
      box.close()
    })
    // A click on the backdrop (outside the dialog box) closes it
    box.addEventListener('click', function (e) {
      var r = box.getBoundingClientRect()
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) box.close()
    })
    box.addEventListener('close', function () {
      big.removeAttribute('src')
      if (opener) opener.focus()
    })
    // The zoom files are the 2x captures: show them at their CSS size, 1 image pixel per device pixel on 2x screens
    big.addEventListener('load', function () {
      big.width = Math.round(big.naturalWidth / 2)
    })
    zoomLinks.forEach(function (a) {
      var img = a.querySelector('img')
      if (img) a.setAttribute('aria-label', 'Enlarge screenshot: ' + img.alt)
      a.addEventListener('click', function (e) {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
        e.preventDefault()
        opener = a
        big.removeAttribute('width')
        big.alt = img ? img.alt : ''
        caption.textContent = img ? img.alt : ''
        big.src = a.getAttribute('href')
        box.showModal()
        close.focus()
      })
    })
  }

  // ---- Reveal on scroll ----
  var reveals = document.querySelectorAll('.reveal')
  if ('IntersectionObserver' in window && !reduceMotion.matches) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            e.target.classList.add('is-visible')
            io.unobserve(e.target)
          }
        })
      },
      { rootMargin: '0px 0px -8% 0px' }
    )
    reveals.forEach(function (el) {
      io.observe(el)
    })
  } else {
    reveals.forEach(function (el) {
      el.classList.add('is-visible')
    })
  }

  // ---- Demo video: plays only without reduced motion, pauses off-screen ----
  document.querySelectorAll('video[data-autoplay]').forEach(function (video) {
    video.muted = true
    if (reduceMotion.matches || !('IntersectionObserver' in window)) return
    var vio = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !video.dataset.userPaused) {
            var p = video.play()
            if (p && p.catch) p.catch(function () {})
          } else if (!e.isIntersecting && !video.paused) {
            autoPausing = true
            video.pause()
          }
        })
      },
      { threshold: 0.25 }
    )
    var autoPausing = false
    vio.observe(video)
    // A pause from the controls sticks until the user presses play again
    video.addEventListener('pause', function () {
      if (autoPausing) autoPausing = false
      else video.dataset.userPaused = '1'
    })
    video.addEventListener('play', function () {
      delete video.dataset.userPaused
    })
  })
})()
