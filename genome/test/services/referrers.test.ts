/**
 * The referring site of a visit (plan CUSTOMER INTELLIGENCE of 2026-10-08, §3.4 A.5 item 3 and A.15 « referrers.test.ts »,
 * step 4.2; services/referrers.ts): the family map, `www.` removed, the app's own host ignored, theorbes.com kept,
 * `android-app://` hosts, junk refused, only the host ever kept.
 */
import { describe, expect, it } from 'vitest';
import { foldSite, REFERRER_FAMILIES, referrerHost, SITE_RE } from '../../src/server/services/referrers.js';

const OWN = 'verify.theorbes.com';

describe('referrerHost', () => {
  it('folds the known families into one site', () => {
    for (const [raw, site] of [
      ['https://l.instagram.com/?u=https%3A%2F%2Fverify.theorbes.com%2Fgo%2Fx&e=AT0', 'instagram.com'],
      ['https://www.instagram.com/orbes/', 'instagram.com'],
      ['https://instagram.com/', 'instagram.com'],
      ['android-app://com.instagram.android', 'instagram.com'],
      ['android-app://com.instagram.android/', 'instagram.com'],
      ['https://t.co/AbCd123', 'x.com'],
      ['https://twitter.com/orbes', 'x.com'],
      ['https://x.com/orbes', 'x.com'],
      ['https://lm.facebook.com/l.php?u=x', 'facebook.com'],
      ['https://m.facebook.com/', 'facebook.com'],
      ['https://l.facebook.com/', 'facebook.com'],
      ['https://www.facebook.com/', 'facebook.com'],
      ['https://www.google.com/', 'google.com'],
      ['https://www.google.fr/', 'google.com'],
      ['https://google.co.uk/search?q=orbes', 'google.com'],
      ['https://www.google.com.au/', 'google.com'],
      ['https://news.google.com/', 'google.com'],
      ['https://youtu.be/xyz', 'youtube.com'],
      ['https://m.youtube.com/watch?v=1', 'youtube.com'],
      ['https://pin.it/abc', 'pinterest.com'],
      ['https://lnkd.in/abc', 'linkedin.com'],
      ['https://wa.me/33600000000', 'whatsapp.com'],
      ['https://out.reddit.com/t3_x', 'reddit.com'],
      ['https://old.reddit.com/r/watches', 'reddit.com'],
    ] as const) {
      expect(referrerHost(raw, OWN), raw).toBe(site);
    }
    for (const [host, site] of Object.entries(REFERRER_FAMILIES)) expect(foldSite(host), host).toBe(site);
  });

  it('keeps any other host in lower case, without www. nor its port, and only its host', () => {
    expect(referrerHost('https://WWW.Vogue.FR/mode/article-1?utm_source=x#top', OWN)).toBe('vogue.fr');
    expect(referrerHost('http://blog.example.com:8080/a/b', OWN)).toBe('blog.example.com');
    expect(referrerHost('https://example.com./', OWN)).toBe('example.com');
    expect(referrerHost('android-app://com.zhiliaoapp.musically/', OWN)).toBe('com.zhiliaoapp.musically');
    // An international name reads as its ASCII form.
    expect(referrerHost('https://bücher.example/', OWN)).toBe('xn--bcher-kva.example');
  });

  it('keeps theorbes.com, the brand\'s site, and ignores the app\'s own host (an inner move)', () => {
    expect(referrerHost('https://theorbes.com/', OWN)).toBe('theorbes.com');
    expect(referrerHost('https://www.theorbes.com/collection', OWN)).toBe('theorbes.com');
    expect(referrerHost('https://verify.theorbes.com/verify/releases', OWN)).toBeNull();
    expect(referrerHost('https://VERIFY.THEORBES.COM/', OWN)).toBeNull();
    expect(referrerHost('https://verify.orbes.test/verify', 'verify.orbes.test')).toBeNull();
  });

  it('refuses junk: no address, another scheme, no host, too long, a host the site column refuses', () => {
    for (const raw of [
      undefined,
      null,
      42,
      '',
      'instagram.com',
      'not a url',
      'javascript:alert(1)',
      'data:text/html,<script>',
      'file:///etc/passwd',
      'ftp://example.com/',
      'mailto:a@example.com',
      'https://',
      `https://example.com/${'a'.repeat(500)}`,
      'https://[::1]/',
      'https://192.168.0.1_/',
    ]) {
      expect(referrerHost(raw, OWN), String(raw)).toBeNull();
    }
    // Whatever is kept fits the column.
    for (const raw of ['https://a.b', 'https://a-b.example.org', 'android-app://com.example.app']) expect(SITE_RE.test(referrerHost(raw, OWN)!), raw).toBe(true);
  });
});
