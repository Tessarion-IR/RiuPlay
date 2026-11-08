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

// Films and animation from the Internet Archive's curated public-domain collections (feature films,
// silent films, classic cartoons, the Prelinger archive), limited to items with an open license.
// User-upload collections are left out: their license tags are not reliable.
var COLLECTIONS = "mediatype:movies AND collection:(feature_films OR silent_films OR classic_cartoons OR prelinger) AND format:(h.264 OR MPEG4 OR \"h.264 IA\" OR \"512Kb MPEG4\")";

var Provider = {
  search: function (json) {
    var r = JSON.parse(json);
    return iaSearch(r.query, COLLECTIONS, r.offset, r.limit, r.query ? null : "downloads desc");
  },
  latest: function (limit) {
    return iaSearch("", COLLECTIONS, 0, limit || 30, "downloads desc");
  },
  getById: function (id) {
    return iaTitle(iaItem(id));
  },
  getPlaybackGroups: function (titleId) {
    var item = iaItem(titleId);
    var films = videosOf(item);
    return [{
      id: "files",
      title: "Video",
      episodes: films.map(function (film, i) {
        return {
          id: film.key,
          number: i + 1,
          title: films.length === 1 ? text(item.metadata.title) || "Video" : film.key.replace(/^.*\//, ""),
          durationMs: durationMs(film.files[0].length),
        };
      }),
    }];
  },
  getPlayerLinks: function (titleId, groupId, episodeId) {
    var film = videosOf(iaItem(titleId)).filter(function (f) { return f.key === episodeId; })[0];
    if (!film) return [];
    return film.files.map(function (f) {
      return { url: iaDownloadUrl(titleId, f.name), type: "DIRECT_MP4", playerName: "Internet Archive", quality: qualityOf(f) };
    });
  },
};

// The archive keeps one film as several copies: the upload (.mp4), its own h.264 copy (.ia.mp4)
// and a small one (_512kb.mp4). One episode per film, its copies as qualities, best first.
function videosOf(item) {
  var byKey = {};
  var order = [];
  iaFiles(item, /\.mp4$/i).forEach(function (f) {
    var key = f.name.replace(/(_512kb|\.ia)?\.mp4$/i, "");
    if (!byKey[key]) { byKey[key] = []; order.push(key); }
    byKey[key].push(f);
  });
  return order.map(function (key) {
    return { key: key, files: byKey[key].sort(function (a, b) { return rankOf(a) - rankOf(b); }) };
  });
}
function rankOf(f) {
  return /_512kb\.mp4$/i.test(f.name) ? 2 : /\.ia\.mp4$/i.test(f.name) ? 1 : 0;
}
function qualityOf(f) {
  var h = Number(f.height);
  if (h > 0) return h + "p";
  return /_512kb\.mp4$/i.test(f.name) ? "Small" : "Original";
}
