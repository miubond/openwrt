/**
 * Thin client for the independent MP716 upgrade CGI.
 * It does not decide that a device was upgraded. Success is only the worker
 * status SUCCESS after boot verification.
 */
export function createFirmwareUpgradeAdapter(options) {
  const base = String(options.baseUrl || "").replace(/\/$/, "");
  const paths = {
    info: "/cgi-bin/mp716-upgrade.cgi/info",
    upload: "/cgi-bin/mp716-upgrade.cgi/upload",
    verify: "/cgi-bin/mp716-upgrade.cgi/verify",
    start: "/cgi-bin/mp716-upgrade.cgi/start",
    status: "/cgi-bin/mp716-upgrade.cgi/status",
    history: "/cgi-bin/mp716-upgrade.cgi/history",
  };

  function url(name) {
    return base + paths[name];
  }

  async function readJson(response) {
    const body = await response.json();
    return { httpStatus: response.status, ...body };
  }

  async function getFirmwareInfo() {
    return readJson(await fetch(url("info"), { credentials: "include", cache: "no-store" }));
  }

  function uploadFirmware(file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url("upload"));
      xhr.withCredentials = true;
      xhr.setRequestHeader("Content-Type", "application/octet-stream");
      xhr.setRequestHeader("X-MP716-Upgrade", "1");
      xhr.upload.onprogress = (event) => {
        if (onProgress && event.lengthComputable) onProgress(event.loaded, event.total);
      };
      xhr.onload = () => {
        try {
          resolve({ httpStatus: xhr.status, ...JSON.parse(xhr.responseText) });
        } catch (error) {
          reject(error);
        }
      };
      xhr.onerror = () => reject(new Error("upload failed"));
      xhr.send(file);
    });
  }

  async function verifyFirmware() {
    return readJson(await fetch(url("verify"), { method: "POST", credentials: "include", headers: { "X-MP716-Upgrade": "1" } }));
  }

  async function startUpgrade() {
    return readJson(await fetch(url("start"), { method: "POST", credentials: "include", headers: { "X-MP716-Upgrade": "1" } }));
  }

  async function getUpgradeStatus() {
    return readJson(await fetch(url("status"), { credentials: "include", cache: "no-store" }));
  }

  async function getUpgradeHistory() {
    return readJson(await fetch(url("history"), { credentials: "include", cache: "no-store" }));
  }

  function isUpgradeSuccessful(status) {
    return Boolean(status && status.state === "SUCCESS" && status.upgraded === true && status.flash_write === false);
  }

  return {
    getFirmwareInfo,
    uploadFirmware,
    verifyFirmware,
    startUpgrade,
    getUpgradeStatus,
    getUpgradeHistory,
    isUpgradeSuccessful,
    riskNotice: "防变砖是严格校验、限制写入范围和人工恢复，不是失败后自动回滚。当前只做签名、状态机和 Fake MTD。上传完成不是升级成功。",
  };
}
