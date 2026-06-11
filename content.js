function parseSrcset(srcset) {
  if (!srcset) return [];

  return srcset
    .split(",")
    .map((part) => part.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function toAbsoluteUrl(value) {
  try {
    return new URL(value, document.baseURI).href;
  } catch {
    return null;
  }
}

function extractCssImageUrls(value) {
  const urls = [];
  const regex = /url\((?:"([^"]+)"|'([^']+)'|([^'")]+))\)/g;
  let match;

  while ((match = regex.exec(value)) !== null) {
    const raw = (match[1] || match[2] || match[3] || "").trim();
    if (raw && !raw.startsWith("data:")) {
      urls.push(raw);
    }
  }

  return urls;
}

function collectImages(options = {}) {
  const includeCssImages = options.includeCssImages !== false;
  const minSize = Number(options.minSize || 0);
  const seen = new Set();
  const images = [];

  function addImage(url, source, width = 0, height = 0, alt = "") {
    const absoluteUrl = toAbsoluteUrl(url);
    if (!absoluteUrl || seen.has(absoluteUrl)) return;
    if (minSize > 0 && Math.max(width, height) > 0 && Math.max(width, height) < minSize) return;

    seen.add(absoluteUrl);
    images.push({
      url: absoluteUrl,
      source,
      width,
      height,
      alt
    });
  }

  for (const img of document.images) {
    addImage(img.currentSrc || img.src, "img", img.naturalWidth, img.naturalHeight, img.alt);

    for (const url of parseSrcset(img.srcset)) {
      addImage(url, "img-srcset", img.naturalWidth, img.naturalHeight, img.alt);
    }
  }

  for (const source of document.querySelectorAll("source[srcset]")) {
    for (const url of parseSrcset(source.getAttribute("srcset"))) {
      addImage(url, "source-srcset");
    }
  }

  for (const element of document.querySelectorAll("svg image[href], svg image[xlink\\:href]")) {
    addImage(element.getAttribute("href") || element.getAttribute("xlink:href"), "svg-image");
  }

  if (includeCssImages) {
    for (const element of document.querySelectorAll("*")) {
      const style = getComputedStyle(element);
      const candidates = [
        style.backgroundImage,
        style.borderImageSource,
        style.listStyleImage,
        style.cursor
      ];

      for (const candidate of candidates) {
        for (const url of extractCssImageUrls(candidate)) {
          addImage(url, "css-background");
        }
      }
    }
  }

  return {
    title: document.title,
    url: location.href,
    images
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "COLLECT_PAGE_IMAGES") return false;

  sendResponse(collectImages(message.options));
  return false;
});
