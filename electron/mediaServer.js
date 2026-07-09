const http = require('http')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let server = null
let port = null
let starting = null
const tokenToPath = new Map()
const pathToToken = new Map()

function contentTypeForPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.mp4': return 'video/mp4'
    case '.m4v': return 'video/x-m4v'
    case '.mov': return 'video/quicktime'
    case '.webm': return 'video/webm'
    case '.mkv': return 'video/x-matroska'
    case '.avi': return 'video/x-msvideo'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    case '.ogg': return 'audio/ogg'
    case '.pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Range, Content-Type, Accept',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range, Content-Type',
    ...extra,
  }
}

function sendFile(req, res, filePath) {
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    res.writeHead(404).end()
    return
  }

  const fileSize = stat.size
  const contentType = contentTypeForPath(filePath)
  const range = req.headers.range

  if (!range) {
    res.writeHead(200, corsHeaders({
      'Accept-Ranges': 'bytes',
      'Content-Length': fileSize,
      'Content-Type': contentType,
    }))
    if (req.method === 'HEAD') return res.end()
    fs.createReadStream(filePath).pipe(res)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match) {
    res.writeHead(416, corsHeaders({ 'Content-Range': `bytes */${fileSize}` })).end()
    return
  }

  let start
  let end
  if (match[1] === '' && match[2] !== '') {
    const suffixLength = Number(match[2])
    start = Math.max(fileSize - suffixLength, 0)
    end = fileSize - 1
  } else {
    start = match[1] === '' ? 0 : Number(match[1])
    end = match[2] === '' ? fileSize - 1 : Number(match[2])
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start < 0 || end >= fileSize) {
    res.writeHead(416, corsHeaders({
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${fileSize}`,
    })).end()
    return
  }

  res.writeHead(206, corsHeaders({
    'Accept-Ranges': 'bytes',
    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
    'Content-Length': end - start + 1,
    'Content-Type': contentType,
  }))
  if (req.method === 'HEAD') return res.end()
  fs.createReadStream(filePath, { start, end }).pipe(res)
}

function handleRequest(req, res) {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders()).end()
      return
    }
    const url = new URL(req.url, 'http://127.0.0.1')
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts[0] !== 'media' || !parts[1]) {
      res.writeHead(404).end()
      return
    }

    const filePath = tokenToPath.get(parts[1])
    if (!filePath || !fs.existsSync(filePath)) {
      res.writeHead(404).end()
      return
    }

    sendFile(req, res, filePath)
  } catch (e) {
    console.error('[mediaServer] request failed:', e?.message || e)
    res.writeHead(500).end()
  }
}

function startMediaServer() {
  if (server && port) return Promise.resolve(port)
  if (starting) return starting

  starting = new Promise((resolve, reject) => {
    server = http.createServer(handleRequest)
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      port = server.address().port
      resolve(port)
    })
  }).finally(() => {
    starting = null
  })

  return starting
}

async function getMediaUrl(filePath) {
  const activePort = await startMediaServer()
  const normalized = path.resolve(filePath)
  let token = pathToToken.get(normalized)
  if (!token) {
    token = crypto.randomBytes(24).toString('hex')
    pathToToken.set(normalized, token)
    tokenToPath.set(token, normalized)
  }
  return `http://127.0.0.1:${activePort}/media/${token}/${encodeURIComponent(path.basename(normalized))}`
}

function stopMediaServer() {
  if (!server) return
  server.close()
  server = null
  port = null
  starting = null
  tokenToPath.clear()
  pathToToken.clear()
}

module.exports = { getMediaUrl, startMediaServer, stopMediaServer }
