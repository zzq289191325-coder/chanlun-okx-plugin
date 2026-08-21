/* global window, document */
(function setupChanlunOkxPageBridge() {
  "use strict";

  var SOURCE = "chanlun-okx-visualizer";
  var STATUS = "CHANLUN_TV_STATUS";
  var DRAW = "CHANLUN_TV_DRAW";
  var CLEAR = "CHANLUN_TV_CLEAR";
  var PING = "CHANLUN_TV_PING";
  var BRIDGE_FLAG = "__CHANLUN_OKX_TV_BRIDGE__";

  if (window[BRIDGE_FLAG]) {
    window.postMessage(
      {
        source: SOURCE,
        type: STATUS,
        payload: { connected: true, reason: "bridge already injected", shapes: 0 },
      },
      "*",
    );
    return;
  }

  window[BRIDGE_FLAG] = true;

  var entityIds = [];
  var seenObjects = typeof WeakSet === "function" ? new WeakSet() : null;

  function postStatus(connected, reason, shapes) {
    window.postMessage(
      {
        source: SOURCE,
        type: STATUS,
        payload: { connected: connected, reason: reason, shapes: shapes || 0 },
      },
      "*",
    );
  }

  function safeCall(callback) {
    try {
      return callback();
    } catch {
      return null;
    }
  }

  function isObjectLike(value) {
    return (typeof value === "object" && value !== null) || typeof value === "function";
  }

  function chartFromCandidate(candidate) {
    if (!isObjectLike(candidate)) return null;

    var chart = safeCall(function getActiveChart() {
      if (typeof candidate.activeChart === "function") return candidate.activeChart();
      return null;
    });

    if (!chart) {
      chart = safeCall(function getChart() {
        if (typeof candidate.chart === "function") return candidate.chart();
        return null;
      });
    }

    if (!chart && typeof candidate.createShape === "function") {
      chart = candidate;
    }

    if (
      chart &&
      (typeof chart.createShape === "function" || typeof chart.createMultipointShape === "function")
    ) {
      return chart;
    }

    return null;
  }

  function scanObjectForChart(root, depth) {
    if (!isObjectLike(root) || depth > 2) return null;
    if (seenObjects && seenObjects.has(root)) return null;
    if (seenObjects) seenObjects.add(root);

    var direct = chartFromCandidate(root);
    if (direct) return direct;

    var names = safeCall(function getNames() {
      return Object.getOwnPropertyNames(root);
    });
    if (!names) return null;

    for (var index = 0; index < names.length; index += 1) {
      var name = names[index];
      if (name === "localStorage" || name === "sessionStorage" || name === "indexedDB") continue;

      var value = safeCall(function getValue() {
        return root[name];
      });
      var chart = chartFromCandidate(value);
      if (chart) return chart;

      if (depth < 1 && isObjectLike(value)) {
        chart = scanObjectForChart(value, depth + 1);
        if (chart) return chart;
      }
    }

    return null;
  }

  function windowsToScan() {
    var windows = [window];
    var frames = safeCall(function getFrames() {
      return Array.prototype.slice.call(document.querySelectorAll("iframe"));
    });

    if (frames) {
      for (var index = 0; index < frames.length; index += 1) {
        var frameWindow = safeCall(function getFrameWindow() {
          return frames[index].contentWindow;
        });
        if (frameWindow) windows.push(frameWindow);
      }
    }

    return windows;
  }

  function findNativeChart() {
    seenObjects = typeof WeakSet === "function" ? new WeakSet() : null;

    var knownNames = [
      "tvWidget",
      "tv_widget",
      "chartWidget",
      "tradingViewWidget",
      "TradingViewWidget",
      "__tvWidget",
      "__chartWidget",
    ];
    var scanWindows = windowsToScan();

    for (var windowIndex = 0; windowIndex < scanWindows.length; windowIndex += 1) {
      var scanWindow = scanWindows[windowIndex];
      for (var nameIndex = 0; nameIndex < knownNames.length; nameIndex += 1) {
        var knownValue = safeCall(function getKnownValue() {
          return scanWindow[knownNames[nameIndex]];
        });
        var knownChart = chartFromCandidate(knownValue);
        if (knownChart) return knownChart;
      }

      var chart = scanObjectForChart(scanWindow, 0);
      if (chart) return chart;
    }

    return null;
  }

  function asPromise(value) {
    if (value && typeof value.then === "function") return value;
    return Promise.resolve(value);
  }

  async function clearShapes(chart) {
    var ids = entityIds.slice();
    entityIds = [];

    if (!chart || typeof chart.removeEntity !== "function") return;

    for (var index = 0; index < ids.length; index += 1) {
      try {
        await asPromise(chart.removeEntity(ids[index]));
      } catch {
        // Ignore stale entities; they may have been removed by the native chart.
      }
    }
  }

  function pointFromSpec(point) {
    return {
      time: Math.floor(point.time),
      price: Number(point.price),
    };
  }

  function shapeOptions(spec) {
    return {
      shape: spec.shape,
      text: spec.text || "",
      lock: true,
      disableSelection: true,
      disableSave: true,
      zOrder: "top",
      overrides: {
        color: spec.color,
        linecolor: spec.color,
        linewidth: spec.lineWidth || 1,
        textcolor: spec.color,
        backgroundColor: spec.fillColor,
        backgroundColorTransparency: spec.fillTransparency || 75,
        transparency: spec.transparency || 0,
        fontsize: spec.fontSize || 12,
        borderRadius: spec.cornerRadius || 0,
      },
    };
  }

  async function createNativeShape(chart, spec) {
    var points = spec.points.map(pointFromSpec);
    var options = shapeOptions(spec);

    if (points.length > 1 && typeof chart.createMultipointShape === "function") {
      return asPromise(chart.createMultipointShape(points, options));
    }

    if (points.length === 1 && typeof chart.createShape === "function") {
      return asPromise(chart.createShape(points[0], options));
    }

    return null;
  }

  async function draw(payload) {
    var chart = findNativeChart();
    if (!chart) {
      postStatus(false, "native TradingView chart API not found", 0);
      return;
    }

    await clearShapes(chart);

    var specs = payload && Array.isArray(payload.shapes) ? payload.shapes : [];
    for (var index = 0; index < specs.length; index += 1) {
      try {
        var entityId = await createNativeShape(chart, specs[index]);
        if (entityId !== null && entityId !== undefined) entityIds.push(entityId);
      } catch {
        // Keep drawing the remaining structures if one native shape type is unsupported.
      }
    }

    postStatus(true, "native TradingView chart API connected", entityIds.length);
  }

  window.addEventListener("message", function onMessage(event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== SOURCE) return;

    if (data.type === PING) {
      var chart = findNativeChart();
      postStatus(Boolean(chart), chart ? "native TradingView chart API connected" : "native chart API not found", 0);
      return;
    }

    if (data.type === CLEAR) {
      var clearChart = findNativeChart();
      void clearShapes(clearChart).then(function afterClear() {
        postStatus(Boolean(clearChart), clearChart ? "native shapes cleared" : "native chart API not found", 0);
      });
      return;
    }

    if (data.type === DRAW) {
      void draw(data.payload);
    }
  });

  postStatus(Boolean(findNativeChart()), "bridge injected", 0);
})();
