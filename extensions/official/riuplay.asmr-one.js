// ASMR works from asmr.one - the content source KikoFlu (https://github.com/pa-jesusf/KikoFlu,
// GPL-3.0) uses: its public Kikoeru-compatible API at api.asmr-200.com (mirrors api.asmr-100.com
// and api.asmr-300.com), the same endpoints KikoFlu's KikoeruApiService calls - /api/works,
// /api/search/<keyword>, /api/work/<id>, /api/tracks/<id> - read anonymously.
//
// Adult (R18) works are left out unless the user turns on "Show adult (R18) works" in this source's
// settings: every query carries the API's own "$-age:adult$" filter, and each work's nsfw flag is
// checked again here.
var HOSTS = ["https://api.asmr-200.com", "https://api.asmr-100.com", "https://api.asmr-300.com"];
var AUDIO_FILE = /\.(mp3|m4a|aac|ogg|opus|flac|wav)$/i;
var LYRIC_FILE = /\.(vtt|lrc|srt)$/i;
var FORMAT_RANK = { mp3: 0, m4a: 1, aac: 1, ogg: 2, opus: 2, flac: 3, wav: 4 };

function adultAllowed() {
  return storage.get("adult") === "true";
}

/** GET a JSON API path, trying the mirrors in order when one is down. */
function api(path) {
  var last = null;
  for (var i = 0; i < HOSTS.length; i++) {
    var response = fetch(HOSTS[i] + path, { headers: { accept: "application/json" } });
    if (response.ok) return JSON.parse(response.body);
    last = response.status;
    if (response.status === 404) break;
  }
  throw new Error("asmr.one request failed: HTTP " + last);
}

function allowed(work) {
  return adultAllowed() || (work.nsfw !== true && work.age_category_string !== "adult");
}

function title(work) {
  var tags = (work.tags || []).map(function (t) { return (t.i18n && t.i18n["en-us"] && t.i18n["en-us"].name) || t.name; }).filter(Boolean);
  var vas = (work.vas || []).map(function (v) { return v.name; });
  var circle = work.name || (work.circle && work.circle.name) || "";
  return AnimeTitle({
    id: String(work.id),
    englishName: work.title,
    year: Number(String(work.release || "").slice(0, 4)) || null,
    posterUrl: work.mainCoverUrl || work.thumbnailCoverUrl || null,
    description: [circle ? "Circle: " + circle : "", vas.length ? "CV: " + vas.join(", ") : "", work.source_id ? work.source_id : ""].filter(Boolean).join(" · "),
    genres: tags.slice(0, 12),
    pageUrl: "https://www.asmr.one/work/" + (work.source_id || "RJ" + work.id),
  });
}

function query(keyword, page) {
  var filter = adultAllowed() ? "" : " $-age:adult$";
  var text = (String(keyword || "").replace(/\$/g, " ").trim() + filter).trim();
  var params = "?page=" + page + "&pageSize=30&order=" + (keyword ? "create_date" : "dl_count") + "&sort=desc&subtitle=0&includeTranslationWorks=true";
  var data = text ? api("/api/search/" + encodeURIComponent(text) + params) : api("/api/works" + params);
  return (data.works || []).filter(allowed).map(title);
}

/** The work's track tree, flattened to one entry per recording (best playable format wins), each
 * with the lyric/subtitle file of the same name when there is one. */
function tracksOf(workId) {
  var tree = api("/api/tracks/" + encodeURIComponent(workId));
  var audio = [];
  var lyrics = {};
  (function walk(nodes, folder) {
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (node.type === "folder") { walk(node.children || [], folder ? folder + " / " + node.title : node.title); continue; }
      var url = node.mediaStreamUrl || node.mediaDownloadUrl;
      if (!url || !/^https:\/\//.test(url)) continue;
      if (node.type === "audio" || AUDIO_FILE.test(node.title)) audio.push({ title: node.title, folder: folder, url: url, duration: node.duration });
      else if (LYRIC_FILE.test(node.title)) lyrics[(folder || "") + "\n" + node.title.replace(LYRIC_FILE, "")] = url;
    }
  })(tree || [], "");
  var best = {};
  var order = [];
  audio.forEach(function (t) {
    var base = t.title.replace(AUDIO_FILE, "");
    var ext = (AUDIO_FILE.exec(t.title) || [, "mp3"])[1].toLowerCase();
    var rank = FORMAT_RANK[ext] === undefined ? 9 : FORMAT_RANK[ext];
    // The same recording is often offered as WAV and MP3 in parallel folders: keep one, the lighter.
    var key = base.toLowerCase();
    if (!(key in best)) order.push(key);
    if (!(key in best) || rank < best[key].rank) best[key] = { track: t, rank: rank };
  });
  return order.map(function (key, i) {
    var t = best[key].track;
    var base = t.title.replace(AUDIO_FILE, "");
    var lyric = lyrics[(t.folder || "") + "\n" + t.title] || lyrics[(t.folder || "") + "\n" + base] || null;
    return { id: t.url, number: i + 1, title: base, durationMs: t.duration > 0 ? Math.round(t.duration * 1000) : null, lyric: lyric };
  });
}

var Provider = {
  search: function (json) {
    var r = JSON.parse(json);
    return query(r.query, Math.floor((r.offset || 0) / 30) + 1);
  },
  latest: function () {
    return query("", 1);
  },
  getById: function (id) {
    var work = api("/api/work/" + encodeURIComponent(id));
    if (!allowed(work)) throw new Error("This is an adult (R18) work. Turn on \"Show adult (R18) works\" in this source's settings to open it.");
    return title(work);
  },
  getPlaybackGroups: function (titleId) {
    this.getById(titleId);
    return [{ id: "tracks", title: "Tracks", episodes: tracksOf(titleId).map(function (t) { return { id: t.id, number: t.number, title: t.title, durationMs: t.durationMs }; }) }];
  },
  getPlayerLinks: function (titleId, groupId, episodeId) {
    var track = tracksOf(titleId).filter(function (t) { return t.id === episodeId; })[0];
    if (!track) return [];
    var link = { url: track.id, type: "DIRECT_AUDIO", playerName: "asmr.one" };
    if (track.lyric) link.subtitles = [{ url: track.lyric, lang: "ja", label: "Lyrics" }];
    return [link];
  },
};
