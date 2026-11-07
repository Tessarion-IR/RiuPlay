// M0 fixture: a second extension that stores secrets in every place a browser context can, so the
// experiment can check that malicious-a (another session) sees none of them.
var Provider = { getSettings: function () { return {}; } };

var Attacks = {
  plantSecrets: async function () {
    storage.set("secret", "B-SECRET-STORAGE");
    await new Promise(function (resolve, reject) {
      var open = indexedDB.open("shared-db", 1);
      open.onupgradeneeded = function () { open.result.createObjectStore("kv"); };
      open.onsuccess = function () {
        var tx = open.result.transaction("kv", "readwrite");
        tx.objectStore("kv").put("B-SECRET-IDB", "secret");
        tx.oncomplete = resolve;
        tx.onerror = reject;
      };
      open.onerror = reject;
    });
    var cache = await caches.open("b-cache");
    await cache.put("https://b.example/secret", new Response("B-SECRET-CACHE")); // Cache keys must be http(s)
    return { planted: true, readBack: storage.get("secret") };
  },
};
