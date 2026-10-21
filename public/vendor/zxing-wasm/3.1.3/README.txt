zxing_reader.wasm: the QR decoder for the door scanner's fallback path
(/dashboard/[eventId]/check-in, lib/check-in/detector.ts), used where the
browser has no native BarcodeDetector (iPhone Safari, Firefox, desktop).

Self-hosted so the scanner makes no third-party request (the library's
default is the jsDelivr CDN). Served with an immutable cache header
(next.config.ts); the version is in the path, so an upgrade is a new
folder. The service worker doesn't intercept it (public/sw.js: not an
image, not /_next/static), so it is never stored in a service-worker cache.

Source: npm zxing-wasm@3.1.3, dist/reader/zxing_reader.wasm, unmodified.
SHA-256: 2ebda08a93eea3efcd8399cda6b276e6a0b1de4fec60b4d8988a047de4c6d1ba
(must equal ZXING_WASM_SHA256 exported by barcode-detector; checked by
tests/check-in-vendor.test.ts). Loaded through the npm package
barcode-detector@3.2.2 (pinned exactly in package.json), which bundles the
zxing-wasm 3.1.3 JavaScript glue.

To upgrade: bump barcode-detector (exact version), copy
node_modules/zxing-wasm/dist/reader/zxing_reader.wasm into a new
public/vendor/zxing-wasm/<ZXING_WASM_VERSION>/ folder with these notices,
update the SHA-256 above, and delete the old folder.

Licences (all permit redistribution with these notices):
- barcode-detector: MIT, Copyright (c) 2023 Ze-Zheng Wu
  (LICENSE-barcode-detector.txt)
- zxing-wasm JavaScript and build: MIT, Copyright (c) 2023 Ze-Zheng Wu
  (LICENSE-zxing-wasm.txt)
- zxing-cpp (the C++ decoder compiled into the .wasm), commit
  a17fd9dc65d6aa0dd2f660fdfca7a6a6613d938f: Apache License 2.0
  (LICENSE-zxing-cpp.txt). zxing-cpp publishes no NOTICE file.
- zxing-wasm's C++ bindings (src/cpp/ZXingWasm.cpp): Apache License 2.0,
  Copyright 2016 Nu-book Inc., 2023 Axel Waggershauser, 2023 Ze-Zheng Wu
  (LICENSE-zxing-wasm-cpp.txt)
The reader build contains no zint code (zint is only in the writer builds).
