import { attachResizeHandle } from "./resizeHandle.js";

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

// Downscales (if needed) and re-encodes as JPEG, so a photo or screenshot
// doesn't bloat the sheet's JSON — this app stores images embedded as data
// URIs (not as separate Drive files), so file size directly affects
// autosave payload size and, on the local-storage backend, the ~5-10MB
// browser quota shared across every sheet.
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not read that as an image."));
      img.onload = () => {
        let { width, height } = img;
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          if (width >= height) {
            height = Math.round((height * MAX_DIMENSION) / width);
            width = MAX_DIMENSION;
          } else {
            width = Math.round((width * MAX_DIMENSION) / height);
            height = MAX_DIMENSION;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", JPEG_QUALITY));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Builds an image block: click-or-paste-to-upload when empty, the image
// (plus a Replace option) once one's set. onChange(src) fires after a
// successful upload. readOnly (formal view) renders just the image, no
// upload/replace/paste affordances at all.
export function createImageBlock(block, onChange, { readOnly = false } = {}) {
  const wrap = document.createElement("div");
  wrap.className = "image-block";

  let fileInput = null;
  let statusEl = null;

  if (!readOnly) {
    fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.hidden = true;
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      fileInput.value = "";
      if (file) await handleFile(file);
    });

    wrap.tabIndex = 0;
    wrap.addEventListener("click", () => {
      wrap.focus();
      if (!block.src) fileInput.click();
    });
    wrap.addEventListener("paste", async (evt) => {
      const item = [...(evt.clipboardData?.items || [])].find((i) =>
        i.type.startsWith("image/")
      );
      if (!item) return;
      evt.preventDefault();
      const file = item.getAsFile();
      if (file) await handleFile(file);
    });
  }

  async function handleFile(file) {
    setStatus("Processing image...");
    try {
      block.src = await compressImage(file);
      onChange();
      render();
    } catch (err) {
      setStatus(err.message || "Couldn't load that image.");
    }
  }

  function setStatus(text) {
    if (!statusEl) return;
    statusEl.textContent = text;
  }

  function render() {
    wrap.innerHTML = "";

    if (block.src) {
      const imgWrap = document.createElement("div");
      imgWrap.className = "image-block-imgwrap";
      if (block.width) imgWrap.style.width = `${block.width}px`;

      const img = document.createElement("img");
      img.src = block.src;
      img.alt = "";
      img.className = "image-block-img";
      imgWrap.appendChild(img);
      wrap.appendChild(imgWrap);

      if (!readOnly) {
        attachResizeHandle(imgWrap, {
          axis: "horizontal",
          minWidth: 100,
          maxWidth: 624, // matches #blocks-container's print-page-width cap
          onResize: (width) => {
            imgWrap.style.width = `${width}px`;
          },
          onResizeEnd: (width) => {
            block.width = width;
            onChange();
          },
        });

        const replaceBtn = document.createElement("button");
        replaceBtn.type = "button";
        replaceBtn.className = "image-block-replace";
        replaceBtn.textContent = "Replace image";
        replaceBtn.addEventListener("click", (evt) => {
          evt.stopPropagation();
          fileInput.click();
        });
        wrap.appendChild(replaceBtn);
      }
    } else if (!readOnly) {
      const prompt = document.createElement("div");
      prompt.className = "image-block-prompt";
      prompt.textContent = "Click to choose an image, or paste one (Ctrl+V)";
      wrap.appendChild(prompt);
    }

    statusEl = document.createElement("div");
    statusEl.className = "image-block-status";
    wrap.appendChild(statusEl);

    if (fileInput) wrap.appendChild(fileInput);
  }

  render();
  return wrap;
}
