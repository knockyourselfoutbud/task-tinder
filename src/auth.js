// Passcode login with an HMAC-signed session cookie.
// One user (you). Set APP_PASSCODE (and optionally SESSION_SECRET) as Worker secrets.

const COOKIE = 'tt_session';
const MAX_AGE = 60 * 60 * 24 * 90; // 90 days

const enc = new TextEncoder();

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

function secretOf(env) {
  return env.SESSION_SECRET || `tt:${env.APP_PASSCODE}`;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

export function cookieHeader(name, value, maxAge, secure = true) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export async function isAuthed(request, env) {
  const raw = getCookie(request, COOKIE);
  if (!raw) return false;
  const [exp, sig] = raw.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  return timingSafeEqual(sig, await hmac(secretOf(env), `session:${exp}`));
}

export async function checkPasscode(env, attempt) {
  if (!env.APP_PASSCODE) return false;
  // Compare HMACs so the comparison is constant-time regardless of length
  const s = secretOf(env);
  return timingSafeEqual(await hmac(s, `pc:${attempt || ''}`), await hmac(s, `pc:${env.APP_PASSCODE}`));
}

export async function sessionCookie(env, secure) {
  const exp = Math.floor(Date.now() / 1000) + MAX_AGE;
  const sig = await hmac(secretOf(env), `session:${exp}`);
  return cookieHeader(COOKIE, `${exp}.${sig}`, MAX_AGE, secure);
}

export function clearSessionCookie(secure) {
  return cookieHeader(COOKIE, '', 0, secure);
}

export function randomState() {
  const b = new Uint8Array(18);
  crypto.getRandomValues(b);
  return b64url(b);
}
