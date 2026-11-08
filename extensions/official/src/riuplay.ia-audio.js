//@include ia-shared.inc.js
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
