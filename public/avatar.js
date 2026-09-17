(() => {
  "use strict";

  const SIZE = 192;
  const MAX_DATA_URL = 100_000;
  const PHOTO_EXT = /\.(jpe?g|png|webp|gif|bmp|heic|heif)$/i;

  function isPhotoFile(file) {
    if (!file) return false;
    const type = String(file.type || "").toLowerCase();
    if (type === "image/svg+xml" || type === "image/svg") return false;
    if (type.startsWith("image/")) return true;
    return PHOTO_EXT.test(file.name || "");
  }

  function cropDraw(ctx, source, size) {
    const width = source.width;
    const height = source.height;
    const side = Math.min(width, height);
    const sx = (width - side) / 2;
    const sy = (height - side) / 2;
    ctx.fillStyle = "#112d63";
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  }

  function encodeJpeg(canvas) {
    let quality = 0.82;
    let data = canvas.toDataURL("image/jpeg", quality);
    while (data.length > MAX_DATA_URL && quality > 0.45) {
      quality -= 0.08;
      data = canvas.toDataURL("image/jpeg", quality);
    }
    if (!/^data:image\/jpeg;base64,/i.test(data) || data.length > MAX_DATA_URL) {
      throw new Error("Deze foto kon niet klein genoeg worden gemaakt.");
    }
    return data;
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Deze foto kon niet worden gelezen."));
      };
      img.src = url;
    });
  }

  async function decodePhoto(file) {
    if (typeof createImageBitmap === "function") {
      try {
        return await createImageBitmap(file, { imageOrientation: "from-image" });
      } catch {
        try {
          return await createImageBitmap(file);
        } catch {
          /* Image() can still read JPEG/PNG/WebP/GIF */
        }
      }
    }
    return loadImage(file);
  }

  async function compress(file) {
    if (!isPhotoFile(file)) {
      throw new Error("Kies een JPG, PNG, WebP, GIF of HEIC-foto.");
    }
    const source = await decodePhoto(file);
    try {
      if (!source.width || !source.height) {
        throw new Error("Deze foto kon niet worden gelezen.");
      }
      const canvas = document.createElement("canvas");
      canvas.width = SIZE;
      canvas.height = SIZE;
      const ctx = canvas.getContext("2d", { alpha: false });
      cropDraw(ctx, source, SIZE);
      return encodeJpeg(canvas);
    } finally {
      if (source && typeof source.close === "function") source.close();
    }
  }

  window.HagroAvatar = { compress, isPhotoFile };
})();
