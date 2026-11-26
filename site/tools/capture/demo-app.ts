// "Acme Admin": a fictional local web app for the website screenshots and demo video.
// Three roles (admin, customer, guest) picked by /login-as, shared in-memory orders, no external requests.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface DemoApp {
  port: number
  base: string
  close: () => Promise<void>
}

type Role = 'admin' | 'customer' | 'guest'

interface Order {
  id: number
  customer: string
  email: string
  total: string
  status: 'Paid' | 'Refunded' | 'Pending' | 'Shipped'
}

const USERS = [
  { name: 'Morgan Lee', email: 'morgan@example.com', role: 'Admin' },
  { name: 'Jamie Rivera', email: 'jamie@example.com', role: 'Customer' },
  { name: 'Sam Patel', email: 'sam@example.com', role: 'Customer' },
  { name: 'Alex Kim', email: 'alex@example.com', role: 'Support' }
]

function freshOrders(): Order[] {
  return [
    { id: 1042, customer: 'Jamie Rivera', email: 'jamie@example.com', total: '$129.00', status: 'Paid' },
    { id: 1041, customer: 'Sam Patel', email: 'sam@example.com', total: '$54.20', status: 'Shipped' },
    { id: 1040, customer: 'Jamie Rivera', email: 'jamie@example.com', total: '$18.00', status: 'Shipped' },
    { id: 1039, customer: 'Alex Kim', email: 'alex@example.com', total: '$310.75', status: 'Pending' },
    { id: 1038, customer: 'Sam Patel', email: 'sam@example.com', total: '$76.10', status: 'Paid' }
  ]
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

function userOf(req: IncomingMessage): { name: string; role: Role } | null {
  const m = /(?:^|;\s*)acme_user=([^;]*)/.exec(req.headers.cookie ?? '')
  if (!m) return null
  const [name, role] = decodeURIComponent(m[1]).split(':')
  if (role !== 'admin' && role !== 'customer' && role !== 'guest') return null
  return { name, role }
}

const CSS = `
*{box-sizing:border-box}body{margin:0;font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#111827;background:#f6f7f9}
.shell{display:flex;min-height:100vh}.side{width:200px;background:#111827;color:#e5e7eb;padding:18px 14px;flex-shrink:0}
.brand{display:flex;align-items:center;gap:8px;font-weight:600;font-size:15px;margin-bottom:22px}.logo{width:22px;height:22px;border-radius:5px;background:#e5e7eb}
.nav a{display:block;color:#9ca3af;text-decoration:none;padding:6px 8px;border-radius:6px;margin-bottom:2px}.nav a.on{background:#1f2937;color:#fff}
.main{flex:1;padding:22px 26px;min-width:0}.top{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;gap:12px}
h1{font-size:20px;margin:0}.who{font-size:12px;color:#4b5563;background:#fff;border:1px solid #e5e7eb;border-radius:999px;padding:4px 10px;white-space:nowrap}
.kpis{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:18px}.kpi{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}
.kpi b{display:block;font-size:20px}.kpi span{color:#6b7280;font-size:12px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;margin-bottom:16px}.card h2{font-size:14px;margin:0 0 10px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:7px 6px;border-top:1px solid #f0f1f3;white-space:nowrap}th{color:#6b7280;font-weight:500;font-size:12px;border-top:0}
.pill{font-size:11px;padding:2px 8px;border-radius:999px;background:#ecfdf5;color:#047857}.pill.Refunded{background:#fef2f2;color:#b91c1c}.pill.Pending{background:#fffbeb;color:#92400e}.pill.Shipped{background:#eff6ff;color:#1d4ed8}
button{font:inherit;font-size:12px;border:1px solid #d1d5db;background:#fff;border-radius:6px;padding:3px 10px;cursor:pointer}button:disabled{opacity:.5}
input{font:inherit;border:1px solid #d1d5db;border-radius:6px;padding:6px 10px;width:220px;background:#fff}
.prod{background:#fef2f2;color:#991b1b;border-bottom:1px solid #fecaca;font-size:12px;padding:5px 26px}
.price{text-align:center;padding:30px}.price b{font-size:30px;display:block;margin:6px 0}.muted{color:#6b7280}
.signin{display:inline-block;margin-top:12px;background:#111827;color:#fff;border-radius:6px;padding:7px 16px;text-decoration:none}
`

function nav(role: Role): string {
  const items =
    role === 'admin' ? ['Dashboard', 'Orders', 'Users', 'Billing', 'Settings'] : role === 'customer' ? ['My orders', 'Billing', 'Profile'] : ['Pricing', 'Docs']
  return items.map((label, i) => `<a href="#" class="${i === 0 ? 'on' : ''}">${label}</a>`).join('')
}

function page(role: Role, name: string, prod: boolean, body: string, script = ''): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Acme Admin</title><style>${CSS}</style></head><body>
${prod ? '<div class="prod">acme.com (production)</div>' : ''}
<div class="shell"><aside class="side"><div class="brand"><span class="logo"></span>Acme Admin</div><nav class="nav">${nav(role)}</nav></aside>
<main class="main"><div class="top"><h1>${role === 'admin' ? 'Dashboard' : role === 'customer' ? 'My orders' : 'Plans and pricing'}</h1>
<span class="who">${role === 'guest' ? 'Not signed in' : `${esc(name)} · ${role === 'admin' ? 'Admin' : 'Customer'}`}</span></div>${body}</main></div>
${script ? `<script>${script}</script>` : ''}</body></html>`
}

function orderRows(orders: Order[], admin: boolean): string {
  return orders
    .map(
      (o) =>
        `<tr data-search="${o.id} ${esc(o.customer.toLowerCase())}"><td>#${o.id}</td><td>${esc(o.customer)}</td><td>${o.total}</td>` +
        `<td><span class="pill ${o.status}" id="status-${o.id}">${o.status}</span></td>` +
        (admin ? `<td><button id="refund-${o.id}" ${o.status === 'Refunded' ? 'disabled' : ''}>Refund</button></td>` : '') +
        '</tr>'
    )
    .join('')
}

function adminPage(name: string, orders: Order[], prod: boolean): string {
  const body = `<div class="kpis"><div class="kpi"><span>Revenue (30 days)</span><b>$48,210</b></div><div class="kpi"><span>Orders</span><b>1,284</b></div><div class="kpi"><span>Refunds</span><b id="refunds">12</b></div></div>
<div class="card"><div class="top"><h2>Recent orders</h2><input id="search" type="search" placeholder="Search orders" aria-label="Search orders"></div>
<table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody id="orders">${orderRows(orders, true)}</tbody></table></div>
<div class="card"><h2>Users</h2><table><thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead><tbody>${USERS.map((u) => `<tr><td>${u.name}</td><td>${u.email}</td><td>${u.role}</td></tr>`).join('')}</tbody></table></div>`
  const script = `
const search = document.getElementById('search')
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase()
  for (const tr of document.querySelectorAll('#orders tr')) tr.hidden = q !== '' && !tr.dataset.search.includes(q)
})
for (const b of document.querySelectorAll('button[id^="refund-"]')) {
  b.addEventListener('click', async () => {
    const id = b.id.slice(7)
    const r = await fetch('/api/orders/' + id + '/refund', { method: 'POST' })
    if (r.ok) { document.getElementById('status-' + id).textContent = 'Refunded'; document.getElementById('status-' + id).className = 'pill Refunded'; b.disabled = true; const k = document.getElementById('refunds'); k.textContent = String(Number(k.textContent) + 1) }
  })
}`
  return page('admin', name, prod, body, script)
}

function customerPage(name: string, orders: Order[]): string {
  const mine = orders.filter((o) => o.customer === name)
  const body = `<div class="card"><h2>Orders</h2><table><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead><tbody id="orders">${orderRows(mine, false)}</tbody></table></div>
<div class="card"><h2>Billing</h2><p class="muted">Visa ending 4242 · next invoice on 1 December</p><a href="/admin/billing">Admin billing</a></div>`
  const script = `
setInterval(async () => {
  const r = await fetch('/api/my-orders'); if (!r.ok) return
  for (const o of await r.json()) { const el = document.getElementById('status-' + o.id); if (el && el.textContent !== o.status) { el.textContent = o.status; el.className = 'pill ' + o.status } }
}, 1000)`
  return page('customer', name, false, body, script)
}

function guestPage(): string {
  const body = `<div class="card price"><span class="muted">Team plan</span><b>$24 / month</b><p class="muted">Orders, refunds and user roles for up to 10 staff.</p><a class="signin" href="#">Sign in</a></div>`
  return page('guest', '', false, body)
}

const send = (res: ServerResponse, status: number, type: string, body: string, headers: Record<string, string> = {}): void => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...headers })
  res.end(body)
}

async function listen(server: ReturnType<typeof createServer>, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve((server.address() as AddressInfo).port)
    })
  })
}

export async function startDemoApp(): Promise<DemoApp> {
  let orders = freshOrders()
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const user = userOf(req)
    if (url.pathname === '/login-as') {
      const role = url.searchParams.get('role') ?? 'guest'
      const name = url.searchParams.get('user') ?? 'Guest'
      return send(res, 302, 'text/plain', '', {
        'set-cookie': `acme_user=${encodeURIComponent(`${name}:${role}`)}; Path=/; HttpOnly; SameSite=Lax`,
        location: '/app'
      })
    }
    if (url.pathname === '/reset' && req.method === 'POST') {
      orders = freshOrders()
      return send(res, 204, 'text/plain', '')
    }
    if (url.pathname === '/app') {
      const role = user?.role ?? 'guest'
      const html =
        role === 'admin'
          ? adminPage(user!.name, orders, url.searchParams.get('env') === 'prod')
          : role === 'customer'
            ? customerPage(user!.name, orders)
            : guestPage()
      return send(res, 200, 'text/html; charset=utf-8', html)
    }
    if (url.pathname === '/api/my-orders') {
      if (!user || user.role === 'guest') return send(res, 401, 'application/json', '{"error":"unauthorized"}')
      return send(res, 200, 'application/json', JSON.stringify(orders.filter((o) => o.customer === user.name)))
    }
    if (url.pathname === '/api/admin/orders') {
      if (!user || user.role === 'guest') return send(res, 401, 'application/json', '{"error":"unauthorized"}')
      if (user.role !== 'admin') return send(res, 403, 'application/json', '{"error":"forbidden"}')
      return send(res, 200, 'application/json', JSON.stringify(orders))
    }
    const refund = /^\/api\/orders\/(\d+)\/refund$/.exec(url.pathname)
    if (refund && req.method === 'POST') {
      if (user?.role !== 'admin') return send(res, 403, 'application/json', '{"error":"forbidden"}')
      const order = orders.find((o) => o.id === Number(refund[1]))
      if (!order) return send(res, 404, 'application/json', '{"error":"not found"}')
      order.status = 'Refunded'
      return send(res, 200, 'application/json', JSON.stringify(order))
    }
    if (url.pathname === '/admin/billing') {
      if (user?.role !== 'admin') return send(res, 403, 'text/html; charset=utf-8', '<h1>403 Forbidden</h1>')
      return send(res, 200, 'text/html; charset=utf-8', '<h1>Billing</h1>')
    }
    return send(res, 404, 'text/plain', 'Not found')
  })
  let port: number
  try {
    port = await listen(server, 3000)
  } catch {
    port = await listen(server, 0)
  }
  return {
    port,
    base: `http://localhost:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}
