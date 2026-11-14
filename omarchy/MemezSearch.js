// Library reading and search for the Omarchy plugin. Pure functions, no QML,
// so the same file runs in the shell and in the repo's tests (via
// module.exports at the bottom). It mirrors the app's search
// (src/renderer/src/lib/search.ts): tags count most, then title, then the
// text read from the meme; each word matches on its own, memes that match
// more words come first, and small typos are forgiven.
//
// library.json is written by the Memez app. The shell is unsandboxed and
// long-lived, so everything read from it is checked and bounded here.

var MEDIA_EXTS = ["png", "jpg", "webp", "gif", "mp4", "webm"]
var ID_PATTERN = /^[a-f0-9]{16}$/
var MAX_MEMES = 20000
var MAX_TITLE = 200
var MAX_TAGS = 50
var MAX_TAG = 60
var MAX_OCR = 2000
var MAX_RECENT = 500
var WEIGHTS = { tags: 3, title: 2, ocrText: 1 }

function boundedString(value, max) {
  return typeof value === "string" ? value.slice(0, max) : ""
}

function isoOrEmpty(value) {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(value) ? value : ""
}

function cleanMeme(value) {
  if (!value || typeof value !== "object") return null
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) return null
  if (MEDIA_EXTS.indexOf(value.ext) === -1) return null
  var tags = []
  if (Array.isArray(value.tags)) {
    for (var i = 0; i < value.tags.length && tags.length < MAX_TAGS; i++) {
      var tag = boundedString(value.tags[i], MAX_TAG).trim().toLowerCase()
      if (tag) tags.push(tag)
    }
  }
  return {
    id: value.id,
    ext: value.ext,
    title: boundedString(value.title, MAX_TITLE).trim(),
    tags: tags,
    ocrText: boundedString(value.ocrText, MAX_OCR),
    addedAt: isoOrEmpty(value.addedAt),
    usedAt: isoOrEmpty(value.usedAt)
  }
}

// The memes in a library.json text. Throws on a file that is not a library,
// so the overlay can say so instead of showing an empty library.
function parseLibrary(raw) {
  var data = JSON.parse(String(raw))
  if (!data || !Array.isArray(data.memes)) throw new Error("not a Memez library file")
  var out = []
  for (var i = 0; i < data.memes.length && out.length < MAX_MEMES; i++) {
    var meme = cleanMeme(data.memes[i])
    if (meme) out.push(meme)
  }
  return out
}

// The plugin's own record of memes pasted from the overlay: { id: isoTime }.
// The app owns library.json, so the plugin never writes to it.
function parseRecent(raw) {
  var out = {}
  try {
    var data = JSON.parse(String(raw || "{}"))
    if (!data || typeof data !== "object" || Array.isArray(data)) return out
    var count = 0
    for (var id in data) {
      if (count >= MAX_RECENT) break
      if (ID_PATTERN.test(id) && isoOrEmpty(data[id])) {
        out[id] = data[id]
        count++
      }
    }
  } catch (e) {}
  return out
}

// Records a use and keeps the newest MAX_RECENT entries.
function recordUse(recent, id, at) {
  var entries = [[id, at]]
  for (var key in recent) if (key !== id) entries.push([key, recent[key]])
  entries.sort(function(a, b) { return a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0 })
  var out = {}
  for (var i = 0; i < entries.length && i < MAX_RECENT; i++) out[entries[i][0]] = entries[i][1]
  return out
}

function lastUse(meme, recent) {
  var times = [meme.addedAt, meme.usedAt, (recent && recent[meme.id]) || ""]
  var best = ""
  for (var i = 0; i < times.length; i++) if (times[i] > best) best = times[i]
  return best
}

// Most recently used or added first, like the app's popup before typing.
function byRecentUse(memes, recent) {
  return memes.slice().sort(function(a, b) {
    var x = lastUse(a, recent)
    var y = lastUse(b, recent)
    return x < y ? 1 : x > y ? -1 : 0
  })
}

// Edit distance with adjacent swaps, stopping early past `max`.
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1
  var prev2 = []
  var prev = []
  for (var j = 0; j <= b.length; j++) prev.push(j)
  for (var i = 1; i <= a.length; i++) {
    var row = [i]
    var rowMin = i
    for (var k = 1; k <= b.length; k++) {
      var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1
      var value = Math.min(prev[k] + 1, row[k - 1] + 1, prev[k - 1] + cost)
      if (i > 1 && k > 1 && a.charAt(i - 1) === b.charAt(k - 2) && a.charAt(i - 2) === b.charAt(k - 1))
        value = Math.min(value, prev2[k - 2] + 1)
      row.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    prev2 = prev
    prev = row
  }
  return prev[b.length]
}

function tokens(text) {
  // Split on whitespace and punctuation. No \p{...} classes: the shell's JS
  // engine does not support them.
  return String(text || "").toLowerCase().split(/[\s.,!?;:"()\[\]{}\/\\|_*#@~`+=<>-]+/).filter(Boolean)
}

// How well `word` matches `text`, from 0 (not at all) to 1 (a whole word).
function matchQuality(word, text) {
  var lower = String(text || "").toLowerCase()
  if (!lower) return 0
  var parts = tokens(lower)
  var best = 0
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i]
    if (part === word) return 1
    if (part.indexOf(word) === 0) best = Math.max(best, 0.85)
    else if (word.length >= 4) {
      var allowed = word.length >= 7 ? 2 : 1
      // Compare with the token, and with its start for a typo in a prefix.
      var d = Math.min(editDistance(word, part, allowed), editDistance(word, part.slice(0, word.length), allowed))
      if (d <= allowed) best = Math.max(best, d === 1 ? 0.6 : 0.45)
    }
  }
  if (best === 0 && word.length >= 3 && lower.indexOf(word) !== -1) best = 0.5
  return best
}

function wordScore(meme, word) {
  var best = WEIGHTS.title * matchQuality(word, meme.title)
  for (var i = 0; i < meme.tags.length; i++)
    best = Math.max(best, WEIGHTS.tags * matchQuality(word, meme.tags[i]))
  if (best < WEIGHTS.ocrText) best = Math.max(best, WEIGHTS.ocrText * matchQuality(word, meme.ocrText))
  return best
}

// Memes matching `query`, best first. No query gives recent memes first.
function search(memes, query, recent, limit) {
  var max = limit === undefined || limit === null ? 500 : Math.max(0, Number(limit) || 0)
  var words = tokens(query)
  if (words.length === 0) return byRecentUse(memes, recent).slice(0, max)

  var scored = []
  for (var i = 0; i < memes.length; i++) {
    var hits = 0
    var total = 0
    for (var w = 0; w < words.length; w++) {
      var score = wordScore(memes[i], words[w])
      if (score > 0) {
        hits++
        total += score
      }
    }
    if (hits > 0) scored.push({ meme: memes[i], hits: hits, total: total, used: lastUse(memes[i], recent) })
  }
  scored.sort(function(a, b) {
    return b.hits - a.hits || b.total - a.total || (a.used < b.used ? 1 : a.used > b.used ? -1 : 0)
  })
  var out = []
  for (var j = 0; j < scored.length && j < max; j++) out.push(scored[j].meme)
  return out
}

// The library folder from the plugin's config.json, or "" to use the default.
// Only an absolute path of sane length is accepted.
function parseConfigRoot(raw) {
  try {
    var data = JSON.parse(String(raw || ""))
    var root = data && typeof data.libraryRoot === "string" ? data.libraryRoot : ""
    if (root.length > 0 && root.length <= 4096 && root.charAt(0) === "/" && !/[\n\r\0]/.test(root))
      return root.replace(/\/+$/, "") || "/"
  } catch (e) {}
  return ""
}

function mediaKind(ext) {
  if (ext === "gif") return "gif"
  if (ext === "mp4" || ext === "webm") return "video"
  return "image"
}

if (typeof module !== "undefined") {
  module.exports = {
    parseLibrary: parseLibrary,
    parseRecent: parseRecent,
    recordUse: recordUse,
    byRecentUse: byRecentUse,
    editDistance: editDistance,
    matchQuality: matchQuality,
    search: search,
    parseConfigRoot: parseConfigRoot,
    mediaKind: mediaKind
  }
}
