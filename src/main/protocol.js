// The media:// protocol is the only way the window reads files from disk:
//   media://track/<trackId>   an audio file from a scanned library
//   media://art/<file>        a cover from the art cache
//   media://img/<file>        a playlist picture or banner
// Tracks are addressed by id, so the page can never ask for an arbitrary path.

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { protocol } from 'electron';

const MIME = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

const SAFE_NAME = /^[\w-]+\.(jpg|png)$/;

export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

async function serveFile(filePath, request, cacheControl) {
  let stat;
  try {
    stat = await fs.promises.stat(filePath);
    if (!stat.isFile()) throw new Error('not a file');
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const size = stat.size;
  const headers = {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': cacheControl,
  };

  // Range requests are what make seeking inside a song work.
  const range = /^bytes=(\d*)-(\d*)$/.exec((request.headers.get('range') ?? '').trim());
  if (range && (range[1] !== '' || range[2] !== '')) {
    let start;
    let end;
    if (range[1] === '') {
      start = Math.max(0, size - Number(range[2]));
      end = size - 1;
    } else {
      start = Number(range[1]);
      end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
    }
    if (start > end || start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    return new Response(Readable.toWeb(fs.createReadStream(filePath, { start, end })), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${size}`,
        'Content-Length': String(end - start + 1),
      },
    });
  }

  if (size === 0) return new Response(null, { status: 200, headers: { ...headers, 'Content-Length': '0' } });
  return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  });
}

export function handleMediaProtocol({ library, artDir, imageDir }) {
  protocol.handle('media', async (request) => {
    let url;
    let name;
    try {
      url = new URL(request.url);
      name = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    } catch {
      return new Response('Bad request', { status: 400 });
    }

    if (url.hostname === 'track') {
      const filePath = library.pathFor(name);
      if (!filePath) return new Response('Not found', { status: 404 });
      return serveFile(filePath, request, 'no-cache');
    }
    if (url.hostname === 'art' || url.hostname === 'img') {
      if (!SAFE_NAME.test(name)) return new Response('Bad request', { status: 400 });
      const dir = url.hostname === 'art' ? artDir : imageDir;
      return serveFile(path.join(dir, name), request, 'max-age=31536000, immutable');
    }
    return new Response('Not found', { status: 404 });
  });
}
