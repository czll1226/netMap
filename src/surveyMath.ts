import type {
  AccessPoint,
  AccessPointEstimate,
  ConnectedNetwork,
  HeatmapCell,
  MapCalibration,
  MapPoint,
  SurveyAccessPoint,
  SurveyReading,
  SurveySample,
  WifiSnapshot,
} from "./types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const roundTo = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const qualityFromDbm = (signalDbm: number | null) => {
  if (signalDbm === null) {
    return null;
  }

  return clamp(Math.round((signalDbm + 100) * 2), 0, 100);
};

const qualityFromReading = (reading: Pick<SurveyReading, "signalQuality" | "signalDbm">) =>
  reading.signalQuality ?? qualityFromDbm(reading.signalDbm);

const dbmFromReading = (reading: Pick<SurveyReading, "signalQuality" | "signalDbm">) => {
  if (reading.signalDbm !== null) {
    return reading.signalDbm;
  }

  if (reading.signalQuality === null) {
    return null;
  }

  return Math.round(reading.signalQuality / 2 - 100);
};

const compareSignalStrength = (left: SurveyReading, right: SurveyReading) => {
  const leftQuality = qualityFromReading(left) ?? -1;
  const rightQuality = qualityFromReading(right) ?? -1;

  if (leftQuality !== rightQuality) {
    return rightQuality - leftQuality;
  }

  return (right.signalDbm ?? -120) - (left.signalDbm ?? -120);
};

const toSurveyReadingFromAccessPoint = (item: AccessPoint): SurveyReading => ({
  bssid: item.bssid,
  ssid: item.ssid,
  displaySsid: item.displaySsid,
  connected: item.connected,
  signalQuality: item.signalQuality,
  signalDbm: item.signalDbm,
  band: item.band,
  channel: item.channel,
});

const toSurveyReadingFromConnectedNetwork = (item: ConnectedNetwork): SurveyReading => ({
  bssid: item.bssid,
  ssid: item.ssid,
  displaySsid: item.displaySsid,
  connected: true,
  signalQuality: item.signalQuality,
  signalDbm: item.signalDbm,
  band: item.band,
  channel: item.channel,
});

const dedupeReadings = (readings: SurveyReading[]) => {
  const deduped = new Map<string, SurveyReading>();

  for (const reading of readings) {
    if (!reading.bssid) {
      continue;
    }

    const existing = deduped.get(reading.bssid);

    if (!existing || compareSignalStrength(existing, reading) > 0) {
      deduped.set(reading.bssid, reading);
    }
  }

  return [...deduped.values()].sort(compareSignalStrength);
};

const collectSnapshotReadings = (snapshot: WifiSnapshot | null): SurveyReading[] => {
  if (!snapshot) {
    return [];
  }

  const sourceAccessPoints = snapshot.connectedNetwork ? snapshot.relatedAccessPoints : snapshot.visibleAccessPoints;
  const readings = sourceAccessPoints.map(toSurveyReadingFromAccessPoint);

  if (snapshot.connectedNetwork?.bssid) {
    readings.push(toSurveyReadingFromConnectedNetwork(snapshot.connectedNetwork));
  }

  return dedupeReadings(readings);
};

const getSampleReadingsForBssid = (samples: SurveySample[], bssid: string) =>
  samples
    .map((sample) => {
      const reading = sample.readings.find((item) => item.bssid === bssid);

      if (!reading) {
        return null;
      }

      const quality = qualityFromReading(reading);
      const signalDbm = dbmFromReading(reading);

      if (quality === null) {
        return null;
      }

      return {
        sample,
        reading,
        quality,
        signalDbm,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

export const getStrongestBssid = (snapshot: WifiSnapshot | null) => collectSnapshotReadings(snapshot)[0]?.bssid ?? "";

export const createSurveySample = (
  snapshot: WifiSnapshot,
  x: number,
  y: number,
  label: string,
): SurveySample => ({
  id: `${snapshot.scannedAt}-${label}`,
  label,
  x,
  y,
  capturedAt: new Date().toISOString(),
  sourceScanAt: snapshot.scannedAt,
  readings: collectSnapshotReadings(snapshot),
});

export const listSurveyAccessPoints = (
  samples: SurveySample[],
  snapshot: WifiSnapshot | null,
): SurveyAccessPoint[] => {
  const catalog = new Map<
    string,
    SurveyAccessPoint & {
      sampleIds: Set<string>;
      signalTotal: number;
      signalCount: number;
    }
  >();

  const addReading = (reading: SurveyReading, sampleId?: string) => {
    if (!reading.bssid) {
      return;
    }

    const signalDbm = dbmFromReading(reading);
    const signalQuality = qualityFromReading(reading);
    const existing = catalog.get(reading.bssid);

    if (!existing) {
      catalog.set(reading.bssid, {
        bssid: reading.bssid,
        ssid: reading.ssid,
        displaySsid: reading.displaySsid,
        band: reading.band,
        channel: reading.channel,
        connected: reading.connected,
        sampleCount: sampleId ? 1 : 0,
        strongestSignalDbm: signalDbm,
        averageSignalDbm: signalDbm,
        strongestSignalQuality: signalQuality,
        sampleIds: new Set(sampleId ? [sampleId] : []),
        signalTotal: signalDbm ?? 0,
        signalCount: signalDbm === null || !sampleId ? 0 : 1,
      });
      return;
    }

    existing.connected = existing.connected || reading.connected;
    existing.band = existing.band || reading.band;
    existing.channel = existing.channel ?? reading.channel;

    if (
      signalQuality !== null &&
      (existing.strongestSignalQuality === null || signalQuality > existing.strongestSignalQuality)
    ) {
      existing.strongestSignalQuality = signalQuality;
      existing.strongestSignalDbm = signalDbm;
    }

    if (sampleId && !existing.sampleIds.has(sampleId)) {
      existing.sampleIds.add(sampleId);
      existing.sampleCount += 1;
    }

    if (sampleId && signalDbm !== null) {
      existing.signalTotal += signalDbm;
      existing.signalCount += 1;
      existing.averageSignalDbm = roundTo(existing.signalTotal / existing.signalCount, 1);
    }
  };

  for (const sample of samples) {
    for (const reading of sample.readings) {
      addReading(reading, sample.id);
    }
  }

  for (const reading of collectSnapshotReadings(snapshot)) {
    addReading(reading);
  }

  return [...catalog.values()]
    .map(({ sampleIds: _sampleIds, signalTotal: _signalTotal, signalCount: _signalCount, ...item }) => item)
    .sort((left, right) => {
      if (left.sampleCount !== right.sampleCount) {
        return right.sampleCount - left.sampleCount;
      }

      return (right.strongestSignalQuality ?? -1) - (left.strongestSignalQuality ?? -1);
    });
};

export const getSurveySignalsForBssid = (samples: SurveySample[], bssid: string) =>
  getSampleReadingsForBssid(samples, bssid).map((item) => ({
    sample: item.sample,
    reading: item.reading,
  }));

const pointToMapSpace = (point: MapPoint, aspectRatio: number) => ({
  x: point.x * aspectRatio,
  y: point.y,
});

const getMapDistanceUnits = (start: MapPoint, end: MapPoint, aspectRatio: number) => {
  const mapStart = pointToMapSpace(start, aspectRatio);
  const mapEnd = pointToMapSpace(end, aspectRatio);
  return Math.hypot(mapEnd.x - mapStart.x, mapEnd.y - mapStart.y);
};

export const createMapCalibration = (
  start: MapPoint,
  end: MapPoint,
  distanceMeters: number,
  aspectRatio: number,
): MapCalibration | null => {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return null;
  }

  const mapDistanceUnits = getMapDistanceUnits(start, end, aspectRatio);

  if (!Number.isFinite(mapDistanceUnits) || mapDistanceUnits < 0.0001) {
    return null;
  }

  return {
    start,
    end,
    distanceMeters,
    aspectRatio,
    metersPerMapUnit: distanceMeters / mapDistanceUnits,
  };
};

export const pointToMeters = (point: MapPoint, calibration: MapCalibration) => {
  const mapPoint = pointToMapSpace(point, calibration.aspectRatio);

  return {
    xMeters: roundTo(mapPoint.x * calibration.metersPerMapUnit, 2),
    yMeters: roundTo(mapPoint.y * calibration.metersPerMapUnit, 2),
  };
};

export const mapDistanceToMeters = (start: MapPoint, end: MapPoint, calibration: MapCalibration) =>
  roundTo(getMapDistanceUnits(start, end, calibration.aspectRatio) * calibration.metersPerMapUnit, 2);

export const estimateAccessPointPosition = (
  samples: SurveySample[],
  bssid: string,
): AccessPointEstimate | null => {
  const readings = getSampleReadingsForBssid(samples, bssid);

  if (!readings.length) {
    return null;
  }

  const ranked = [...readings].sort((left, right) => right.quality - left.quality);
  const workingSet = ranked.slice(0, Math.min(Math.max(3, Math.ceil(ranked.length * 0.65)), 7));
  const weakestQuality = workingSet[workingSet.length - 1]?.quality ?? workingSet[0].quality;

  let totalWeight = 0;
  let weightedX = 0;
  let weightedY = 0;

  for (const item of workingSet) {
    const weight = Math.pow(item.quality - weakestQuality + 8, 2);
    totalWeight += weight;
    weightedX += item.sample.x * weight;
    weightedY += item.sample.y * weight;
  }

  const x = totalWeight > 0 ? weightedX / totalWeight : workingSet[0].sample.x;
  const y = totalWeight > 0 ? weightedY / totalWeight : workingSet[0].sample.y;
  const averageDistance =
    workingSet.reduce((sum, item) => sum + Math.hypot(item.sample.x - x, item.sample.y - y), 0) / workingSet.length;
  const signalSpread = Math.max(0, workingSet[0].quality - weakestQuality);
  const confidence = clamp(
    0.18 +
      Math.min(readings.length, 6) * 0.09 +
      Math.min(signalSpread, 30) * 0.011 +
      Math.max(0, 0.34 - averageDistance) * 0.48,
    0.18,
    0.97,
  );
  const averageSignalDbm =
    readings.reduce((sum, item) => sum + (item.signalDbm ?? -100), 0) / Math.max(readings.length, 1);

  return {
    bssid,
    displaySsid: workingSet[0].reading.displaySsid,
    x,
    y,
    confidence,
    sampleCount: readings.length,
    strongestSignalDbm: workingSet[0].signalDbm,
    averageSignalDbm: roundTo(averageSignalDbm, 1),
  };
};

export const generateHeatmapCells = (
  samples: SurveySample[],
  bssid: string,
  estimate: AccessPointEstimate | null,
  aspectRatio: number,
  rows = 24,
): HeatmapCell[] => {
  const readings = getSampleReadingsForBssid(samples, bssid);

  if (!readings.length) {
    return [];
  }

  const columns = Math.max(18, Math.round(rows * aspectRatio));
  const peakSignal = Math.max(...readings.map((item) => item.quality));
  const floorSignal = Math.max(6, Math.min(...readings.map((item) => item.quality)) - 14);
  const cells: HeatmapCell[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const centerX = (column + 0.5) / columns;
      const centerY = (row + 0.5) / rows;
      let weightedSignal = 0;
      let totalWeight = 0;

      for (const item of readings) {
        const distance = Math.hypot(item.sample.x - centerX, item.sample.y - centerY);
        const weight = 1 / (distance * distance + 0.0028);
        weightedSignal += item.quality * weight;
        totalWeight += weight;
      }

      let signalQuality = totalWeight > 0 ? weightedSignal / totalWeight : peakSignal;

      if (estimate) {
        const estimateDistance = Math.hypot(estimate.x - centerX, estimate.y - centerY);
        const estimateRadius = clamp(0.18 + (1 - estimate.confidence) * 0.16, 0.16, 0.36);
        const radialSignal = clamp(peakSignal - (estimateDistance / estimateRadius) * 58, 0, 100);
        const blend = readings.length >= 4 ? 0.76 : 0.58;
        signalQuality = signalQuality * blend + radialSignal * (1 - blend);
      }

      const intensity = clamp((signalQuality - floorSignal) / Math.max(peakSignal - floorSignal, 1), 0, 1);

      if (intensity < 0.08) {
        continue;
      }

      cells.push({
        x: column / columns,
        y: row / rows,
        width: 1 / columns,
        height: 1 / rows,
        intensity,
        signalQuality,
      });
    }
  }

  return cells;
};
