export interface RuntimeInfo {
  platform: string;
  surveyMode: string;
  backendPort?: number;
}

export interface AccessPoint {
  interfaceName: string;
  ssid: string;
  displaySsid: string;
  bssid: string;
  connected: boolean;
  networkType: string;
  authentication: string;
  encryption: string;
  radioType: string;
  band: string;
  channel: number | null;
  signalQuality: number | null;
  signalDbm: number | null;
}

export interface ConnectedNetwork {
  name: string;
  description: string;
  guid: string;
  physicalAddress: string;
  interfaceType: string;
  state: string;
  ssid: string;
  displaySsid: string;
  profile: string;
  bssid: string;
  networkType: string;
  radioType: string;
  authentication: string;
  cipher: string;
  connectionMode: string;
  band: string;
  channel: number | null;
  signalQuality: number | null;
  signalDbm: number | null;
  receiveRateMbps: number | null;
  transmitRateMbps: number | null;
}

export interface WifiSnapshot {
  scannedAt: string;
  connectedNetwork: ConnectedNetwork | null;
  visibleAccessPoints: AccessPoint[];
  relatedAccessPoints: AccessPoint[];
}

export interface MapPoint {
  x: number;
  y: number;
}

export interface MapAssetState {
  name: string;
  dataUrl: string;
  aspectRatio: number;
}

export interface MapCalibration {
  start: MapPoint;
  end: MapPoint;
  distanceMeters: number;
  aspectRatio: number;
  metersPerMapUnit: number;
}

export interface SurveyReading {
  bssid: string;
  ssid: string;
  displaySsid: string;
  connected: boolean;
  signalQuality: number | null;
  signalDbm: number | null;
  band: string;
  channel: number | null;
}

export interface SurveySample extends MapPoint {
  id: string;
  label: string;
  capturedAt: string;
  sourceScanAt: string;
  readings: SurveyReading[];
}

export interface SurveyAccessPoint {
  bssid: string;
  ssid: string;
  displaySsid: string;
  band: string;
  channel: number | null;
  connected: boolean;
  sampleCount: number;
  strongestSignalDbm: number | null;
  averageSignalDbm: number | null;
  strongestSignalQuality: number | null;
}

export interface AccessPointEstimate extends MapPoint {
  bssid: string;
  displaySsid: string;
  confidence: number;
  sampleCount: number;
  strongestSignalDbm: number | null;
  averageSignalDbm: number | null;
}

export interface HeatmapCell {
  x: number;
  y: number;
  width: number;
  height: number;
  intensity: number;
  signalQuality: number;
}
