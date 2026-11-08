// Shared by the Internet Archive extensions. scripts/build-official-repo.mjs inlines it where a
// script says //@include ia-shared.inc.js.
var IA = "https://archive.org";
var OPEN_LICENSE = "licenseurl:(*creativecommons.org* OR *publicdomain*)";

function text(value) {
  return Array.isArray(value) ? String(value[0] || "") : value == null ? "" : String(value);
}
function list(value) {
  return Array.isArray(value) ? value.map(String) : value ? String(value).split(/;\s*/) : [];
}
function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim().slice(0, 4000);
}
/** "596.5" (seconds) or "12:34" / "1:02:03" -> ms; null when unknown. */
function durationMs(value) {
  var n = Number(value);
  if (n > 0) return Math.round(n * 1000);
  var parts = String(value || "").split(":").map(Number);
  if (parts.length < 2 || parts.some(function (x) { return !(x >= 0); })) return null;
  return parts.reduce(function (total, x) { return total * 60 + x; }, 0) * 1000;
}

function iaSearch(query, filter, offset, limit, sort) {
  var rows = Math.min(Math.max(limit || 30, 1), 50);
  var page = Math.floor((offset || 0) / rows) + 1;
  var cleaned = String(query || "").replace(/[()\[\]{}:"\\^~*?!]/g, " ").trim();
  var q = "(" + filter + ") AND " + OPEN_LICENSE + (cleaned ? " AND (" + cleaned + ")" : "");
  var url = IA + "/advancedsearch.php?q=" + encodeURIComponent(q) +
    "&fl%5B%5D=identifier&fl%5B%5D=title&fl%5B%5D=year&fl%5B%5D=description&fl%5B%5D=subject" +
    "&rows=" + rows + "&page=" + page + "&output=json" + (sort ? "&sort%5B%5D=" + encodeURIComponent(sort) : "");
  var response = fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Internet Archive search failed: HTTP " + response.status);
  return JSON.parse(response.body).response.docs.map(function (doc) {
    return AnimeTitle({
      id: doc.identifier,
      englishName: text(doc.title) || doc.identifier,
      year: Number(text(doc.year)) || null,
      posterUrl: IA + "/services/img/" + encodeURIComponent(doc.identifier),
      description: stripHtml(text(doc.description)),
      genres: list(doc.subject).slice(0, 6),
      pageUrl: IA + "/details/" + encodeURIComponent(doc.identifier),
    });
  });
}

/** The item's metadata, refused when it carries no open license. */
function iaItem(id) {
  var response = fetch(IA + "/metadata/" + encodeURIComponent(id), { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Internet Archive item failed: HTTP " + response.status);
  var item = JSON.parse(response.body);
  if (!item || !item.metadata) throw new Error("Internet Archive item not found: " + id);
  if (!/creativecommons\.org|publicdomain/i.test(text(item.metadata.licenseurl))) {
    throw new Error("This item has no open license, so it is not offered");
  }
  return item;
}

function iaTitle(item) {
  var m = item.metadata;
  return AnimeTitle({
    id: m.identifier,
    englishName: text(m.title) || m.identifier,
    year: Number(String(text(m.year) || text(m.date)).slice(0, 4)) || null,
    posterUrl: IA + "/services/img/" + encodeURIComponent(m.identifier),
    description: (stripHtml(text(m.description)) + "\n\nLicense: " + text(m.licenseurl)).trim(),
    genres: list(m.subject).slice(0, 8),
    pageUrl: IA + "/details/" + encodeURIComponent(m.identifier),
  });
}

function iaFiles(item, pattern) {
  return (item.files || [])
    .filter(function (f) { return pattern.test(f.name); })
    .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
}

function iaDownloadUrl(id, name) {
  return IA + "/download/" + encodeURIComponent(id) + "/" + name.split("/").map(encodeURIComponent).join("/");
}

// Openly licensed audio from the Internet Archive: ASMR, sleep and relaxation sounds, and old-time
// radio drama. Matched on the item's subject tags, not on free text, to keep unrelated uploads out.
var FILTER = "mediatype:audio AND subject:(asmr OR \"sleep sounds\" OR relaxation OR meditation OR \"audio drama\" OR \"old time radio\") AND format:(\"VBR MP3\" OR MP3 OR \"128Kbps MP3\" OR \"64Kbps MP3\" OR \"Ogg Vorbis\")";
var AUDIO_FILE = /\.(mp3|ogg|oga|opus|m4a|flac|wav)$/i;
var FORMAT_RANK = { mp3: 0, m4a: 1, ogg: 2, oga: 2, opus: 2, flac: 3, wav: 4 };

var Provider = {
  search: function (json) {
    var r = JSON.parse(json);
    return iaSearch(r.query, FILTER, r.offset, r.limit, r.query ? null : "downloads desc");
  },
  latest: function (limit) {
    return iaSearch("", FILTER, 0, limit || 30, "downloads desc");
  },
  getById: function (id) {
    return iaTitle(iaItem(id));
  },
  getPlaybackGroups: function (titleId) {
    var item = iaItem(titleId);
    // One track per recording: the archive keeps several formats and bitrates of each one. The
    // most widely playable format wins (mp3, then m4a, ogg, flac, wav).
    var best = {};
    var order = [];
    iaFiles(item, AUDIO_FILE).forEach(function (f) {
      var ext = /\.(\w+)$/.exec(f.name)[1].toLowerCase();
      var key = f.name.replace(/(_64kb|_128kb|_vbr)?\.\w+$/i, "");
      var rank = FORMAT_RANK[ext] * 10 + (/_64kb\./i.test(f.name) ? 1 : 0);
      if (!(key in best)) order.push(key);
      if (!(key in best) || rank < best[key].rank) best[key] = { file: f, rank: rank };
    });
    var tracks = order.map(function (key, i) {
      var f = best[key].file;
      return {
        id: f.name,
        number: i + 1,
        title: text(f.title) || f.name.replace(/^.*\//, "").replace(AUDIO_FILE, ""),
        durationMs: durationMs(f.length),
      };
    });
    return [{ id: "tracks", title: "Tracks", episodes: tracks }];
  },
  getPlayerLinks: function (titleId, groupId, episodeId) {
    if (!AUDIO_FILE.test(episodeId)) return [];
    return [{ url: iaDownloadUrl(titleId, episodeId), type: "DIRECT_AUDIO", playerName: "Internet Archive" }];
  },
};
