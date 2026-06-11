const downloadButton = document.getElementById("downloadButton");
const includeCssImages = document.getElementById("includeCssImages");
const minSize = document.getElementById("minSize");
const progress = document.getElementById("progress");
const statusText = document.getElementById("status");
const pageTitle = document.getElementById("pageTitle");

function setStatus(message) {
  statusText.textContent = message;
}

function setBusy(isBusy) {
  downloadButton.disabled = isBusy;
  includeCssImages.disabled = isBusy;
  minSize.disabled = isBusy;
  progress.hidden = !isBusy;
  if (!isBusy) progress.value = 0;
}

function safeFilename(value, fallback = "page-images") {
  const normalized = (value || fallback)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);

  return normalized || fallback;
}

function extensionFromContentType(contentType) {
  const mime = contentType.split(";")[0].trim().toLowerCase();
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/svg+xml": "svg",
    "image/avif": "avif",
    "image/bmp": "bmp",
    "image/x-icon": "ico"
  };

  return map[mime] || "";
}

function extensionFromUrl(url) {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function filenameFromUrl(url, index, contentType) {
  let basename = "";

  try {
    const parsed = new URL(url);
    basename = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || "");
  } catch {
    basename = "";
  }

  basename = safeFilename(basename, `image-${String(index).padStart(3, "0")}`);

  if (!/\.[a-z0-9]{2,5}$/i.test(basename)) {
    const extension = extensionFromContentType(contentType) || extensionFromUrl(url) || "bin";
    basename = `${basename}.${extension}`;
  }

  return basename;
}

function uniqueFilename(name, usedNames) {
  const normalized = name || "image.bin";
  if (!usedNames.has(normalized)) {
    usedNames.add(normalized);
    return normalized;
  }

  const dot = normalized.lastIndexOf(".");
  const base = dot > 0 ? normalized.slice(0, dot) : normalized;
  const extension = dot > 0 ? normalized.slice(dot) : "";
  let counter = 2;

  while (usedNames.has(`${base}-${counter}${extension}`)) {
    counter += 1;
  }

  const unique = `${base}-${counter}${extension}`;
  usedNames.add(unique);
  return unique;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function collectImages(tab) {
  const response = await chrome.tabs.sendMessage(tab.id, {
    type: "COLLECT_PAGE_IMAGES",
    options: {
      includeCssImages: includeCssImages.checked,
      minSize: Number(minSize.value || 0)
    }
  });

  return response;
}

async function fetchImage(image, index) {
  const response = await fetch(image.url, {
    credentials: "include",
    cache: "force-cache"
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const contentType = response.headers.get("content-type") || blob.type || "";

  return {
    blob,
    contentType,
    filename: filenameFromUrl(image.url, index, contentType)
  };
}

async function downloadZip() {
  setBusy(true);
  setStatus("画像を検索しています...");

  try {
    const tab = await getActiveTab();
    if (!tab?.id) {
      throw new Error("現在のタブを取得できませんでした。");
    }

    pageTitle.textContent = tab.title || "現在のページ";

    const page = await collectImages(tab);
    const images = page?.images || [];

    if (images.length === 0) {
      setStatus("画像が見つかりませんでした。");
      return;
    }

    const entries = [];
    const usedNames = new Set();
    const failures = [];

    progress.max = images.length;
    progress.value = 0;
    setStatus(`${images.length}件の画像を取得しています...`);

    for (const [index, image] of images.entries()) {
      try {
        const downloaded = await fetchImage(image, index + 1);
        entries.push({
          name: uniqueFilename(`images/${downloaded.filename}`, usedNames),
          data: downloaded.blob
        });
      } catch (error) {
        failures.push(`${image.url} (${error.message})`);
      } finally {
        progress.value = index + 1;
      }
    }

    if (entries.length === 0) {
      setStatus(`画像を取得できませんでした。\n${failures.slice(0, 2).join("\n")}`);
      return;
    }

    const manifest = {
      pageTitle: page.title || tab.title || "",
      pageUrl: page.url || tab.url || "",
      downloadedAt: new Date().toISOString(),
      imageCount: entries.length,
      failedCount: failures.length,
      failures
    };

    entries.push({
      name: "manifest.json",
      data: new Blob([JSON.stringify(manifest, null, 2)], { type: "application/json" })
    });

    setStatus("ZIPを作成しています...");
    const zipBlob = await window.SimpleZip.createZip(entries);
    const objectUrl = URL.createObjectURL(zipBlob);
    const zipName = `${safeFilename(page.title || tab.title || "page-images")}.zip`;

    await chrome.downloads.download({
      url: objectUrl,
      filename: zipName,
      saveAs: true
    });

    setStatus(`完了: ${entries.length - 1}件をZIPに保存しました。${failures.length ? `\n失敗: ${failures.length}件` : ""}`);
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  } catch (error) {
    setStatus(error.message || "処理中にエラーが発生しました。");
  } finally {
    setBusy(false);
  }
}

downloadButton.addEventListener("click", downloadZip);

getActiveTab()
  .then((tab) => {
    pageTitle.textContent = tab?.title || "現在のページ";
  })
  .catch(() => {
    pageTitle.textContent = "現在のページ";
  });
