# Docs sources

One HTML fragment per docs page (`<slug>.html`, `index.html` for the landing page). The first line is a JSON
comment with `title`, `description` (120-160 characters), `lead` and optional `nav` (the sidebar label).
`nav.json` sets the groups and order. `{{root}}` becomes the relative path to the site root.

Build: `node site/tools/build-docs.mjs && node site/tools/sync-partials.mjs`.
In the fragments, `<h2>`/`<h3>` get ids and anchor links, and `<pre data-lang="…"><code>` blocks get a
language label and a copy button.
