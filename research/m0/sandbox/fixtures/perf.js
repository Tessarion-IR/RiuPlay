// M0 fixture: measures the cost of the synchronous bridge from inside the sandbox.
var SITE = "__SITE__";
var Provider = { getSettings: function () { return {}; } };
function stats(times) {
  times.sort(function (a, b) { return a - b; });
  var sum = times.reduce(function (a, b) { return a + b; }, 0);
  return { n: times.length, meanMs: +(sum / times.length).toFixed(3), p50Ms: +times[Math.floor(times.length * 0.5)].toFixed(3), p95Ms: +times[Math.floor(times.length * 0.95)].toFixed(3), maxMs: +times[times.length - 1].toFixed(3) };
}
var Attacks = {
  brokerRoundtrip: function () {
    var t = [];
    for (var i = 0; i < 500; i++) { var s = performance.now(); storage.get("k"); t.push(performance.now() - s); }
    return stats(t);
  },
  fetchThroughBroker: function () {
    var t = [];
    for (var i = 0; i < 200; i++) { var s = performance.now(); fetch(SITE + "/tiny"); t.push(performance.now() - s); }
    return stats(t);
  },
  fetchAllTenConcurrent: function () {
    var urls = []; for (var i = 0; i < 10; i++) urls.push(SITE + "/slow?ms=200&n=" + i);
    var s = performance.now(); var r = fetchAll(urls); return { ms: +(performance.now() - s).toFixed(1), ok: r.every(function (x) { return x.ok; }) };
  },
};
