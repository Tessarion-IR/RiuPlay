// Pepper&Carrot by David Revoy (CC BY 4.0, https://www.peppercarrot.com), an open webcomic.
var SITE = "https://www.peppercarrot.com";
var TITLE_ID = "pepper-and-carrot";

function episodes() {
  var response = fetch(SITE + "/0_sources/episodes.json", { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error("Pepper&Carrot episode list failed: HTTP " + response.status);
  return JSON.parse(response.body);
}
function languageFor(episode) {
  var wanted = String(typeof preferredLanguage === "string" ? preferredLanguage : "en").slice(0, 2).toLowerCase();
  return episode.translated_languages.indexOf(wanted) >= 0 ? wanted : "en";
}
function episodeTitle(episode) {
  return episode.name.replace(/^ep\d+_/, "").replace(/-/g, " ");
}
function series() {
  return AnimeTitle({
    id: TITLE_ID,
    englishName: "Pepper&Carrot",
    year: 2014,
    posterUrl: SITE + "/0_sources/ep01_Potion-of-Flight/low-res/en_Pepper-and-Carrot_by-David-Revoy_E01P00.jpg",
    pageUrl: SITE,
    description: "A comedy fantasy webcomic about the young witch Pepper and her cat Carrot, by David Revoy. Licensed CC BY 4.0.",
    genres: ["Fantasy", "Comedy", "Webcomic"],
  });
}

var Provider = {
  search: function (json) {
    var q = String(JSON.parse(json).query || "").trim().toLowerCase();
    if (!q || "pepper&carrot pepper and carrot witch webcomic david revoy".indexOf(q) >= 0) return [series()];
    return episodes().some(function (e) { return episodeTitle(e).toLowerCase().indexOf(q) >= 0; }) ? [series()] : [];
  },
  latest: function () {
    return [series()];
  },
  getById: function (id) {
    if (id !== TITLE_ID) throw new Error("Unknown title: " + id);
    return series();
  },
  getPlaybackGroups: function () {
    return [{
      id: "episodes",
      title: "Episodes",
      episodes: episodes().map(function (e, i) { return { id: e.name, number: i + 1, title: episodeTitle(e) }; }),
    }];
  },
  getPages: function (titleId, groupId, chapterId) {
    var episode = episodes().filter(function (e) { return e.name === chapterId; })[0];
    if (!episode) throw new Error("Unknown episode: " + chapterId);
    var number = /^ep(\d+)/.exec(episode.name)[1];
    var language = languageFor(episode);
    var pages = [];
    // P00 is the episode's title page; P01..Pn are its pages.
    for (var p = 0; p <= episode.total_pages; p++) {
      pages.push(SITE + "/0_sources/" + episode.name + "/low-res/" + language + "_Pepper-and-Carrot_by-David-Revoy_E" + number + "P" + (p < 10 ? "0" + p : String(p)) + ".jpg");
    }
    return pages;
  },
};
