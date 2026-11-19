/** Turn address bar text into a URL: full URLs pass through, hosts get a scheme, the rest is a search. */
export function toUrl(text: string): string {
  // Editing a view-source URL reloads the source view instead of searching for the text
  if (/^view-source:https?:\/\//i.test(text.trim())) return text.trim()
  if (/^https?:\/\//i.test(text)) return text
  if (/\s/.test(text)) return `https://www.google.com/search?q=${encodeURIComponent(text)}`

  // Local dev hosts: localhost, 127.x, 0.0.0.0, *.localhost, *.local, private IPs → http
  const host = text.split(/[/:?#]/)[0].toLowerCase()
  const isLocal =
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$)/.test(host)
  if (isLocal) return `http://${text}`

  // Looks like a domain (example.com) or has a port (myhost:8080)
  if (host.includes('.') || /^[^/]+:\d+/.test(text)) return `https://${text}`

  return `https://www.google.com/search?q=${encodeURIComponent(text)}`
}
