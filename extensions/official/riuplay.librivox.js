// LibriVox (https://librivox.org): public-domain audiobooks read by volunteers. The audio files are on archive.org.
var API = "https://librivox.org/api/feed/audiobooks/";
var AUDIO_URL = /^https:\/\/(www\.)?archive\.org\//;

function books(params) {
  var response = fetch(API + "?format=json&extended=1&" + params, { headers: { accept: "application/json" } });
  if (response.status === 404) return []; // LibriVox's "no matches"
  if (!response.ok) throw new Error("LibriVox request failed: HTTP " + response.status);
  return JSON.parse(response.body).books || [];
}
function poster(book) {
  var m = /archive\.org\/details\/([^/?#]+)/.exec(book.url_iarchive || "");
  return m ? "https://archive.org/services/img/" + m[1] : null;
}
function authors(book) {
  return (book.authors || []).map(function (a) { return (String(a.first_name || "") + " " + String(a.last_name || "")).trim(); }).join(", ");
}
function title(book) {
  var by = authors(book);
  return AnimeTitle({
    id: String(book.id),
    englishName: book.title,
    year: Number(book.copyright_year) || null,
    posterUrl: poster(book),
    description: ((by ? "By " + by + ". " : "") + String(book.description || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim(),
    genres: (book.genres || []).map(function (g) { return g.name; }),
    pageUrl: book.url_librivox || null,
  });
}
function book(id) {
  var found = books("id=" + encodeURIComponent(id))[0];
  if (!found) throw new Error("Audiobook not found: " + id);
  return found;
}

var Provider = {
  search: function (json) {
    var r = JSON.parse(json);
    var q = String(r.query || "").trim();
    var limit = Math.min(r.limit || 30, 50);
    var offset = r.offset || 0;
    if (!q) return books("limit=" + limit + "&offset=" + offset).map(title);
    var found = books("limit=" + limit + "&offset=" + offset + "&title=" + encodeURIComponent("^" + q));
    if (!offset) found = found.concat(books("limit=20&author=" + encodeURIComponent(q.split(/\s+/).pop())));
    var seen = {};
    return found.filter(function (b) { if (seen[b.id]) return false; seen[b.id] = true; return true; }).map(title);
  },
  latest: function (limit) {
    return books("limit=" + Math.min(limit || 30, 50)).map(title);
  },
  getById: function (id) {
    return title(book(id));
  },
  getPlaybackGroups: function (titleId) {
    var sections = book(titleId).sections || [];
    return [{
      id: "sections",
      title: "Chapters",
      episodes: sections
        .map(function (s, i) {
          return {
            id: String(s.listen_url || ""),
            number: Number(s.section_number) || i + 1,
            title: s.title || "Chapter " + (i + 1),
            durationMs: Number(s.playtime) > 0 ? Number(s.playtime) * 1000 : null,
          };
        })
        .filter(function (e) { return AUDIO_URL.test(e.id); }),
    }];
  },
  getPlayerLinks: function (titleId, groupId, episodeId) {
    if (!AUDIO_URL.test(episodeId)) return [];
    return [{ url: episodeId.replace("://www.archive.org/", "://archive.org/"), type: "DIRECT_AUDIO", playerName: "LibriVox" }];
  },
};
