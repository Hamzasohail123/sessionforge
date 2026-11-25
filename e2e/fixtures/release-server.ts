// Stand-in for api.github.com/repos/…/releases/latest; the app reaches it through
// SESSIONFORGE_TEST_UPDATE_URL, which main honours only under SESSIONFORGE_E2E=1.
import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { RELEASES_PAGE_URL } from '../../src/main/constants'

export type ReleaseReply = { tag: string; htmlUrl?: string } | { status: number } | 'bad-json' | 'drop'

export interface ReleaseServer {
  /** http://127.0.0.1:<port>/releases/latest */
  url: string
  /** Every request to /releases/latest, oldest first */
  hits: Array<{ headers: IncomingHttpHeaders }>
  set(reply: ReleaseReply): void
  close(): Promise<void>
}

export async function startReleaseServer(initial: ReleaseReply = { tag: 'v0.1.0' }): Promise<ReleaseServer> {
  let reply = initial
  const hits: ReleaseServer['hits'] = []
  const server = createServer((req, res) => {
    if (req.url !== '/releases/latest') {
      res.writeHead(404).end()
      return
    }
    hits.push({ headers: req.headers })
    if (reply === 'drop') {
      req.socket.destroy()
      return
    }
    if (reply === 'bad-json') {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end('<html>not json')
      return
    }
    if ('status' in reply) {
      res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'stub error' }))
      return
    }
    const body = {
      tag_name: reply.tag,
      html_url: reply.htmlUrl ?? `${RELEASES_PAGE_URL}/tag/${reply.tag}`,
      draft: false,
      prerelease: false
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/releases/latest`,
    hits,
    set: (r) => void (reply = r),
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}
