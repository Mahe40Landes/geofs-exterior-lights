// Build geofs-lights.user.js (Tampermonkey) and bookmarklet.txt from geofs-lights.js.
import { readFileSync, writeFileSync } from 'node:fs';
const dir = new URL('./', import.meta.url);
const src = readFileSync(new URL('geofs-lights.js', dir), 'utf8');
const version = (src.match(/var VERSION = '([^']+)'/) || [, '0.0.0'])[1];

const header = `// ==UserScript==
// @name         GeoFS Exterior Lights
// @namespace    https://github.com/
// @version      ${version}
// @description  Nav, beacon, strobe, landing, taxi, runway turnoff, ice, logo and emergency-exit lights for GeoFS, each switchable. F7 = panel, keys 1-9 = toggle.
// @author       you
// @match        https://www.geo-fs.com/geofs.php*
// @match        https://*.geo-fs.com/geofs.php*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

`;
writeFileSync(new URL('geofs-lights.user.js', dir), header + src);

// Bookmarklet: loads the add-on from a CDN copy of this file.
const url = 'https://cdn.jsdelivr.net/gh/Mahe40Landes/geofs-exterior-lights@main/geofs-lights.js';
const bm = 'javascript:' + encodeURIComponent(
  "(function(){var s=document.createElement('script');s.src='" + url + "';document.body.appendChild(s);})()"
);
writeFileSync(new URL('bookmarklet.txt', dir), bm + '\n');
console.log('built geofs-lights.user.js (v' + version + ') and bookmarklet.txt');
