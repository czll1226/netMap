import { useEffect, useState } from "react";
import type { RuntimeInfo } from "./types";
import { getRuntimeInfo } from "./api";

const featureList = [
  "导入地图或图纸作为勘测底图",
  "按一段已知距离进行比例校准",
  "在地图点位上采集当前 WiFi 的 AP 信号数据",
  "按 AP / SSID 生成覆盖热力图",
];

function App() {
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null);

  useEffect(() => {
    getRuntimeInfo().then(setRuntime).catch(console.error);
  }, []);

  return (
    <main className="app-shell">
      <section className="hero-panel">
        <div className="eyebrow">WiFi Survey Workbench</div>
        <h1>室内 WiFi 热力图勘测工具</h1>
        <p>
          这个桌面应用会把地图校准、Windows WiFi 扫描、采样记录和热力图生成放到同一个工作流里。
        </p>
        <div className="runtime-card">
          <span>运行环境</span>
          <strong>{runtime ? `${runtime.platform} / ${runtime.surveyMode}` : "加载中..."}</strong>
        </div>
      </section>

      <section className="feature-panel">
        <h2>当前骨架已就绪</h2>
        <ul>
          {featureList.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default App;
