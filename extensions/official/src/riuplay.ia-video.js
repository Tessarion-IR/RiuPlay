//@include ia-shared.inc.js
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
