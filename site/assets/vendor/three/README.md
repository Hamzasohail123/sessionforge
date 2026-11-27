# three.js (vendored)

- Package: `three@0.187.0` from npm (tarball sha256 `ff540832ded0cfe919764d24a3d88f3e2a05f23303f876423e4f893841e90728`).
- License: MIT, see `LICENSE` (copied from the package).
- `three.module.min.js` (sha256 `e0df03ddbddcf65926df5b79a04724d1a05af235d6af8b4113767f9107a8c233`): three 0.187 no longer ships a minified
  module build, so this is the package's own `build/three.module.js` (which imports `build/three.core.js`) bundled into one
  file and minified, with no source changes:

  ```sh
  npm pack three@0.187.0 && tar xzf three-0.187.0.tgz
  npx esbuild package/build/three.module.js --bundle --minify --format=esm --legal-comments=inline --outfile=three.module.min.js
  ```
  (esbuild 0.21.5, the version in the app's devDependencies.)

Only the website's hero animation (`site/assets/js/hero.js`) loads it, from this folder. It is not a dependency of the app.
