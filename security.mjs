export function validRequest(req, expectedOrigin, expectedToken) {
  const url = new URL(req.url, expectedOrigin);
  if (req.headers.host !== new URL(expectedOrigin).host) return false;
  if ((req.headers.origin && req.headers.origin !== expectedOrigin) || req.headers['sec-fetch-site'] === 'cross-site') return false;
  return url.searchParams.get('key') === expectedToken;
}
