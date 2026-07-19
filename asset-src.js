/** Resolve layout image src (path / _assets / data URI) to a browser-loadable URL. */

function isEmbeddedSrc(src) {
  const s = String(src || '');
  return s.startsWith('data:') || s.startsWith('blob:');
}

function isHttpSrc(src) {
  const s = String(src || '');
  return s.startsWith('http://') || s.startsWith('https://') || s.startsWith('/api/file');
}

function isPathSrc(src) {
  const s = String(src || '').trim();
  if (!s || isEmbeddedSrc(s) || isHttpSrc(s)) return false;
  return s.startsWith('_assets/') || s.startsWith('./') || !s.includes('://');
}

function resolveAssetUrl(src) {
  const s = String(src || '').trim();
  if (!s) return '';
  if (isEmbeddedSrc(s) || isHttpSrc(s)) return s;
  if (s.startsWith('/api/file?path=')) return s;
  return '/api/file?path=' + encodeURIComponent(s);
}

function campaignsRelativeSrc(publicPath) {
  const s = String(publicPath || '').trim().replace(/\\/g, '/');
  if (!s) return s;
  if (s.startsWith('_assets/')) return s;
  // Strip absolute campaigns root prefix when health has been loaded.
  const root = (window.state && state.campaignsRoot) ? String(state.campaignsRoot).replace(/\\/g, '/') : '';
  if (root && (s === root || s.startsWith(root + '/'))) {
    return s.slice(root.length).replace(/^\//, '');
  }
  return s;
}
