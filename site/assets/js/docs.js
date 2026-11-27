// Docs pages: sidebar drawer on small screens, "On this page" highlight, and search (Ctrl/Cmd+K or "/").
// The search index is window.SF_DOCS_INDEX from docs-index.js (built by site/tools/build-docs.mjs); no requests.
(function () {
  'use strict'
  var root = document.body.getAttribute('data-root') || './'

  // ---- Drawer ----
  var menu = document.querySelector('[data-docs-menu]')
  var nav = document.getElementById('docs-nav')
  if (menu && nav) {
    var setOpen = function (open) {
      nav.classList.toggle('open', open)
      document.body.classList.toggle('docs-drawer-open', open)
      menu.setAttribute('aria-expanded', String(open))
      if (open) {
        var current = nav.querySelector('[aria-current="page"]') || nav.querySelector('a')
        if (current) current.focus()
      }
    }
    menu.addEventListener('click', function () {
      setOpen(menu.getAttribute('aria-expanded') !== 'true')
    })
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('open')) {
        setOpen(false)
        menu.focus()
      }
    })
    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) setOpen(false)
    })
  }

  // ---- On this page: highlight the heading being read ----
  var tocLinks = Array.prototype.slice.call(document.querySelectorAll('.docs-toc a'))
  if (tocLinks.length && 'IntersectionObserver' in window) {
    var headings = tocLinks
      .map(function (a) {
        return document.getElementById(a.getAttribute('href').slice(1))
      })
      .filter(Boolean)
    var visible = new Set()
    var mark = function () {
      var current = null
      for (var i = 0; i < headings.length; i++) {
        if (visible.has(headings[i])) {
          current = headings[i]
          break
        }
      }
      // Nothing in the band: the last heading above it
      if (!current) {
        for (var j = headings.length - 1; j >= 0; j--) {
          if (headings[j].getBoundingClientRect().top < 120) {
            current = headings[j]
            break
          }
        }
      }
      tocLinks.forEach(function (a) {
        var on = current && a.getAttribute('href') === '#' + current.id
        if (on) a.setAttribute('aria-current', 'true')
        else a.removeAttribute('aria-current')
      })
    }
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) visible.add(e.target)
          else visible.delete(e.target)
        })
        mark()
      },
      { rootMargin: '-72px 0px -60% 0px' }
    )
    headings.forEach(function (h) {
      io.observe(h)
    })
    mark()
  }

  // ---- Search ----
  var index = window.SF_DOCS_INDEX || []
  var dialog = document.createElement('dialog')
  dialog.className = 'docs-search'
  dialog.setAttribute('aria-label', 'Search docs')
  dialog.innerHTML =
    '<form method="dialog" class="docs-search-form" role="search"><label class="visually-hidden" for="docs-q">Search docs</label>' +
    '<input id="docs-q" type="search" autocomplete="off" placeholder="Search docs" aria-controls="docs-results">' +
    '<kbd>Esc</kbd></form><ul id="docs-results" class="docs-results" role="listbox" aria-label="Results"></ul>' +
    '<p class="docs-search-empty" hidden>No results.</p>'
  document.body.appendChild(dialog)
  var input = dialog.querySelector('input')
  var list = dialog.querySelector('ul')
  var empty = dialog.querySelector('.docs-search-empty')
  var active = 0
  var results = []
  var opener = null

  function score(page, terms) {
    var t = page.t.toLowerCase()
    var h = page.h.map(function (x) { return x[0].toLowerCase() }).join(' ')
    var x = page.x.toLowerCase()
    var s = 0
    for (var i = 0; i < terms.length; i++) {
      var term = terms[i]
      if (t.indexOf(term) >= 0) s += 10
      else if (h.indexOf(term) >= 0) s += 5
      else if (x.indexOf(term) >= 0) s += 1
      else return 0
    }
    return s
  }
  function section(page, terms) {
    for (var i = 0; i < page.h.length; i++) {
      var name = page.h[i][0].toLowerCase()
      if (terms.some(function (t) { return name.indexOf(t) >= 0 })) return page.h[i]
    }
    return null
  }
  function render() {
    var q = input.value.trim().toLowerCase()
    var terms = q.split(/\s+/).filter(Boolean)
    results = !terms.length
      ? index.slice(0, 8).map(function (p) { return { p: p, s: 1 } })
      : index
          .map(function (p) { return { p: p, s: score(p, terms) } })
          .filter(function (r) { return r.s > 0 })
          .sort(function (a, b) { return b.s - a.s })
          .slice(0, 10)
    list.replaceChildren()
    results.forEach(function (r, i) {
      var sec = terms.length ? section(r.p, terms) : null
      var li = document.createElement('li')
      li.setAttribute('role', 'option')
      li.id = 'docs-r-' + i
      var a = document.createElement('a')
      a.href = root + r.p.u + (sec ? '#' + sec[1] : '')
      var title = document.createElement('span')
      title.className = 'r-title'
      title.textContent = r.p.t + (sec ? ' › ' + sec[0] : '')
      var group = document.createElement('span')
      group.className = 'r-group'
      group.textContent = r.p.g
      a.appendChild(title)
      a.appendChild(group)
      li.appendChild(a)
      list.appendChild(li)
    })
    empty.hidden = results.length > 0
    active = 0
    highlight()
  }
  function highlight() {
    Array.prototype.forEach.call(list.children, function (li, i) {
      li.setAttribute('aria-selected', String(i === active))
    })
    input.setAttribute('aria-activedescendant', results.length ? 'docs-r-' + active : '')
    var el = list.children[active]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }
  function open() {
    if (dialog.open) return
    opener = document.activeElement
    input.value = ''
    render()
    dialog.showModal()
    input.focus()
  }
  input.addEventListener('input', render)
  input.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      active = Math.min(results.length - 1, active + 1)
      highlight()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      active = Math.max(0, active - 1)
      highlight()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      var a = list.children[active] && list.children[active].querySelector('a')
      if (a) window.location.href = a.href
    }
  })
  dialog.addEventListener('click', function (e) {
    if (e.target === dialog) dialog.close()
  })
  dialog.addEventListener('close', function () {
    if (opener && opener.focus) opener.focus()
  })
  document.querySelectorAll('[data-docs-search]').forEach(function (b) {
    b.addEventListener('click', open)
  })
  var mac = /mac/i.test((navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '')
  document.querySelectorAll('.docs-search-btn kbd').forEach(function (k) {
    k.textContent = mac ? '⌘K' : 'Ctrl K'
  })
  document.addEventListener('keydown', function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      open()
    } else if (e.key === '/' && !typing && !dialog.open) {
      e.preventDefault()
      open()
    }
  })
})()
