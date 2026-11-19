import { test, expect } from '@playwright/test'
import {
  GOOGLE_SIGNIN_AGENT_NOTE,
  isSignInHostUrl,
  matchGoogleSignIn,
  resolveTestGoogleOrigins
} from '../../src/main/google-signin/match'

const PROD = { testOrigins: [] as string[] }

// Committed and in-page URLs recorded by the spike (.agents/tasks/google-signin/spike/out/results.json)
const SPIKE = {
  rootIdentifier:
    'https://accounts.google.com/v3/signin/identifier?continue=https://accounts.google.com/&followup=https://accounts.google.com/&passive=1209600&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S739868966:1794942402607518',
  rootRejected:
    'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Faccounts.google.com%2F&dsh=S739868966%3A1794942402607518&epd=Ae_G1bdqgy6hkqFcYOQi3vGdQe2_bPTxdPCCuqidSvkg8e5vA-pFtKc8DA&flowEntry=ServiceLogin&flowName=GlifWebSignIn&followup=https%3A%2F%2Faccounts.google.com%2F&idnf=sessionforge.spike.nonexistent%40gmail.com&rhlk=le&rrk=46',
  gmailChain: [
    'https://mail.google.com/',
    'https://mail.google.com/mail/',
    'https://mail.google.com/mail/u/0/',
    'https://accounts.google.com/ServiceLogin?service=mail&passive=1209600&osid=1&continue=https://mail.google.com/mail/u/0/&followup=https://mail.google.com/mail/u/0/&emr=1',
    'https://accounts.google.com/v3/signin/identifier?continue=https://mail.google.com/mail/u/0/&emr=1&followup=https://mail.google.com/mail/u/0/&osid=1&passive=1209600&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S875987695:1794942419799425'
  ],
  gmailIdentifier:
    'https://accounts.google.com/v3/signin/identifier?continue=https://mail.google.com/mail/u/0/&emr=1&followup=https://mail.google.com/mail/u/0/&osid=1&passive=1209600&service=mail&flowName=GlifWebSignIn&flowEntry=ServiceLogin&dsh=S875987695:1794942419799425',
  gmailRejected:
    'https://accounts.google.com/v3/signin/rejected?continue=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F&dsh=S875987695%3A1794942419799425&emr=1&epd=Ae_G1beLEinbAjwoaCkQy1bHkj_jgm1Ubrl4QBbVGWHO8O-MkWxrnAF1iw&flowEntry=ServiceLogin&flowName=GlifWebSignIn&followup=https%3A%2F%2Fmail.google.com%2Fmail%2Fu%2F0%2F&idnf=sessionforge.spike.nonexistent%40gmail.com&osid=1&rhlk=le&rrk=46&service=mail',
  oauthStart:
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=407408718192.apps.googleusercontent.com&redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&response_type=code&scope=email&prompt=consent&access_type=offline',
  oauthIdentifier:
    'https://accounts.google.com/v3/signin/identifier?opparams=%253F&dsh=S2033753246%3A1794942435880471&access_type=offline&client_id=407408718192.apps.googleusercontent.com&o2v=2&prompt=consent&redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&response_type=code&scope=email&service=lso&flowName=GeneralOAuthFlow&continue=https%3A%2F%2Faccounts.google.com%2Fsignin%2Foauth%2Fv3%2Fconsent%3Fauthuser%3Dunknown%26part%3DAJi8hAMaxDjwJprU7a55KeuOTtNBO-iv410bDBhwSYtj7tPSK1JIsEyBC69-Zklhi9WvNQWJRxS_ZLEqwDs0IKK1Y2jC8lkJhWtkbZDYMCk46Disivdi4buy0RpXdA61rAPzyr1DaaTNIBZBxrs-oRJMdgdL4lF-zqBpfrkdqOuVv3IKpuzgFaC6jz36Y-9SKsjNpSl0aZow369LoAUsymI8GmhLWFp9zhKawtqkzMFC_D7Mhjsyvnlh3NmOEz3K7WKguR9CPa4yECa_VKmQAUuZwJiXYpYxRj4eEzAasshsp13NqBC7oeUAPyn9FXO0wR7EV0ZGzKjFSJ6Ncv5wxQLJH_WC4vxgRfG9B2Ugw2qyD8uHPCnpeX3Uf4VaccOqJFZ3TinA61OM8WZrRtTNX5TmErNfdwefeQudZewJbzBbZwfN7HRS5B8%26flowName%3DGeneralOAuthFlow%26as%3DS2033753246%253A1794942435880471%26client_id%3D407408718192.apps.googleusercontent.com%26requestPath%3D%252Fsignin%252Foauth%252Fv3%252Fconsent%23&app_domain=https%3A%2F%2Fdevelopers.google.com&rart=ANgoxcfiKwhAUAur1_oPOPG_m2hFn5PnhE2i0ZEOOGyhp0eKkLU6zQBV_kmQ20_izjQ2ez-m58XquYZCFlD-iSpGQ_8PszKrTAz-njPMM9BSiT3IBrE21Mk',
  oauthRejected:
    'https://accounts.google.com/v3/signin/rejected?access_type=offline&app_domain=https%3A%2F%2Fdevelopers.google.com&client_id=407408718192.apps.googleusercontent.com&continue=https%3A%2F%2Faccounts.google.com%2Fsignin%2Foauth%2Fv3%2Fconsent%3Fauthuser%3Dunknown%26part%3DAJi8hAMaxDjwJprU7a55KeuOTtNBO-iv410bDBhwSYtj7tPSK1JIsEyBC69-Zklhi9WvNQWJRxS_ZLEqwDs0IKK1Y2jC8lkJhWtkbZDYMCk46Disivdi4buy0RpXdA61rAPzyr1DaaTNIBZBxrs-oRJMdgdL4lF-zqBpfrkdqOuVv3IKpuzgFaC6jz36Y-9SKsjNpSl0aZow369LoAUsymI8GmhLWFp9zhKawtqkzMFC_D7Mhjsyvnlh3NmOEz3K7WKguR9CPa4yECa_VKmQAUuZwJiXYpYxRj4eEzAasshsp13NqBC7oeUAPyn9FXO0wR7EV0ZGzKjFSJ6Ncv5wxQLJH_WC4vxgRfG9B2Ugw2qyD8uHPCnpeX3Uf4VaccOqJFZ3TinA61OM8WZrRtTNX5TmErNfdwefeQudZewJbzBbZwfN7HRS5B8%26flowName%3DGeneralOAuthFlow%26as%3DS2033753246%253A1794942435880471%26client_id%3D407408718192.apps.googleusercontent.com%26requestPath%3D%252Fsignin%252Foauth%252Fv3%252Fconsent%23&dsh=S2033753246%3A1794942435880471&epd=Ae_G1bfLSqU99469RF1e4VbTeuj5dpL6yJ9Jryp_h_J9m4awEzycbZwDpQ&flowName=GeneralOAuthFlow&idnf=sessionforge.spike.nonexistent%40gmail.com&o2v=2&opparams=%253F&prompt=consent&rart=ANgoxcfiKwhAUAur1_oPOPG_m2hFn5PnhE2i0ZEOOGyhp0eKkLU6zQBV_kmQ20_izjQ2ez-m58XquYZCFlD-iSpGQ_8PszKrTAz-njPMM9BSiT3IBrE21Mk&redirect_uri=https%3A%2F%2Fdevelopers.google.com%2Foauthplayground&response_type=code&rhlk=le&rrk=46&scope=email&service=lso'
}
// Not saved by the spike (results.json has 3 flows): the start URLs of spike/main.js plus synthetic
// identifier URLs of the shape the saved flows commit
const UNSAVED = {
  youtubeStart:
    'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F',
  youtubeIdentifier:
    'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue&service=youtube&flowName=GlifWebSignIn&flowEntry=ServiceLogin',
  chooserStart: 'https://accounts.google.com/AccountChooser?continue=https%3A%2F%2Fmail.google.com%2F',
  chooserIdentifier:
    'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fmail.google.com%2F&flowName=GlifWebSignIn&flowEntry=AccountChooser'
}

test.describe('matchGoogleSignIn: spike URLs', () => {
  test('accounts.google.com root: identifier, then rejected in-page', () => {
    expect(matchGoogleSignIn(SPIKE.rootIdentifier, [], PROD)).toEqual({
      kind: 'google-account',
      rejected: false,
      origin: 'https://accounts.google.com',
      continueUrl: 'https://accounts.google.com/',
      appOrigin: null,
      service: null
    })
    const rej = matchGoogleSignIn(SPIKE.rootRejected, [], PROD)
    expect(rej).toMatchObject({ kind: 'google-account', rejected: true, continueUrl: 'https://accounts.google.com/' })
  })

  test('Gmail: continue and service, with the production chain starting on mail.google.com', () => {
    const m = matchGoogleSignIn(SPIKE.gmailIdentifier, SPIKE.gmailChain, PROD)
    expect(m).toEqual({
      kind: 'google-account',
      rejected: false,
      origin: 'https://accounts.google.com',
      continueUrl: 'https://mail.google.com/mail/u/0/',
      appOrigin: null,
      service: 'mail'
    })
    expect(matchGoogleSignIn(SPIKE.gmailRejected, SPIKE.gmailChain, PROD)).toMatchObject({
      kind: 'google-account',
      rejected: true,
      continueUrl: 'https://mail.google.com/mail/u/0/',
      service: 'mail'
    })
  })

  test('OAuth Playground: start, identifier and rejected are oauth with app_domain', () => {
    for (const url of [SPIKE.oauthStart, SPIKE.oauthIdentifier, SPIKE.oauthRejected]) {
      const m = matchGoogleSignIn(url, [SPIKE.oauthStart], PROD)
      expect(m, url).toMatchObject({ kind: 'oauth', continueUrl: null, appOrigin: 'https://developers.google.com' })
    }
    expect(matchGoogleSignIn(SPIKE.oauthIdentifier, [], PROD)?.service).toBe('lso')
    expect(matchGoogleSignIn(SPIKE.oauthRejected, [], PROD)?.rejected).toBe(true)
    // Start URL only has redirect_uri → its origin
    expect(matchGoogleSignIn(SPIKE.oauthStart, [], PROD)?.appOrigin).toBe('https://developers.google.com')
  })

  test('YouTube and AccountChooser (not saved by the spike: start URLs plus synthetic identifiers)', () => {
    expect(matchGoogleSignIn(UNSAVED.youtubeStart, [], PROD)).toMatchObject({
      kind: 'google-account',
      service: 'youtube',
      continueUrl: 'https://www.youtube.com/signin?action_handle_signin=true&next=https%3A%2F%2Fwww.youtube.com%2F'
    })
    expect(matchGoogleSignIn(UNSAVED.youtubeIdentifier, [UNSAVED.youtubeStart], PROD)).toMatchObject({
      kind: 'google-account',
      service: 'youtube',
      continueUrl: 'https://www.youtube.com/signin?action_handle_signin=true'
    })
    expect(matchGoogleSignIn(UNSAVED.chooserStart, [], PROD)).toMatchObject({
      kind: 'google-account',
      continueUrl: 'https://mail.google.com/'
    })
    expect(matchGoogleSignIn(UNSAVED.chooserIdentifier, [UNSAVED.chooserStart], PROD)?.continueUrl).toBe(
      'https://mail.google.com/'
    )
  })
})

test('classic paths match', () => {
  const cases: Array<[string, 'google-account' | 'oauth']> = [
    ['https://accounts.google.com/ServiceLogin', 'google-account'],
    ['https://accounts.google.com/servicelogin?continue=https://mail.google.com/', 'google-account'],
    ['https://accounts.google.com/AccountChooser', 'google-account'],
    ['https://accounts.google.com/AddSession', 'google-account'],
    ['https://accounts.google.com/signin/v2/identifier', 'google-account'],
    ['https://accounts.google.com/v3/signin/challenge/pwd', 'google-account'],
    ['https://accounts.google.com/', 'google-account'],
    ['https://accounts.google.com./ServiceLogin', 'google-account'],
    ['https://accounts.google.com/o/oauth2/v2/auth', 'oauth'],
    ['https://accounts.google.com/o/oauth2/auth?client_id=x', 'oauth'],
    ['https://accounts.google.com/signin/oauth/v3/consent', 'oauth'],
    ['https://accounts.google.com/gsi/select?client_id=x', 'oauth']
  ]
  for (const [url, kind] of cases) expect(matchGoogleSignIn(url, [], PROD)?.kind, url).toBe(kind)
})

test('chain: an identifier URL without OAuth parameters is oauth when the chain started at /o/oauth2/', () => {
  const chain = ['https://accounts.google.com/o/oauth2/v2/auth?client_id=x', 'https://accounts.google.com/v3/signin/identifier']
  expect(matchGoogleSignIn('https://accounts.google.com/v3/signin/identifier', chain, PROD)?.kind).toBe('oauth')
  expect(matchGoogleSignIn('https://accounts.google.com/v3/signin/identifier', [], PROD)?.kind).toBe('google-account')
  // A chain URL on another host does not count
  expect(
    matchGoogleSignIn('https://accounts.google.com/v3/signin/identifier', ['https://evil.example/o/oauth2/v2/auth'], PROD)
      ?.kind
  ).toBe('google-account')
  // continue pointing at the OAuth consent page
  expect(
    matchGoogleSignIn(
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Faccounts.google.com%2Fsignin%2Foauth%2Fv3%2Fconsent',
      [],
      PROD
    )?.kind
  ).toBe('oauth')
})

test('negatives: lookalikes, http, ports, credentials, other Google hosts and non-sign-in paths', () => {
  const urls = [
    'http://accounts.google.com/ServiceLogin',
    'http://accounts.google.com/',
    'https://accounts.google.com:8443/ServiceLogin',
    'https://accounts.google.com.evil.com/ServiceLogin',
    'https://accounts-google.com/ServiceLogin',
    'https://accounts.google.co/ServiceLogin',
    'https://evil.com/accounts.google.com/ServiceLogin',
    'https://evil.com/?next=https://accounts.google.com/',
    'https://evil.com/?u=accounts.google.com',
    'https://accounts.google.com@evil.com/',
    'https://user:pw@accounts.google.com/',
    'https://xn--ccounts-google-com-9xb.com/ServiceLogin',
    'https://xn--accunts-0ve.google.com/ServiceLogin',
    'https://accounts.goog1e.com/ServiceLogin',
    'https://myaccount.google.com/',
    'https://www.google.com/account/about/',
    'https://mail.google.com/mail/u/0/',
    'https://accounts.google.com/SignOutOptions',
    'https://accounts.google.com/Logout',
    'https://accounts.google.com/CheckCookie?continue=https://mail.google.com/',
    'https://accounts.google.com/ListAccounts',
    'https://accounts.google.com/RotateCookies',
    'https://accounts.google.com/lifecycle/steps/signup/name',
    'https://accounts.google.com/embedded/setup/v2/android',
    'https://accounts.google.com/speedbump/idvreenable',
    'javascript:alert(1)',
    'chrome://settings',
    'not a url',
    ''
  ]
  for (const url of urls) {
    expect(matchGoogleSignIn(url, [], PROD), url).toBeNull()
  }
  expect(isSignInHostUrl('http://accounts.google.com/', PROD)).toBe(false)
  expect(isSignInHostUrl('https://accounts.google.com:443/', PROD)).toBe(true)
  expect(isSignInHostUrl('https://ACCOUNTS.GOOGLE.COM/', PROD)).toBe(true)
})

test('continue: only Google-owned https targets (or the test origin) are kept', () => {
  const m = (cont: string, testOrigins: string[] = []) =>
    matchGoogleSignIn(`https://accounts.google.com/ServiceLogin?continue=${encodeURIComponent(cont)}`, [], { testOrigins })
      ?.continueUrl
  expect(m('https://mail.google.com/mail/')).toBe('https://mail.google.com/mail/')
  expect(m('https://www.google.co.uk/')).toBe('https://www.google.co.uk/')
  expect(m('https://bank.example/')).toBeNull()
  expect(m('http://mail.google.com/')).toBeNull()
  expect(m('https://google.com.evil.com/')).toBeNull()
  expect(m('https://u:p@mail.google.com/')).toBeNull()
  expect(m('https://mail.google.com/' + 'a'.repeat(4100))).toBeNull()
  expect(m('http://localhost:4000/page')).toBeNull()
  expect(m('http://localhost:4000/page', ['http://localhost:4000'])).toBe('http://localhost:4000/page')
})

test('service is kept only when it is a short token', () => {
  const s = (v: string) => matchGoogleSignIn(`https://accounts.google.com/ServiceLogin?service=${encodeURIComponent(v)}`, [], PROD)?.service
  expect(s('mail')).toBe('mail')
  expect(s('a b')).toBeNull()
  expect(s('x'.repeat(41))).toBeNull()
})

test('appOrigin: app_domain, else redirect_uri, launchable http(s) only', () => {
  const a = (q: string) => matchGoogleSignIn(`https://accounts.google.com/o/oauth2/v2/auth?${q}`, [], PROD)?.appOrigin
  expect(a('app_domain=https%3A%2F%2Fapp.example&redirect_uri=https%3A%2F%2Fother.example%2Fcb')).toBe('https://app.example')
  expect(a('redirect_uri=https%3A%2F%2Fother.example%2Fcb')).toBe('https://other.example')
  expect(a('redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fcb')).toBe('http://localhost:3000')
  expect(a('redirect_uri=postmessage')).toBeNull()
  expect(a('redirect_uri=storagerelay%3A%2F%2Fhttps%2Fapp.example')).toBeNull()
  expect(a('redirect_uri=http%3A%2F%2F192.168.1.10%2Fcb')).toBeNull()
})

test('test origin matches only when passed', () => {
  const local = 'http://localhost:41234'
  const url = `${local}/v3/signin/identifier?continue=${encodeURIComponent(local + '/page?label=A')}`
  expect(matchGoogleSignIn(url, [], PROD)).toBeNull()
  expect(matchGoogleSignIn(url, [], { testOrigins: [local] })).toMatchObject({
    kind: 'google-account',
    origin: local,
    continueUrl: `${local}/page?label=A`
  })
  expect(matchGoogleSignIn('http://127.0.0.1:41234/v3/signin/identifier', [], { testOrigins: [local] })).toBeNull()
})

test('resolveTestGoogleOrigins: only with SESSIONFORGE_E2E=1 and a loopback http origin', () => {
  const errors: unknown[] = []
  const orig = console.error
  console.error = (...a: unknown[]) => void errors.push(a)
  try {
    expect(resolveTestGoogleOrigins({ SESSIONFORGE_TEST_GOOGLE_ORIGIN: 'http://localhost:1234' })).toEqual([])
    expect(
      resolveTestGoogleOrigins({ SESSIONFORGE_E2E: '1', SESSIONFORGE_TEST_GOOGLE_ORIGIN: 'http://localhost:1234' })
    ).toEqual(['http://localhost:1234'])
    expect(
      resolveTestGoogleOrigins({ SESSIONFORGE_E2E: '1', SESSIONFORGE_TEST_GOOGLE_ORIGIN: 'http://127.0.0.1:99' })
    ).toEqual(['http://127.0.0.1:99'])
    expect(resolveTestGoogleOrigins({ SESSIONFORGE_E2E: '1' })).toEqual([])
    expect(errors).toHaveLength(0)
    for (const bad of [
      'https://localhost:1234',
      'http://evil.example:1234',
      'http://localhost:1234/path',
      'http://localhost',
      'https://accounts.google.com'
    ]) {
      expect(resolveTestGoogleOrigins({ SESSIONFORGE_E2E: '1', SESSIONFORGE_TEST_GOOGLE_ORIGIN: bad }), bad).toEqual([])
    }
    expect(errors.length).toBe(5)
  } finally {
    console.error = orig
  }
})

test('GOOGLE_SIGNIN_AGENT_NOTE names the exception and the button', () => {
  expect(GOOGLE_SIGNIN_AGENT_NOTE).toContain('never ask the user to log in')
  expect(GOOGLE_SIGNIN_AGENT_NOTE).toContain('Sign in with Chrome')
})
