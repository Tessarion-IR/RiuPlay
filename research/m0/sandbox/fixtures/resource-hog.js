// M0 fixture: workloads for the memory and CPU experiments.
var Provider = { getSettings: function () { return {}; } };
var keep = [];

var Attacks = {
  // JavaScript objects: limited by the V8 heap.
  heap: function () {
    for (;;) {
      var chunk = new Array(1024 * 1024);
      for (var i = 0; i < chunk.length; i++) chunk[i] = { i: i, s: "x" + i };
      keep.push(chunk);
    }
  },
  // ArrayBuffers: backing stores live outside the V8 heap.
  buffers: function () {
    for (;;) {
      var b = new Uint8Array(64 * 1024 * 1024);
      for (var i = 0; i < b.length; i += 4096) b[i] = 1; // touch pages so they are committed
      keep.push(b);
    }
  },
  loop: function () {
    for (;;) {}
  },
  echo: function () { return "alive"; },
};
