import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  LineSeries,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type {
  Candle,
  ChanlunAnalysis,
  ChanlunSignal,
  ChartLayerVisibility,
  Fractal,
  Zhongshu,
} from "@/chanlun/types";
import { formatPrice } from "@/utils/format";
import { toUtcTimestampSeconds } from "@/utils/time";

export interface ChartViewHandle {
  exportPng: () => void;
}

interface ChartViewProps {
  candles: Candle[];
  analysis: ChanlunAnalysis | null;
  chartLayers: ChartLayerVisibility;
  resetKey: string;
  attached?: boolean;
}

interface OverlayShape {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  variant: "zhongshu" | "candidate-long" | "candidate-short" | "candidate-buy-box" | "candidate-sell-box";
}

interface NativeShapePoint {
  time: number;
  price: number;
}

interface NativeShapeSpec {
  id: string;
  shape: "trend_line" | "rectangle" | "arrow_up" | "arrow_down" | "text";
  points: NativeShapePoint[];
  color: string;
  fillColor?: string;
  fillTransparency?: number;
  fontSize?: number;
  lineWidth?: number;
  cornerRadius?: number;
  text?: string;
  transparency?: number;
}

interface NativeBridgeStatus {
  connected: boolean;
  reason: string;
  shapes: number;
}

const NATIVE_BRIDGE_SOURCE = "chanlun-okx-visualizer";
const SWITCH_TRADINGVIEW_EVENT = "chanlun:switch-tradingview";
const DEFAULT_CHART_LAYERS: ChartLayerVisibility = {
  showFractals: false,
  showStructures: true,
  showSignals: true,
  bareK: false,
};
type SignalAnchorCandle = Pick<Candle, "ts" | "high" | "low" | "close">;

interface SignalPlacement {
  startTs: number;
  endTs: number;
  labelHigh: number;
  labelLow: number;
  arrowPrice: number;
}

function toTime(ts: number) {
  return toUtcTimestampSeconds(ts) as UTCTimestamp;
}

function toCandleData(candle: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: toTime(candle.ts),
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  };
}

function effectiveChartLayers(chartLayers: ChartLayerVisibility): ChartLayerVisibility {
  if (!chartLayers.bareK) return chartLayers;
  return {
    showFractals: false,
    showStructures: false,
    showSignals: false,
    bareK: true,
  };
}

function fractalMarker(fractal: Fractal): SeriesMarker<Time> {
  return {
    time: toTime(fractal.ts),
    position: fractal.type === "top" ? "aboveBar" : "belowBar",
    color: fractal.type === "top" ? "#ff6b6b" : "#22c55e",
    shape: fractal.type === "top" ? "arrowDown" : "arrowUp",
    text: fractal.type === "top" ? "顶" : "底",
  };
}

function signalText(signal: ChanlunAnalysis["signals"][number]) {
  const pointPrice = signal.point?.structurePrice;
  if (pointPrice === undefined || !Number.isFinite(pointPrice)) return `${signal.label} ${signal.score}`;
  return `${signal.label} ${signal.score} @${formatPrice(pointPrice)}`;
}

function signalBadgeText(signal: ChanlunSignal, multiline = false) {
  const pointPrice = signal.point?.structurePrice;
  const compactLabel = signal.label.replace(/^候选/, "候");
  if (pointPrice === undefined || !Number.isFinite(pointPrice)) return compactLabel;
  const price = formatPrice(pointPrice);
  return multiline ? `${compactLabel}\n${price}` : `${compactLabel} ${price}`;
}

function buildMarkers(
  analysis: ChanlunAnalysis | null,
  validTimes: Set<number>,
  chartLayers: ChartLayerVisibility,
): SeriesMarker<Time>[] {
  if (!analysis) return [];

  const layers = effectiveChartLayers(chartLayers);
  const fractalMarkers = layers.showFractals
    ? analysis.fractals
        .slice(-60)
        .filter((fractal) => validTimes.has(toTime(fractal.ts)))
        .map(fractalMarker)
    : [];

  const signalMarkers = layers.showSignals
    ? analysis.signals
    .slice(-24)
    .filter((signal) => validTimes.has(toTime(signal.ts)))
    .map((signal): SeriesMarker<Time> => {
      const isBuy = signal.kind === "candidate_buy";
      const isSell = signal.kind === "candidate_sell";
      const marker: SeriesMarker<Time> = {
        time: toTime(signal.ts),
        position: isBuy ? "belowBar" : "aboveBar",
        color: isBuy ? "#10b981" : isSell ? "#ef4444" : "#f59e0b",
        shape: isBuy ? "arrowUp" : isSell ? "arrowDown" : "circle",
        size: isBuy || isSell ? 1.55 : 1,
      };
      marker.text = isBuy || isSell ? signalBadgeText(signal) : signalText(signal);
      return marker;
    })
    : [];

  return [...fractalMarkers, ...signalMarkers].sort((a, b) => Number(a.time) - Number(b.time));
}

function isFractal(point: Fractal | undefined): point is Fractal {
  return point !== undefined;
}

function linePointsFromFractals(points: Fractal[]) {
  const unique = new Map<number, Fractal>();
  for (const point of points) unique.set(point.ts, point);
  return [...unique.values()]
    .sort((a, b) => a.ts - b.ts)
    .map((point) => ({
      time: toTime(point.ts),
      value: point.price,
    }));
}

function estimateStepMs(candles: Array<{ ts: number }>) {
  for (let index = candles.length - 1; index > 0; index -= 1) {
    const step = candles[index]!.ts - candles[index - 1]!.ts;
    if (step > 0) return step;
  }
  return 60_000;
}

function nearestCandle(candles: SignalAnchorCandle[], ts: number) {
  let nearest: SignalAnchorCandle | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    const distance = Math.abs(candle.ts - ts);
    if (distance < nearestDistance) {
      nearest = candle;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function candlePriceRange(candles: SignalAnchorCandle[]) {
  let high = Number.NEGATIVE_INFINITY;
  let low = Number.POSITIVE_INFINITY;
  for (const candle of candles) {
    high = Math.max(high, candle.high);
    low = Math.min(low, candle.low);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return 1;
  return high - low;
}

function signalPlacement(
  signal: ChanlunSignal,
  stepMs: number,
  candles: SignalAnchorCandle[],
  lane = 0,
): SignalPlacement | null {
  if (signal.kind !== "candidate_buy" && signal.kind !== "candidate_sell") return null;

  const candle = nearestCandle(candles, signal.ts);
  const anchorHigh = candle?.high ?? signal.price;
  const anchorLow = candle?.low ?? signal.price;
  const referencePrice = Math.max(Math.abs(anchorHigh), Math.abs(anchorLow), Math.abs(signal.price), 1);
  const range = candlePriceRange(candles);
  const pad = Math.max(range * 0.035, referencePrice * 0.0006, Number.EPSILON);
  const bandHeight = Math.max(range * 0.048, referencePrice * 0.0008, pad);
  const labelGap = pad * (2.1 + lane * 1.55);
  const arrowGap = pad * (0.85 + lane * 0.35);
  const halfSpan = stepMs * 1.45;

  if (signal.kind === "candidate_buy") {
    const labelHigh = anchorLow - labelGap;
    return {
      startTs: signal.ts - halfSpan,
      endTs: signal.ts + halfSpan,
      labelHigh,
      labelLow: labelHigh - bandHeight,
      arrowPrice: anchorLow - arrowGap,
    };
  }

  const labelLow = anchorHigh + labelGap;
  return {
    startTs: signal.ts - halfSpan,
    endTs: signal.ts + halfSpan,
    labelHigh: labelLow + bandHeight,
    labelLow,
    arrowPrice: anchorHigh + arrowGap,
  };
}

function shapeFromPrices({
  chart,
  series,
  id,
  startTs,
  endTs,
  endX,
  high,
  low,
  label,
  variant,
}: {
  chart: IChartApi;
  series: ISeriesApi<"Candlestick">;
  id: string;
  startTs: number;
  endTs?: number;
  endX?: number;
  high: number;
  low: number;
  label: string;
  variant: OverlayShape["variant"];
}): OverlayShape | null {
  const startX = chart.timeScale().timeToCoordinate(toTime(startTs));
  const rightX = typeof endX === "number" ? endX : endTs ? chart.timeScale().timeToCoordinate(toTime(endTs)) : null;
  const topPrice = Math.max(high, low);
  const bottomPrice = Math.min(high, low);
  const topY = series.priceToCoordinate(topPrice);
  const bottomY = series.priceToCoordinate(bottomPrice);
  if (startX === null || rightX === null || topY === null || bottomY === null) return null;

  return {
    id,
    x: Math.min(startX, rightX),
    y: Math.min(topY, bottomY),
    width: Math.max(8, Math.abs(rightX - startX)),
    height: Math.max(6, Math.abs(bottomY - topY)),
    label,
    variant,
  };
}

function signalBoxFromPoint(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  signal: ChanlunSignal,
  stepMs: number,
  candles: Candle[],
  lane: number,
) {
  if (!signal.point || (signal.kind !== "candidate_buy" && signal.kind !== "candidate_sell")) return null;
  const placement = signalPlacement(signal, stepMs, candles, lane);
  if (!placement) return null;

  return shapeFromPrices({
    chart,
    series,
    id: `box:${signal.id}`,
    startTs: placement.startTs,
    endTs: placement.endTs,
    high: placement.labelHigh,
    low: placement.labelLow,
    label: signalBadgeText(signal, true),
    variant: signal.kind === "candidate_buy" ? "candidate-buy-box" : "candidate-sell-box",
  });
}

function measureOverlayShapes(
  chart: IChartApi,
  series: ISeriesApi<"Candlestick">,
  zones: Zhongshu[],
  signals: ChanlunSignal[],
  candles: Candle[],
  attached: boolean,
  chartWidth: number,
  chartLayers: ChartLayerVisibility,
): OverlayShape[] {
  const layers = effectiveChartLayers(chartLayers);
  const shapes: OverlayShape[] = [];
  const recentZone = zones.at(-1);
  const stepMs = estimateStepMs(candles);

  if (layers.showStructures && attached && recentZone && candles.length > 0) {
    const recentCandles = candles.slice(-140);
    const recentHigh = Math.max(...recentCandles.map((candle) => candle.high));
    const recentLow = Math.min(...recentCandles.map((candle) => candle.low));
    const startTs = Math.min(recentZone.startTs, recentCandles[0]?.ts ?? recentZone.startTs);
    const startX = chart.timeScale().timeToCoordinate(toTime(startTs)) ?? 0;
    const rightEdge = Math.max(startX + 160, chartWidth - chart.priceScale("right").width() - 8);

    if (recentHigh > recentZone.high) {
      const shortShape = shapeFromPrices({
        chart,
        series,
        id: `${recentZone.id}:candidate-short`,
        startTs,
        endX: rightEdge,
        high: recentHigh,
        low: recentZone.high,
        label: "候选空方观察区",
        variant: "candidate-short",
      });
      if (shortShape) shapes.push(shortShape);
    }

    if (recentZone.low > recentLow) {
      const longShape = shapeFromPrices({
        chart,
        series,
        id: `${recentZone.id}:candidate-long`,
        startTs,
        endX: rightEdge,
        high: recentZone.low,
        low: recentLow,
        label: "候选多方观察区",
        variant: "candidate-long",
      });
      if (longShape) shapes.push(longShape);
    }
  }

  const zhongshuShapes = layers.showStructures
    ? zones
    .slice(attached ? -1 : -4)
    .map((zone) =>
      shapeFromPrices({
        chart,
        series,
        id: zone.id,
        startTs: zone.startTs,
        endTs: zone.endTs,
        high: zone.high,
        low: zone.low,
        label: attached ? "最近中枢区" : `${zone.level === "segment" ? "段" : "笔"}中枢`,
        variant: "zhongshu",
      }),
    )
    .filter((shape): shape is OverlayShape => shape !== null)
    : [];

  const signalBoxShapes = layers.showSignals
    ? signals
    .filter((signal) => signal.kind === "candidate_buy" || signal.kind === "candidate_sell")
    .slice(-10)
    .map((signal, index) => signalBoxFromPoint(chart, series, signal, stepMs, candles, index % 2))
    .filter((shape): shape is OverlayShape => shape !== null)
    : [];

  return [...zhongshuShapes, ...shapes, ...signalBoxShapes];
}

function nativePoint(ts: number, price: number): NativeShapePoint {
  return {
    time: Number(toTime(ts)),
    price,
  };
}

function nativeLineShape(
  id: string,
  start: Fractal,
  end: Fractal,
  color: string,
  lineWidth: number,
): NativeShapeSpec {
  return {
    id,
    shape: "trend_line",
    points: [nativePoint(start.ts, start.price), nativePoint(end.ts, end.price)],
    color,
    lineWidth,
  };
}

function signalShape(
  signal: ChanlunAnalysis["signals"][number],
  stepMs: number,
  candles: SignalAnchorCandle[],
  lane: number,
): NativeShapeSpec {
  const isBuy = signal.kind === "candidate_buy";
  const isSell = signal.kind === "candidate_sell";
  const color = isBuy ? "#22c55e" : isSell ? "#ef4444" : "#f59e0b";
  const placement = isBuy || isSell ? signalPlacement(signal, stepMs, candles, lane) : null;
  const shape: NativeShapeSpec = {
    id: signal.id,
    shape: isBuy ? "arrow_up" : isSell ? "arrow_down" : "text",
    points: [nativePoint(signal.ts, placement?.arrowPrice ?? signal.price)],
    color,
    fontSize: isBuy || isSell ? 14 : 12,
    lineWidth: isBuy || isSell ? 2 : 1,
  };
  if (isBuy || isSell) shape.text = signalBadgeText(signal);
  if (!isBuy && !isSell) shape.text = signalText(signal);
  return shape;
}

function signalBoxNativeShape(
  signal: ChanlunSignal,
  stepMs: number,
  candles: SignalAnchorCandle[],
  lane: number,
): NativeShapeSpec | null {
  if (!signal.point || (signal.kind !== "candidate_buy" && signal.kind !== "candidate_sell")) return null;
  const placement = signalPlacement(signal, stepMs, candles, lane);
  if (!placement) return null;

  const isBuy = signal.kind === "candidate_buy";
  const color = isBuy ? "#34d399" : "#f87171";
  const fillColor = isBuy ? "#064e3b" : "#7f1d1d";
  return {
    id: `box:${signal.id}`,
    shape: "rectangle",
    points: [
      nativePoint(placement.startTs, placement.labelHigh),
      nativePoint(placement.endTs, placement.labelLow),
    ],
    color,
    fillColor,
    fillTransparency: 18,
    fontSize: 11,
    lineWidth: 2,
    cornerRadius: 9,
    text: signalBadgeText(signal, true),
  };
}

function fractalNativeShape(fractal: Fractal): NativeShapeSpec {
  return {
    id: fractal.id,
    shape: fractal.type === "top" ? "arrow_down" : "arrow_up",
    points: [nativePoint(fractal.ts, fractal.price)],
    color: fractal.type === "top" ? "#f87171" : "#4ade80",
    text: fractal.type === "top" ? "顶" : "底",
  };
}

function zoneNativeShape(zone: Zhongshu, attached: boolean): NativeShapeSpec {
  return {
    id: zone.id,
    shape: "rectangle",
    points: [nativePoint(zone.startTs, zone.high), nativePoint(zone.endTs, zone.low)],
    color: "#ddd6fe",
    fillColor: "#ddd6fe",
    fillTransparency: 92,
    lineWidth: 1,
    transparency: 88,
    text: attached ? "最近中枢区" : `${zone.level === "segment" ? "段" : "笔"}中枢`,
  };
}

function buildNativeShapeSpecs(analysis: ChanlunAnalysis, chartLayers: ChartLayerVisibility): NativeShapeSpec[] {
  const layers = effectiveChartLayers(chartLayers);
  if (layers.bareK) return [];

  const stepMs = estimateStepMs(analysis.included);
  const recentSignals = analysis.signals.slice(-16);
  const biShapes = layers.showStructures
    ? analysis.bis.slice(-32).map((bi) => nativeLineShape(`bi:${bi.id}`, bi.start, bi.end, "#cbd5e1", 1))
    : [];
  const segmentShapes = layers.showStructures
    ? analysis.segments
        .slice(-16)
        .map((segment) => nativeLineShape(`segment:${segment.id}`, segment.start, segment.end, "#f59e0b", 2))
    : [];
  const zoneShapes = layers.showStructures ? analysis.zhongshu.slice(-4).map((zone) => zoneNativeShape(zone, true)) : [];
  const signalBoxShapes = layers.showSignals
    ? recentSignals
        .map((signal, index) => signalBoxNativeShape(signal, stepMs, analysis.included, index % 2))
        .filter((shape): shape is NativeShapeSpec => shape !== null)
    : [];
  const fractalShapes = layers.showFractals ? analysis.fractals.slice(-36).map(fractalNativeShape) : [];
  const signalShapes = layers.showSignals
    ? recentSignals.map((signal, index) => signalShape(signal, stepMs, analysis.included, index % 2))
    : [];

  return [...zoneShapes, ...signalBoxShapes, ...biShapes, ...segmentShapes, ...fractalShapes, ...signalShapes];
}

function postNativeBridgeMessage(type: "CHANLUN_TV_DRAW" | "CHANLUN_TV_CLEAR" | "CHANLUN_TV_PING", payload?: unknown) {
  window.postMessage(
    {
      source: NATIVE_BRIDGE_SOURCE,
      type,
      payload,
    },
    "*",
  );
}

export const ChartView = forwardRef<ChartViewHandle, ChartViewProps>(function ChartView(
  { candles, analysis, chartLayers = DEFAULT_CHART_LAYERS, resetKey, attached = false },
  ref,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const biSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const segmentSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const markerRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const analysisRef = useRef<ChanlunAnalysis | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const chartLayersRef = useRef<ChartLayerVisibility>(chartLayers);
  const lastResetKeyRef = useRef<string | null>(null);
  const [zones, setZones] = useState<OverlayShape[]>([]);
  const [nativeStatus, setNativeStatus] = useState<NativeBridgeStatus>({
    connected: false,
    reason: "probing native chart",
    shapes: 0,
  });

  const candleData = useMemo(() => candles.map(toCandleData), [candles]);
  const validTimes = useMemo(() => new Set(candleData.map((item) => Number(item.time))), [candleData]);

  useImperativeHandle(ref, () => ({
    exportPng() {
      const canvas = chartRef.current?.takeScreenshot();
      if (!canvas) return;
      const link = document.createElement("a");
      link.download = `chanlun-okx-${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    },
  }));

  useEffect(() => {
    analysisRef.current = analysis;
  }, [analysis]);

  useEffect(() => {
    candlesRef.current = candles;
  }, [candles]);

  useEffect(() => {
    chartLayersRef.current = chartLayers;
  }, [chartLayers]);

  useEffect(() => {
    if (!attached) return undefined;

    const handleStatus = (event: MessageEvent) => {
      const data = event.data as
        | {
            source?: string;
            type?: string;
            payload?: Partial<NativeBridgeStatus>;
          }
        | undefined;

      if (data?.source !== NATIVE_BRIDGE_SOURCE || data.type !== "CHANLUN_TV_STATUS") return;
      setNativeStatus({
        connected: Boolean(data.payload?.connected),
        reason: data.payload?.reason ?? "native chart status changed",
        shapes: data.payload?.shapes ?? 0,
      });
    };

    setNativeStatus({ connected: false, reason: "probing native chart", shapes: 0 });
    window.addEventListener("message", handleStatus);
    postNativeBridgeMessage("CHANLUN_TV_PING");

    const timeout = window.setTimeout(() => {
      setNativeStatus((current) =>
        current.connected
          ? current
          : { connected: false, reason: "native chart bridge not connected", shapes: 0 },
      );
    }, 2_000);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleStatus);
      postNativeBridgeMessage("CHANLUN_TV_CLEAR");
    };
  }, [attached]);

  useEffect(() => {
    if (attached || !containerRef.current) return;
    lastResetKeyRef.current = null;

    const chart = createChart(containerRef.current, {
      autoSize: true,
      handleScroll: !attached,
      handleScale: !attached,
      layout: {
        background: {
          type: ColorType.Solid,
          color: attached ? "rgba(0, 0, 0, 0)" : "#0b0f14",
        },
        textColor: attached ? "rgba(203, 213, 225, 0.78)" : "#a7b1c2",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
      },
      grid: {
        vertLines: { color: attached ? "rgba(148, 163, 184, 0.025)" : "rgba(148, 163, 184, 0.08)" },
        horzLines: { color: attached ? "rgba(148, 163, 184, 0.035)" : "rgba(148, 163, 184, 0.08)" },
      },
      rightPriceScale: {
        visible: !attached,
        borderVisible: !attached,
        borderColor: "rgba(148, 163, 184, 0.22)",
      },
      timeScale: {
        visible: !attached,
        borderVisible: !attached,
        borderColor: "rgba(148, 163, 184, 0.22)",
        timeVisible: true,
        secondsVisible: false,
        rightOffset: attached ? 10 : 0,
      },
      crosshair: {
        vertLine: { color: "rgba(245, 158, 11, 0.5)" },
        horzLine: { color: "rgba(245, 158, 11, 0.5)" },
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: attached ? "rgba(22, 199, 132, 0.74)" : "#16c784",
      downColor: attached ? "rgba(234, 57, 67, 0.78)" : "#ea3943",
      borderVisible: false,
      wickUpColor: attached ? "rgba(22, 199, 132, 0.8)" : "#16c784",
      wickDownColor: attached ? "rgba(234, 57, 67, 0.82)" : "#ea3943",
    });
    const biSeries = chart.addSeries(LineSeries, {
      color: attached ? "rgba(226, 232, 240, 0.78)" : "#f59e0b",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const segmentSeries = chart.addSeries(LineSeries, {
      color: attached ? "rgba(245, 158, 11, 0.86)" : "#38bdf8",
      lineWidth: attached ? 2 : 4,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    biSeriesRef.current = biSeries;
    segmentSeriesRef.current = segmentSeries;
    markerRef.current = createSeriesMarkers(candleSeries, []);

    const resizeObserver = new ResizeObserver(() => {
      const currentAnalysis = analysisRef.current;
      if (currentAnalysis?.zhongshu) {
        setZones(
          measureOverlayShapes(
            chart,
            candleSeries,
            currentAnalysis.zhongshu,
            currentAnalysis.signals,
            candlesRef.current,
            attached,
            containerRef.current?.clientWidth ?? 0,
            chartLayersRef.current,
          ),
        );
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      biSeriesRef.current = null;
      segmentSeriesRef.current = null;
      markerRef.current = null;
    };
  }, [attached]);

  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const chart = chartRef.current;
    if (attached || !candleSeries || !chart) return;

    candleSeries.setData(candleData);
    if (candleData.length && lastResetKeyRef.current !== resetKey) {
      chart.timeScale().fitContent();
      lastResetKeyRef.current = resetKey;
    }
  }, [attached, candleData, resetKey]);

  useEffect(() => {
    if (attached) {
      if (analysis) {
        const shapes = buildNativeShapeSpecs(analysis, chartLayers);
        postNativeBridgeMessage("CHANLUN_TV_DRAW", { shapes });
      } else {
        postNativeBridgeMessage("CHANLUN_TV_CLEAR");
      }
      setZones([]);
      return undefined;
    }

    const layers = effectiveChartLayers(chartLayers);
    markerRef.current?.setMarkers(buildMarkers(analysis, validTimes, layers));

    const biPoints = analysis && layers.showStructures
      ? linePointsFromFractals(
          [analysis.bis[0]?.start, ...analysis.bis.map((bi) => bi.end)].filter(isFractal),
        )
      : [];
    const segmentPoints = analysis && layers.showStructures
      ? linePointsFromFractals(
          [analysis.segments[0]?.start, ...analysis.segments.map((segment) => segment.end)].filter(
            isFractal,
          ),
        )
      : [];

    biSeriesRef.current?.setData(biPoints);
    segmentSeriesRef.current?.setData(segmentPoints);

    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (chart && candleSeries && analysis) {
      const updateZones = () =>
        setZones(
          measureOverlayShapes(
            chart,
            candleSeries,
            analysis.zhongshu,
            analysis.signals,
            candlesRef.current,
            attached,
            containerRef.current?.clientWidth ?? 0,
            layers,
          ),
        );
      updateZones();
      chart.timeScale().subscribeVisibleLogicalRangeChange(updateZones);
      return () => chart.timeScale().unsubscribeVisibleLogicalRangeChange(updateZones);
    }
    setZones([]);
  }, [analysis, attached, chartLayers, validTimes]);

  const switchToTradingView = () => {
    window.dispatchEvent(new CustomEvent(SWITCH_TRADINGVIEW_EVENT));
    setNativeStatus({
      connected: false,
      reason: "switching to TradingView mode",
      shapes: 0,
    });
    window.setTimeout(() => {
      postNativeBridgeMessage("CHANLUN_TV_PING");
      if (analysis) postNativeBridgeMessage("CHANLUN_TV_DRAW", { shapes: buildNativeShapeSpecs(analysis, chartLayers) });
    }, 1_400);
  };

  if (attached) {
    return (
      <div className="cv-native-sync-layer">
        {!nativeStatus.connected && (
          <div className="cv-native-sync-warning">
            <strong>当前 OKX 原生版不暴露可用绘图接口。</strong>
            <span>已暂停贴图，避免虚假匹配；切到 TradingView 后会尝试使用原生 shape 贴合 K 线。</span>
            <button type="button" onClick={switchToTradingView}>
              切换 TradingView
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="cv-chart-wrap">
      <div ref={containerRef} className="cv-chart" />
      <svg className="cv-zone-layer" aria-hidden="true">
        {zones.map((zone) => {
          const isSignalBox = zone.variant === "candidate-buy-box" || zone.variant === "candidate-sell-box";
          const labelLines = zone.label.split("\n");
          const textLineHeight = isSignalBox ? 12 : 14;
          const textY = isSignalBox
            ? zone.y + zone.height / 2 - ((labelLines.length - 1) * textLineHeight) / 2 + 4
            : zone.y + Math.min(24, Math.max(14, zone.height / 2));
          return (
            <g key={zone.id}>
              <rect
                x={zone.x}
                y={zone.y}
                width={zone.width}
                height={zone.height}
                rx={isSignalBox ? "9" : "4"}
                className={`cv-zone-rect cv-zone-${zone.variant}`}
              />
              <text
                x={zone.x + zone.width / 2}
                y={textY}
                textAnchor="middle"
                className={`cv-zone-label cv-zone-label-${zone.variant}`}
              >
                {labelLines.map((line, index) => (
                  <tspan key={line} x={zone.x + zone.width / 2} dy={index === 0 ? 0 : textLineHeight}>
                    {line}
                  </tspan>
                ))}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
});
