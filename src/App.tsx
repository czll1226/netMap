import type { ChangeEvent, MouseEvent } from "react";
import { useEffect, useState } from "react";
import { getRuntimeInfo, scanWifiEnvironment } from "./api";
import {
  createMapCalibration,
  createSurveySample,
  estimateAccessPointPosition,
  generateHeatmapCells,
  getStrongestBssid,
  getSurveySignalsForBssid,
  listSurveyAccessPoints,
  mapDistanceToMeters,
  pointToMeters,
} from "./surveyMath";
import type {
  MapAssetState,
  MapCalibration,
  MapPoint,
  RuntimeInfo,
  SurveyAccessPoint,
  SurveySample,
  WifiSnapshot,
} from "./types";

const DEFAULT_STAGE_ASPECT_RATIO = 1.6;

const workflowSteps = [
  "导入图纸或地图作为底图。",
  "输入一段已知距离的米数，然后在图上点两个端点完成比例校准。",
  "站到现场位置后执行一次扫描，再在图上点击当前位置落下采样点。",
  "切换目标 BSSID，查看同 SSID AP 的热力图和估算位置。",
];

const readFileAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("底图读取失败。"));
    };

    reader.onerror = () => reject(new Error("底图读取失败。"));
    reader.readAsDataURL(file);
  });

const readImageAspectRatio = (src: string) =>
  new Promise<number>((resolve, reject) => {
    const image = new Image();

    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error("底图尺寸不可用。"));
        return;
      }

      resolve(image.naturalWidth / image.naturalHeight);
    };

    image.onerror = () => reject(new Error("底图无法加载。"));
    image.src = src;
  });

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const normalizeMapPoint = (event: MouseEvent<HTMLDivElement>): MapPoint => {
  const rect = event.currentTarget.getBoundingClientRect();

  return {
    x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
    y: clamp((event.clientY - rect.top) / rect.height, 0, 1),
  };
};

const formatDbm = (value: number | null) => (value === null ? "--" : `${value} dBm`);

const formatQuality = (value: number | null) => (value === null ? "--" : `${value}%`);

const formatNumber = (value: number, digits = 1) => value.toFixed(digits);

const formatPercentPoint = (point: MapPoint) => `${formatNumber(point.x * 100)}%, ${formatNumber(point.y * 100)}%`;

const formatMetersPoint = (point: MapPoint, calibration: MapCalibration | null) => {
  if (!calibration) {
    return formatPercentPoint(point);
  }

  const metersPoint = pointToMeters(point, calibration);
  return `${formatNumber(metersPoint.xMeters)}m, ${formatNumber(metersPoint.yMeters)}m`;
};

const formatTime = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

const getHeatColor = (intensity: number) => {
  const hue = 208 - intensity * 185;
  const alpha = 0.16 + intensity * 0.62;
  return `hsla(${hue}, 88%, ${58 - intensity * 16}%, ${alpha})`;
};

const getMarkerColor = (quality: number | null) => {
  const intensity = clamp((quality ?? 0) / 100, 0.12, 1);
  const hue = 208 - intensity * 185;
  return `hsl(${hue}, 88%, ${54 - intensity * 11}%)`;
};

const getAccessPointLabel = (accessPoint: SurveyAccessPoint) => {
  const ssidLabel = accessPoint.displaySsid || accessPoint.ssid || "未命名 AP";
  return `${ssidLabel} · ${accessPoint.bssid}`;
};

const getViewBox = (aspectRatio: number) => `0 0 ${aspectRatio} 1`;

function App() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);
  const [liveSnapshot, setLiveSnapshot] = useState<WifiSnapshot | null>(null);
  const [samples, setSamples] = useState<SurveySample[]>([]);
  const [mapAsset, setMapAsset] = useState<MapAssetState | null>(null);
  const [calibration, setCalibration] = useState<MapCalibration | null>(null);
  const [calibrationDistanceInput, setCalibrationDistanceInput] = useState("10");
  const [calibrationDraftPoints, setCalibrationDraftPoints] = useState<MapPoint[]>([]);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [loadingScan, setLoadingScan] = useState(false);
  const [pendingPlacement, setPendingPlacement] = useState(false);
  const [selectedBssid, setSelectedBssid] = useState("");
  const [uiMessage, setUiMessage] = useState("先导入底图并完成比例校准，然后扫描当前位置并在图上落点。");
  const [uiError, setUiError] = useState("");

  useEffect(() => {
    getRuntimeInfo().then(setRuntime).catch(console.error);
  }, []);

  const mapAspectRatio = mapAsset?.aspectRatio ?? DEFAULT_STAGE_ASPECT_RATIO;
  const accessPoints = listSurveyAccessPoints(samples, liveSnapshot);
  const selectedAccessPoint = accessPoints.find((item) => item.bssid === selectedBssid) ?? null;
  const estimate = selectedBssid ? estimateAccessPointPosition(samples, selectedBssid) : null;
  const heatmapCells = selectedBssid ? generateHeatmapCells(samples, selectedBssid, estimate, mapAspectRatio) : [];
  const selectedSignals = selectedBssid ? getSurveySignalsForBssid(samples, selectedBssid).reverse() : [];
  const surveyNetworkLabel =
    liveSnapshot?.connectedNetwork?.displaySsid ??
    accessPoints[0]?.displaySsid ??
    liveSnapshot?.connectedNetwork?.ssid ??
    "未识别";
  const currentSameSsidCount = liveSnapshot?.relatedAccessPoints.length ?? 0;
  const calibrationDistance = calibration ? mapDistanceToMeters(calibration.start, calibration.end, calibration) : null;

  useEffect(() => {
    if (selectedBssid && accessPoints.some((item) => item.bssid === selectedBssid)) {
      return;
    }

    const fallback = getStrongestBssid(liveSnapshot) || accessPoints[0]?.bssid || "";
    if (fallback !== selectedBssid) {
      setSelectedBssid(fallback);
    }
  }, [accessPoints, liveSnapshot, selectedBssid]);

  const handleScan = async () => {
    setLoadingScan(true);
    setUiError("");

    try {
      const snapshot = await scanWifiEnvironment();
      const strongestBssid = getStrongestBssid(snapshot);

      setLiveSnapshot(snapshot);
      setPendingPlacement(true);
      setUiMessage(
        `扫描完成，识别到 ${snapshot.relatedAccessPoints.length || snapshot.visibleAccessPoints.length} 个同 SSID AP。请在图上点击当前位置，记录这次采样。`,
      );

      if (!selectedBssid && strongestBssid) {
        setSelectedBssid(strongestBssid);
      }
    } catch (error) {
      setPendingPlacement(false);
      setUiError(error instanceof Error ? error.message : "WiFi 扫描失败。");
    } finally {
      setLoadingScan(false);
    }
  };

  const handleMapUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    setUiError("");

    try {
      const dataUrl = await readFileAsDataUrl(file);
      const aspectRatio = await readImageAspectRatio(dataUrl);

      setMapAsset({
        name: file.name,
        dataUrl,
        aspectRatio,
      });
      setCalibration(null);
      setCalibrationDraftPoints([]);
      setIsCalibrating(false);
      setUiMessage("底图已加载。先做比例校准，再开始扫描和采样。");
    } catch (error) {
      setUiError(error instanceof Error ? error.message : "底图导入失败。");
    } finally {
      event.target.value = "";
    }
  };

  const handleStartCalibration = () => {
    const distanceMeters = Number(calibrationDistanceInput);

    if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
      setUiError("校准距离必须是大于 0 的数字。");
      return;
    }

    setUiError("");
    setPendingPlacement(false);
    setCalibrationDraftPoints([]);
    setIsCalibrating(true);
    setUiMessage("比例校准模式已开启。请在地图上依次点击已知距离的两个端点。");
  };

  const handleClearCalibration = () => {
    setCalibration(null);
    setCalibrationDraftPoints([]);
    setIsCalibrating(false);
    setUiMessage("比例校准已清除。你可以重新标记已知距离。");
  };

  const handleRemoveLastSample = () => {
    if (!samples.length) {
      setUiMessage("当前还没有可撤销的采样点。");
      return;
    }

    setSamples((current) => current.slice(0, -1));
    setUiMessage("已移除最后一个采样点。");
  };

  const handleClearSamples = () => {
    setSamples([]);
    setPendingPlacement(false);
    setUiMessage("已清空所有采样点。");
  };

  const handleMapClick = (event: MouseEvent<HTMLDivElement>) => {
    setUiError("");
    const point = normalizeMapPoint(event);

    if (isCalibrating) {
      if (!calibrationDraftPoints.length) {
        setCalibrationDraftPoints([point]);
        setUiMessage("已记录第一个端点。请点击第二个端点完成比例校准。");
        return;
      }

      const distanceMeters = Number(calibrationDistanceInput);
      const nextCalibration = createMapCalibration(calibrationDraftPoints[0], point, distanceMeters, mapAspectRatio);

      if (!nextCalibration) {
        setUiError("校准失败：两个点太近了，或者距离值无效。");
        return;
      }

      setCalibration(nextCalibration);
      setCalibrationDraftPoints([]);
      setIsCalibrating(false);
      setUiMessage(`比例校准完成：标注线段代表 ${formatNumber(distanceMeters, 2)} 米。`);
      return;
    }

    if (!liveSnapshot || !pendingPlacement) {
      setUiMessage("请先执行一次新的 WiFi 扫描，再点击地图落下采样点。");
      return;
    }

    const label = `P${samples.length + 1}`;
    const nextSample = createSurveySample(liveSnapshot, point.x, point.y, label);

    if (!nextSample.readings.length) {
      setUiError("这次扫描没有得到可用于热力图的同 SSID AP 读数。");
      return;
    }

    setSamples((current) => [...current, nextSample]);
    setPendingPlacement(false);
    setUiMessage(`${label} 已保存。移动到下一个位置后重新扫描，再继续在图上落点。`);
  };

  const calibrationStartPoint = calibrationDraftPoints[0] ?? calibration?.start ?? null;
  const calibrationMidpoint =
    calibration && calibrationDistance
      ? {
          x: (calibration.start.x + calibration.end.x) / 2,
          y: (calibration.start.y + calibration.end.y) / 2,
        }
      : null;

  return (
    <main className="app-shell">
      <section className="workspace-panel">
        <header className="hero-header">
          <div className="eyebrow">WiFi Survey Workbench</div>
          <h1>把同 SSID 的 AP 覆盖落到地图上</h1>
          <p className="hero-copy">
            导入底图、做米制比例校准、在现场每个位置扫描一次，然后把当前点位的 WiFi 读数落到地图上生成热力图。
          </p>
        </header>

        <div className="stat-grid">
          <article className="stat-card">
            <span>运行环境</span>
            <strong>{runtime ? `${runtime.platform} / ${runtime.surveyMode}` : "加载中..."}</strong>
            <small>{runtime ? `本地服务端口 ${runtime.backendPort}` : "等待本地服务连接"}</small>
          </article>
          <article className="stat-card">
            <span>当前网络</span>
            <strong>{surveyNetworkLabel}</strong>
            <small>{liveSnapshot?.connectedNetwork?.bssid ?? "先扫描获取当前 BSSID"}</small>
          </article>
          <article className="stat-card">
            <span>采样点</span>
            <strong>{samples.length}</strong>
            <small>{pendingPlacement ? "已扫描，等待落点" : "等待下一次扫描"}</small>
          </article>
          <article className="stat-card">
            <span>可见同 SSID AP</span>
            <strong>{currentSameSsidCount || accessPoints.length}</strong>
            <small>{selectedAccessPoint ? `当前目标 ${selectedAccessPoint.bssid}` : "先扫描后选择"}</small>
          </article>
        </div>

        <div className="stage-toolbar">
          <label className="upload-button">
            导入底图
            <input type="file" accept="image/*" onChange={handleMapUpload} />
          </label>
          <button type="button" className="secondary-button" onClick={handleRemoveLastSample}>
            撤销最后一个点
          </button>
          <button type="button" className="ghost-button" onClick={handleClearSamples}>
            清空采样
          </button>
        </div>

        {uiError ? <div className="error-banner">{uiError}</div> : null}
        <div className={`stage-banner ${pendingPlacement ? "is-live" : ""}`}>{uiMessage}</div>

        <div
          className={`map-stage ${isCalibrating ? "is-calibrating" : ""}`}
          onClick={handleMapClick}
          style={{ aspectRatio: `${mapAspectRatio}` }}
        >
          {mapAsset ? (
            <img className="map-image" src={mapAsset.dataUrl} alt={mapAsset.name} />
          ) : (
            <div className="map-placeholder">
              <strong>先放底图，再把现场信号画进去</strong>
              <span>没有图也可以先扫描和落点，之后导入底图继续勘测。</span>
            </div>
          )}

          <div className="map-grid" />

          {heatmapCells.length ? (
            <svg className="heatmap-layer" viewBox={getViewBox(mapAspectRatio)} preserveAspectRatio="none" aria-hidden="true">
              {heatmapCells.map((cell, index) => (
                <rect
                  key={`${cell.x}-${cell.y}-${index}`}
                  x={cell.x * mapAspectRatio}
                  y={cell.y}
                  width={cell.width * mapAspectRatio}
                  height={cell.height}
                  fill={getHeatColor(cell.intensity)}
                />
              ))}
            </svg>
          ) : null}

          {(calibrationStartPoint || calibration) ? (
            <svg className="calibration-layer" viewBox={getViewBox(mapAspectRatio)} preserveAspectRatio="none" aria-hidden="true">
              {calibration ? (
                <>
                  <line
                    x1={calibration.start.x * mapAspectRatio}
                    y1={calibration.start.y}
                    x2={calibration.end.x * mapAspectRatio}
                    y2={calibration.end.y}
                    className="calibration-line"
                  />
                  <circle
                    cx={calibration.start.x * mapAspectRatio}
                    cy={calibration.start.y}
                    r={0.012}
                    className="calibration-point"
                  />
                  <circle
                    cx={calibration.end.x * mapAspectRatio}
                    cy={calibration.end.y}
                    r={0.012}
                    className="calibration-point"
                  />
                </>
              ) : null}

              {!calibration && calibrationStartPoint ? (
                <circle
                  cx={calibrationStartPoint.x * mapAspectRatio}
                  cy={calibrationStartPoint.y}
                  r={0.012}
                  className="calibration-point is-draft"
                />
              ) : null}
            </svg>
          ) : null}

          {samples.map((sample, index) => {
            const reading = sample.readings.find((item) => item.bssid === selectedBssid) ?? null;
            const quality = reading?.signalQuality ?? null;

            return (
              <div
                key={sample.id}
                className={`sample-marker ${reading ? "has-reading" : "is-muted"}`}
                style={{
                  left: `${sample.x * 100}%`,
                  top: `${sample.y * 100}%`,
                  background: getMarkerColor(quality),
                }}
              >
                <span>{index + 1}</span>
              </div>
            );
          })}

          {estimate ? (
            <div
              className="estimate-marker"
              style={{
                left: `${estimate.x * 100}%`,
                top: `${estimate.y * 100}%`,
              }}
            >
              <span>AP</span>
            </div>
          ) : null}

          <div className="stage-overlay">
            <div className="overlay-chip">{mapAsset ? `底图：${mapAsset.name}` : "当前为示意画布"}</div>
            <div className="overlay-chip subtle">
              {selectedAccessPoint ? `热力图目标：${selectedAccessPoint.bssid}` : "先扫描并选择要分析的 BSSID"}
            </div>
            {pendingPlacement ? <div className="overlay-chip accent">扫描完成，等待地图落点</div> : null}
            {isCalibrating ? <div className="overlay-chip warning">比例校准模式</div> : null}
          </div>

          {calibrationMidpoint && calibrationDistance ? (
            <div
              className="calibration-label"
              style={{
                left: `${calibrationMidpoint.x * 100}%`,
                top: `${calibrationMidpoint.y * 100}%`,
              }}
            >
              {formatNumber(calibrationDistance, 2)} m
            </div>
          ) : null}
        </div>

        <div className="legend-row">
          <div className="legend-scale">
            <span>弱</span>
            <div className="legend-gradient" />
            <span>强</span>
          </div>
          <div className="legend-notes">
            <span>圆点表示采样点</span>
            <span>菱形表示估算 AP 位置</span>
            <span>颜色越暖，信号越强</span>
          </div>
        </div>
      </section>

      <aside className="control-panel">
        <section className="panel-block">
          <h2>采集流程</h2>
          <ul className="step-list">
            {workflowSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>

        <section className="panel-block">
          <div className="panel-heading">
            <h2>地图与比例</h2>
            <button type="button" className="secondary-button compact-button" onClick={handleStartCalibration}>
              开始校准
            </button>
          </div>

          <div className="field">
            <span>已知距离</span>
            <div className="input-row">
              <input
                className="number-input"
                type="number"
                min="0.1"
                step="0.1"
                value={calibrationDistanceInput}
                onChange={(event) => setCalibrationDistanceInput(event.target.value)}
              />
              <span className="input-suffix">米</span>
            </div>
          </div>

          <div className="calibration-summary">
            <div>
              <span>底图</span>
              <strong>{mapAsset?.name ?? "未导入"}</strong>
            </div>
            <div>
              <span>比例状态</span>
              <strong>{calibration ? "已校准" : isCalibrating ? "校准中" : "未校准"}</strong>
            </div>
            <div>
              <span>线段长度</span>
              <strong>{calibrationDistance ? `${formatNumber(calibrationDistance, 2)} m` : "--"}</strong>
            </div>
          </div>

          <div className="action-row">
            <button type="button" className="ghost-button compact-button" onClick={handleClearCalibration}>
              清除比例
            </button>
          </div>

          {calibration ? (
            <p className="helper-copy">采样点和 AP 估算都会按这条标注线转换成米制坐标。更换底图后请重新校准。</p>
          ) : (
            <p className="helper-copy">输入米数后点击“开始校准”，再到地图上依次点两个端点。</p>
          )}
        </section>

        <section className="panel-block">
          <div className="panel-heading">
            <h2>当前位置扫描</h2>
            <button type="button" className="primary-button compact-button" onClick={handleScan} disabled={loadingScan}>
              {loadingScan ? "扫描中..." : "扫描当前位置"}
            </button>
          </div>

          {liveSnapshot?.connectedNetwork ? (
            <>
              <div className="summary-grid">
                <div>
                  <span>当前 SSID</span>
                  <strong>{liveSnapshot.connectedNetwork.displaySsid}</strong>
                </div>
                <div>
                  <span>当前 BSSID</span>
                  <strong className="mono-text">{liveSnapshot.connectedNetwork.bssid}</strong>
                </div>
                <div>
                  <span>信号</span>
                  <strong>
                    {formatQuality(liveSnapshot.connectedNetwork.signalQuality)} /{" "}
                    {formatDbm(liveSnapshot.connectedNetwork.signalDbm)}
                  </strong>
                </div>
              </div>
              <p className="helper-copy">
                最近一次扫描时间 {formatTime(liveSnapshot.scannedAt)}。当前共识别 {currentSameSsidCount || 1} 个同 SSID AP。
              </p>
            </>
          ) : (
            <p className="empty-copy">先执行一次扫描，系统才能记录当前位置的同 SSID AP 读数。</p>
          )}
        </section>

        <section className="panel-block">
          <h2>热力图目标</h2>
          <label className="field">
            <span>选择 BSSID</span>
            <select value={selectedBssid} onChange={(event) => setSelectedBssid(event.target.value)}>
              <option value="">请选择一个 AP</option>
              {accessPoints.map((accessPoint) => (
                <option key={accessPoint.bssid} value={accessPoint.bssid}>
                  {getAccessPointLabel(accessPoint)}
                </option>
              ))}
            </select>
          </label>

          {selectedAccessPoint ? (
            <div className="estimate-card">
              <div>
                <span>目标 AP</span>
                <strong>{selectedAccessPoint.displaySsid || selectedAccessPoint.bssid}</strong>
                <small className="mono-text">{selectedAccessPoint.bssid}</small>
              </div>
              <div>
                <span>样本数</span>
                <strong>{selectedAccessPoint.sampleCount}</strong>
                <small>最强 {formatDbm(selectedAccessPoint.strongestSignalDbm)}</small>
              </div>
              <div>
                <span>估算位置</span>
                <strong>{estimate ? formatMetersPoint(estimate, calibration) : "--"}</strong>
                <small>{estimate ? `置信度 ${Math.round(estimate.confidence * 100)}%` : "需要更多采样点"}</small>
              </div>
            </div>
          ) : (
            <p className="empty-copy">扫描并积累采样点后，再从这里选择要观察的 AP。</p>
          )}

          <div className="ap-chip-list">
            {accessPoints.length ? (
              accessPoints.map((accessPoint) => (
                <button
                  key={accessPoint.bssid}
                  type="button"
                  className={`ap-chip ${selectedBssid === accessPoint.bssid ? "is-selected" : ""}`}
                  onClick={() => setSelectedBssid(accessPoint.bssid)}
                >
                  <strong>{accessPoint.displaySsid || accessPoint.bssid}</strong>
                  <span className="mono-text">{accessPoint.bssid}</span>
                  <small>
                    {accessPoint.sampleCount} 个样本 / {formatDbm(accessPoint.strongestSignalDbm)}
                  </small>
                </button>
              ))
            ) : (
              <p className="empty-copy">还没有可用于热力图的 AP 数据。</p>
            )}
          </div>
        </section>

        <section className="panel-block">
          <h2>样本读数</h2>
          {selectedSignals.length ? (
            <ul className="signal-list">
              {selectedSignals.map(({ sample, reading }) => (
                <li key={sample.id}>
                  <div>
                    <strong>{sample.label}</strong>
                    <span>{formatMetersPoint(sample, calibration)}</span>
                  </div>
                  <div>
                    <strong>
                      {formatQuality(reading.signalQuality)} / {formatDbm(reading.signalDbm)}
                    </strong>
                    <span>{formatTime(sample.capturedAt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty-copy">当前目标 BSSID 还没有采样读数。先扫描并在图上落几个点。</p>
          )}
        </section>
      </aside>
    </main>
  );
}

export default App;
