import { createServer } from "node:http";
import { exec } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173";
const port = Number(process.env.PORT ?? 8787);

const sendJson = (res, payload, statusCode = 200) => {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const sendText = (res, text, statusCode = 200) => {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
};

const runCommand = (command) =>
  new Promise((resolve, reject) => {
    exec(command, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }

      resolve(stdout);
    });
  });

const handleApi = async (req, res) => {
  if (req.url === "/api/runtime-info") {
    sendJson(res, {
      platform: process.platform,
      surveyMode: "local-service",
      backendPort: port,
    });
    return true;
  }

  if (req.url === "/api/health") {
    sendJson(res, { ok: true });
    return true;
  }

  if (req.url === "/api/scan" && req.method === "GET") {
    try {
      const output = await runCommand("netsh wlan show interfaces");
      sendJson(res, { raw: output });
    } catch (error) {
      sendJson(
        res,
        {
          message: error instanceof Error ? error.message : "WiFi scan failed.",
        },
        500,
      );
    }

    return true;
  }

  return false;
};

const resolveContentType = (filePath) => {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "application/octet-stream";
};

const server = createServer(async (req, res) => {
  if (!req.url) {
    sendText(res, "Bad Request", 400);
    return;
  }

  if (await handleApi(req, res)) {
    return;
  }

  if (process.env.NODE_ENV === "development") {
    res.writeHead(302, { Location: `${devServerUrl}${req.url}` });
    res.end();
    return;
  }

  const relativePath = req.url === "/" ? "index.html" : req.url.slice(1);
  const filePath = path.join(distDir, relativePath);

  try {
    const content = await readFile(filePath);
    res.writeHead(200, { "Content-Type": resolveContentType(filePath) });
    res.end(content);
  } catch {
    try {
      const indexContent = await readFile(path.join(distDir, "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(indexContent);
    } catch {
      sendText(res, "Frontend build not found.", 500);
    }
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`WiFi survey server running at http://127.0.0.1:${port}`);
});
