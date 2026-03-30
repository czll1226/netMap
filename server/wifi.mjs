import { exec } from "node:child_process";

const gbkDecoder = new TextDecoder("gbk");

const keyMap = {
  // English
  name: "name",
  description: "description",
  guid: "guid",
  "physical address": "physicalAddress",
  "interface type": "interfaceType",
  state: "state",
  ssid: "ssid",
  bssid: "bssid",
  "network type": "networkType",
  "radio type": "radioType",
  authentication: "authentication",
  cipher: "cipher",
  encryption: "encryption",
  "connection mode": "connectionMode",
  band: "band",
  channel: "channel",
  signal: "signal",
  profile: "profile",
  "receive rate (mbps)": "receiveRateMbps",
  "transmit rate (mbps)": "transmitRateMbps",
  // Chinese (zh-CN)
  "名称": "name",
  "说明": "description",
  "物理地址": "physicalAddress",
  "界面类型": "interfaceType",
  "状态": "state",
  "网络类型": "networkType",
  "无线电类型": "radioType",
  "身份验证": "authentication",
  "密码": "cipher",
  "加密": "encryption",
  "连接模式": "connectionMode",
  "频带": "band",
  "通道": "channel",
  "信号": "signal",
  "配置文件": "profile",
  "接收速率(mbps)": "receiveRateMbps",
  "传输速率 (mbps)": "transmitRateMbps",
};

const toPercent = (value) => {
  const match = value.match(/(\d+)/);
  return match ? Number(match[1]) : null;
};

const toDbm = (quality) => {
  if (quality === null || Number.isNaN(quality)) {
    return null;
  }

  return Math.round(quality / 2 - 100);
};

const toNumber = (value) => {
  if (!value) {
    return null;
  }

  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const normalizeBssid = (value) => value.trim().toLowerCase();

const parseLine = (line) => {
  const match = line.match(/^\s*([^:]+?)\s*:\s*(.*)$/);
  if (!match) {
    return null;
  }

  return {
    rawKey: match[1].trim(),
    rawValue: match[2].trim(),
  };
};

const normalizeKey = (key) => key.toLowerCase().replace(/\s+/g, " ").trim();

const runNetsh = (args) =>
  new Promise((resolve, reject) => {
    exec(
      `netsh ${args}`,
      {
        windowsHide: true,
        encoding: "buffer",
        maxBuffer: 4 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        const stderrText = gbkDecoder.decode(stderr ?? Buffer.alloc(0)).trim();

        if (error) {
          reject(new Error(stderrText || error.message));
          return;
        }

        resolve(gbkDecoder.decode(stdout));
      },
    );
  });

const parseInterfaceSnapshot = (rawOutput) => {
  const interfaces = [];
  let currentInterface = null;

  for (const line of rawOutput.split(/\r?\n/)) {
    const parsed = parseLine(line);

    if (!parsed) {
      continue;
    }

    const normalizedKey = normalizeKey(parsed.rawKey);
    const mappedKey = keyMap[normalizedKey];

    if (mappedKey === "name") {
      if (currentInterface) {
        interfaces.push(currentInterface);
      }

      currentInterface = {};
    }

    if (!currentInterface || !mappedKey) {
      continue;
    }

    currentInterface[mappedKey] = parsed.rawValue;
  }

  if (currentInterface) {
    interfaces.push(currentInterface);
  }

  return interfaces.map((item) => {
    const signalQuality = toPercent(item.signal ?? "");
    const channel = toNumber(item.channel);

    return {
      name: item.name ?? "",
      description: item.description ?? "",
      guid: item.guid ?? "",
      physicalAddress: item.physicalAddress ?? "",
      interfaceType: item.interfaceType ?? "",
      state: item.state ?? "",
      ssid: item.ssid ?? "",
      displaySsid: item.profile || item.ssid || "",
      profile: item.profile ?? "",
      bssid: item.bssid ? normalizeBssid(item.bssid) : "",
      networkType: item.networkType ?? "",
      radioType: item.radioType ?? "",
      authentication: item.authentication ?? "",
      cipher: item.cipher ?? "",
      connectionMode: item.connectionMode ?? "",
      band: item.band ?? "",
      channel,
      signalQuality,
      signalDbm: toDbm(signalQuality),
      receiveRateMbps: toNumber(item.receiveRateMbps),
      transmitRateMbps: toNumber(item.transmitRateMbps),
    };
  });
};

const dedupeAccessPoints = (accessPoints) => {
  const deduped = new Map();

  for (const item of accessPoints) {
    const key = `${item.interfaceName}|${item.bssid || item.ssid}`;
    const existing = deduped.get(key);

    if (!existing || (existing.signalQuality ?? -1) < (item.signalQuality ?? -1)) {
      deduped.set(key, item);
    }
  }

  return [...deduped.values()];
};

const parseNetworkSnapshot = (rawOutput, connectedNetwork) => {
  const accessPoints = [];
  let currentInterfaceName = "";
  let currentSsid = "";
  let currentDisplaySsid = "";
  let currentSsidMetadata = {};
  let currentBssid = null;

  for (const line of rawOutput.split(/\r?\n/)) {
    const interfaceMatch = line.match(/^\s*(?:Interface name|接口名称)\s*:\s*(.+)$/i);
    if (interfaceMatch) {
      currentInterfaceName = interfaceMatch[1].trim();
      currentSsid = "";
      currentDisplaySsid = "";
      currentSsidMetadata = {};
      currentBssid = null;
      continue;
    }

    const ssidMatch = line.match(/^\s*SSID\s+\d+\s*:\s*(.*)$/i);
    if (ssidMatch) {
      currentSsid = ssidMatch[1].trim();
      currentDisplaySsid =
        connectedNetwork && connectedNetwork.ssid === currentSsid
          ? connectedNetwork.displaySsid
          : currentSsid;
      currentSsidMetadata = {
        networkType: "",
        authentication: "",
        encryption: "",
      };
      currentBssid = null;
      continue;
    }

    const bssidMatch = line.match(/^\s*BSSID\s+\d+\s*:\s*(.+)$/i);
    if (bssidMatch && currentSsid) {
      currentBssid = {
        interfaceName: currentInterfaceName,
        ssid: currentSsid,
        displaySsid: currentDisplaySsid,
        bssid: normalizeBssid(bssidMatch[1]),
        connected: Boolean(
          connectedNetwork &&
            connectedNetwork.bssid === normalizeBssid(bssidMatch[1]) &&
            connectedNetwork.name === currentInterfaceName,
        ),
        networkType: currentSsidMetadata.networkType ?? "",
        authentication: currentSsidMetadata.authentication ?? "",
        encryption: currentSsidMetadata.encryption ?? "",
        radioType: "",
        band: "",
        channel: null,
        signalQuality: null,
        signalDbm: null,
      };
      accessPoints.push(currentBssid);
      continue;
    }

    const parsed = parseLine(line);
    if (!parsed || !currentSsid) {
      continue;
    }

    const normalizedKey = normalizeKey(parsed.rawKey);

    const mappedKey = keyMap[normalizedKey];

    if (!currentBssid) {
      if (mappedKey === "networkType") {
        currentSsidMetadata.networkType = parsed.rawValue;
      }

      if (mappedKey === "authentication") {
        currentSsidMetadata.authentication = parsed.rawValue;
      }

      if (mappedKey === "encryption") {
        currentSsidMetadata.encryption = parsed.rawValue;
      }

      continue;
    }

    if (mappedKey === "signal") {
      currentBssid.signalQuality = toPercent(parsed.rawValue);
      currentBssid.signalDbm = toDbm(currentBssid.signalQuality);
      continue;
    }

    if (mappedKey === "radioType") {
      currentBssid.radioType = parsed.rawValue;
      continue;
    }

    if (mappedKey === "band") {
      currentBssid.band = parsed.rawValue;
      continue;
    }

    if (mappedKey === "channel") {
      currentBssid.channel = toNumber(parsed.rawValue);
    }
  }

  const deduped = dedupeAccessPoints(accessPoints);

  if (
    connectedNetwork &&
    !deduped.some(
      (item) => item.bssid === connectedNetwork.bssid && item.interfaceName === connectedNetwork.name,
    )
  ) {
    deduped.push({
      interfaceName: connectedNetwork.name,
      ssid: connectedNetwork.ssid,
      displaySsid: connectedNetwork.displaySsid,
      bssid: connectedNetwork.bssid,
      connected: true,
      networkType: connectedNetwork.networkType,
      authentication: connectedNetwork.authentication,
      encryption: connectedNetwork.cipher,
      radioType: connectedNetwork.radioType,
      band: connectedNetwork.band,
      channel: connectedNetwork.channel,
      signalQuality: connectedNetwork.signalQuality,
      signalDbm: connectedNetwork.signalDbm,
    });
  }

  return deduped;
};

export async function scanWifiEnvironment() {
  const [interfacesOutput, networksOutput] = await Promise.all([
    runNetsh("wlan show interfaces"),
    runNetsh("wlan show networks mode=bssid"),
  ]);

  const interfaces = parseInterfaceSnapshot(interfacesOutput);
  const connectedNetwork =
    interfaces.find((item) => {
      const s = item.state.toLowerCase();
      return s === "connected" || s === "已连接";
    }) ?? null;
  const visibleAccessPoints = parseNetworkSnapshot(networksOutput, connectedNetwork);
  const relatedAccessPoints = connectedNetwork
    ? visibleAccessPoints.filter((item) => item.ssid === connectedNetwork.ssid)
    : [];

  return {
    scannedAt: new Date().toISOString(),
    connectedNetwork,
    visibleAccessPoints,
    relatedAccessPoints,
  };
}
