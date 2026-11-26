// Runs before first paint: picks the theme (stored choice, else the OS setting) so the page never flashes.
(function () {
  var root = document.documentElement
  var theme = null
  try {
    theme = localStorage.getItem('sf-theme')
  } catch (e) {
    theme = null
  }
  if (theme !== 'light' && theme !== 'dark') {
    theme = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
  }
  root.setAttribute('data-theme', theme)
  root.classList.add('js')
})()
