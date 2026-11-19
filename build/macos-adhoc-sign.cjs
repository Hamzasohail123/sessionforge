// electron-builder afterPack hook: ad-hoc sign the macOS app ("codesign --sign -").
//
// Why: there is no Apple Developer ID yet, so the app can't be notarized. Apple Silicon refuses to
// run arm64 code without a valid signature, and repackaging Electron invalidates the signature it
// ships with, so an unsigned arm64 build shows "SessionForge is damaged". An ad-hoc signature is
// the minimum that lets users open it via System Settings → Privacy & Security → Open Anyway.
//
// electron-builder 24 has no built-in ad-hoc mode (mac.identity "-" is only honoured from v26), so
// electron-builder.yml sets mac.identity: null (skip its own signing) and runs this hook instead.
// Hardened runtime is off: it is only needed for notarization, and with an ad-hoc signature it
// would also need disable-library-validation to load Electron's frameworks.
//
// When a Developer ID is available: delete this hook, remove `identity: null`, turn hardenedRuntime
// back on with an entitlements file (at least com.apple.security.cs.allow-jit), and set notarize.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

exports.default = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appName = `${context.packager.appInfo.productFilename}.app`
  const appPath = path.join(context.appOutDir, appName)
  console.log(`  • ad-hoc signing ${appPath}`)
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
  execFileSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appPath], { stdio: 'inherit' })
}
