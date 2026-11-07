// M0 fixture: a hibiki-format scripted source (manifest + Provider), written for RiuPlay's tests.
// It uses the host API the way hibiki-sources scripts do: synchronous fetch/fetchAll, Jsoup, Base64,
// Gzip, Url, AnimeTitle, collectPaginated and storage. __SITE__ is replaced with the test site's URL.
var SITE = "__SITE__";

function title(item) {
  return AnimeTitle({ id: String(item.id), englishName: item.title, year: item.year || null, posterUrl: item.poster ? Url.resolve(SITE, item.poster) : null, genres: item.genres || [] });
}

var Provider = {
  search: function (json) {
    var request = JSON.parse(json);
    var response = fetch(SITE + "/api/search?q=" + encodeURIComponent(request.query || ""), { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("search failed: " + response.status);
    return JSON.parse(response.body).items.map(title);
  },

  latest: function (limit) {
    return collectPaginated(function (page) {
      var data = JSON.parse(fetch(SITE + "/api/latest?page=" + page).body);
      return data.items.length ? data.items.map(title) : null;
    }, limit, 2);
  },

  getById: function (id) {
    var url = SITE + "/title/" + id;
    var doc = Jsoup.parse(fetch(url).body, url);
    var genres = [];
    var links = doc.select(".genres a");
    for (var i = 0; i < links.size(); i++) genres.push(links.get(i).text());
    storage.set("lastOpened", id);
    return AnimeTitle({
      id: id,
      englishName: doc.selectFirst("h1.title").text(),
      description: doc.selectFirst(".desc").text(),
      posterUrl: doc.selectFirst("img.poster").absUrl("src"),
      genres: genres,
      year: Number(doc.selectFirst(".year").attr("data-year")),
    });
  },

  getPlaybackGroups: function (titleId) {
    var pages = fetchAll([SITE + "/api/group/sub?title=" + titleId, SITE + "/api/group/dub?title=" + titleId]);
    return pages.map(function (page) {
      var group = JSON.parse(page.body);
      return { id: group.id, title: group.title, episodes: group.episodes };
    });
  },

  getPlayerLinks: function (titleId, groupId, episodeId) {
    // Obfuscated payload: base64 of a gzip of JSON, as some real sources serve.
    var packed = fetch(SITE + "/packed/" + episodeId).body.trim();
    var json = Gzip.inflate(Base64.decode(packed));
    var data = JSON.parse(json);
    return [{ url: Url.resolve(SITE, data.stream), type: "DIRECT_HLS", quality: data.quality, playerName: "fixture" }];
  },

  getSettings: function () {
    return { lastOpened: storage.get("lastOpened") };
  },
};
