/* u2-agent — Control Drawing U2-001
   Fig. 1 runs the agent control loop as a live signal; every command is copyable. */

(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* --- Fig. 1 · the control loop runner ---------------------------------- */

  var STATIONS = [
    {
      ref: "@1",
      stage: "reading the screen",
      body:
        "$ u2-agent ui snapshot\n" +
        "\n" +
        '[App: com.google.android.youtube]\n' +
        '[@1] Input  "Search YouTube"\n' +
        '[@2] Tab    "Home"\n' +
        '[@3] Tab    "Shorts"\n' +
        "\n" +
        "\u2192 3 actionable handles \u00b7 ~250 tokens"
    },
    {
      ref: "@1",
      stage: "resolving the handle",
      body:
        "$ u2-agent ui tap --ref @1\n" +
        "\n" +
        "resolving @1 from the hot handle store\n" +
        '\u2192 EditText "Search YouTube"  [144,120][936,216]\n' +
        "\u2192 under 15 ms \u00b7 no cold re-dump"
    },
    {
      ref: "@3",
      stage: "executing the action",
      body:
        '$ u2-agent ui type --ref @1 --text "synthwave"\n' +
        "\n" +
        "ok\n" +
        "\n" +
        "\u2192 stdout carries machine text only\n" +
        "\u2192 diagnostics stay on stderr"
    }
  ];

  var loop = document.querySelector("[data-loop]");

  if (loop) {
    var stations = Array.prototype.slice.call(loop.querySelectorAll(".station"));
    var wires = Array.prototype.slice.call(loop.querySelectorAll(".wire"));
    var stateEl = loop.querySelector("[data-loop-state]");
    var refEl = loop.querySelector("[data-readout-ref]");
    var stageEl = loop.querySelector("[data-readout-stage]");
    var bodyEl = loop.querySelector("[data-readout-body]");
    var runBtn = loop.querySelector("[data-loop-run]");
    var timers = [];
    var running = false;

    function clearTimers() {
      timers.forEach(clearTimeout);
      timers = [];
    }

    function paint(index) {
      stations.forEach(function (s, i) {
        s.classList.toggle("is-active", i <= index);
      });
      wires.forEach(function (w, i) {
        w.classList.toggle("is-hot", i < index);
      });
      var data = STATIONS[index];
      refEl.textContent = data.ref;
      stageEl.textContent = data.stage;
      bodyEl.textContent = data.body;
    }

    function idle(message) {
      running = false;
      if (runBtn) runBtn.disabled = false;
      if (stateEl) {
        stateEl.textContent = message || "idle";
        stateEl.classList.remove("is-live");
      }
    }

    function complete() {
      running = false;
      if (runBtn) runBtn.disabled = false;
      stations.forEach(function (s) { s.classList.add("is-active"); });
      wires.forEach(function (w) { w.classList.remove("is-hot"); });
      if (stateEl) {
        stateEl.textContent = "complete";
        stateEl.classList.remove("is-live");
      }
    }

    function run() {
      if (running) return;
      running = true;
      clearTimers();
      stations.forEach(function (s) { s.classList.remove("is-active"); });
      wires.forEach(function (w) { w.classList.remove("is-hot"); });
      if (runBtn) runBtn.disabled = true;
      if (stateEl) {
        stateEl.textContent = "live";
        stateEl.classList.add("is-live");
      }

      if (reduce) {
        bodyEl.textContent = STATIONS[2].body;
        refEl.textContent = STATIONS[2].ref;
        stageEl.textContent = STATIONS[2].stage;
        complete();
        return;
      }

      paint(0);
      timers.push(setTimeout(function () { paint(1); }, 620));
      timers.push(setTimeout(function () { paint(2); }, 1240));
      timers.push(setTimeout(function () { idle("idle"); }, 2000));
    }

    if (runBtn) runBtn.addEventListener("click", run);

    if (reduce) {
      paint(2);
      complete();
    } else {
      timers.push(setTimeout(run, 700));
    }
  }

  /* --- Copyable commands -------------------------------------------------- */

  var copies = Array.prototype.slice.call(document.querySelectorAll(".copy[data-copy]"));

  copies.forEach(function (button) {
    var original = button.textContent;
    button.addEventListener("click", function () {
      var text = button.getAttribute("data-copy") || "";
      var done = function () {
        button.textContent = "Copied";
        button.classList.add("is-done");
        setTimeout(function () {
          button.textContent = original;
          button.classList.remove("is-done");
        }, 1400);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        done();
      }
    });
  });
  /* --- Recorded run · click-to-load YouTube -------------------------------- */

  var screens = Array.prototype.slice.call(document.querySelectorAll("[data-video-screen]"));

  screens.forEach(function (screen) {
    var id = screen.getAttribute("data-video-id");
    var start = screen.querySelector("[data-video-start]");
    if (!id || !start) return;

    var reel = screen.closest("[data-reel]");
    var state = reel ? reel.querySelector("[data-reel-state]") : null;

    start.addEventListener("click", function () {
      var frame = document.createElement("iframe");
      frame.className = "video__frame";
      frame.src = "https://www.youtube-nocookie.com/embed/" + id + "?autoplay=1&rel=0";
      frame.title = start.getAttribute("aria-label") || "u2-agent recorded run";
      frame.setAttribute("allow", "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share");
      frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      frame.setAttribute("allowfullscreen", "");
      screen.replaceChild(frame, start);
      if (state) {
        state.textContent = "playing";
        state.classList.add("is-live");
      }
    });
  });
})();
