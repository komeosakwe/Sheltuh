// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coverCrop, ImageError, MAX_COVER_UPLOAD_BYTES, prepareCoverImage } from "@/lib/image";

describe("coverCrop", () => {
  it("takes the centre 7:2 strip first, then caps the width at 2800", () => {
    // A tall phone photo keeps its whole width: 3000 × 4000 → a 3000 × 857 strip → 2800 × 800.
    expect(coverCrop(3000, 4000)).toEqual({
      source: { x: 0, y: 1572, width: 3000, height: 857 },
      width: 2800,
      height: 800,
    });
  });

  it("crops the sides of a wide panorama to 7:2", () => {
    expect(coverCrop(8000, 1000)).toEqual({
      source: { x: 2250, y: 0, width: 3500, height: 1000 },
      width: 2800,
      height: 800,
    });
  });

  it("leaves a small image its size (the server enlarges it)", () => {
    expect(coverCrop(1200, 800)).toEqual({ source: { x: 0, y: 229, width: 1200, height: 343 }, width: 1200, height: 343 });
    expect(coverCrop(2240, 640)).toEqual({ source: { x: 0, y: 0, width: 2240, height: 640 }, width: 2240, height: 640 });
  });
});

describe("prepareCoverImage", () => {
  const drawImage = vi.fn();
  let blobSize = 1000;
  let decodable = true;
  let bitmap = { width: 3000, height: 4000, close: vi.fn() };

  beforeEach(() => {
    drawImage.mockReset();
    blobSize = 1000;
    decodable = true;
    bitmap = { width: 3000, height: 4000, close: vi.fn() };
    vi.stubGlobal("createImageBitmap", async () => {
      if (!decodable) throw new Error("can't decode");
      return bitmap;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
      callback(new Blob([new Uint8Array(blobSize)], { type: "image/jpeg" }));
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const file = (type = "image/jpeg", size = 10) => new File([new Uint8Array(size)], "photo", { type });

  it("refuses anything but JPEG, PNG or WebP", async () => {
    await expect(prepareCoverImage(file("image/gif"))).rejects.toThrow(ImageError);
  });

  it("draws the centre 7:2 strip at most 2800 wide, as a JPEG, and reports its width", async () => {
    const prepared = await prepareCoverImage(file());
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 1572, 3000, 857, 0, 0, 2800, 800);
    expect(prepared.width).toBe(2800);
    expect(prepared.image.type).toBe("image/jpeg");
    expect(bitmap.close).toHaveBeenCalled();
  });

  it("reports a narrow crop's width, for the enlarged-cover warning", async () => {
    bitmap = { width: 1600, height: 1200, close: vi.fn() };
    expect((await prepareCoverImage(file())).width).toBe(1600);
  });

  it("refuses a result over 4 MB", async () => {
    blobSize = MAX_COVER_UPLOAD_BYTES + 1;
    await expect(prepareCoverImage(file())).rejects.toThrow("over 4 MB");
  });

  it("sends a file the browser can't read as it is (width unknown) when within 4 MB, and refuses it over", async () => {
    decodable = false;
    const small = file("image/webp", 100);
    expect(await prepareCoverImage(small)).toEqual({ image: small, width: null });
    await expect(prepareCoverImage(file("image/webp", MAX_COVER_UPLOAD_BYTES + 1))).rejects.toThrow("over 4 MB");
  });
});
