import { PDFJS_LIB_SOURCE } from './pdfJsLib';
import { PDFJS_WORKER_SOURCE } from './pdfJsWorker';

/**
 * HTML shell hosted inside PdfViewerScreen's WebView. Renders the report by running PDF.js
 * (bundled inline — see pdfJsLib.ts) against the raw PDF bytes and drawing every page to its own
 * <canvas>, rather than relying on any native/OS PDF viewer being present.
 *
 * This is the third rendering approach tried here, after two dead ends confirmed on-device:
 *   1. A raw file:// source — Android WebViews disable file:// access by default, and enabling
 *      every allowFileAccess flag still failed with ERR_ACCESS_DENIED on-device.
 *   2. A content:// source (via FileSystem.getContentUriAsync) — also ERR_ACCESS_DENIED; this
 *      react-native-webview version hardcodes `settings.allowContentAccess = false` in
 *      RNCWebViewManagerImpl.kt with no exposed prop to override it at all.
 *   3. A base64 data: URI carrying the whole PDF — sidesteps both access checks, but this app's
 *      PDFs already embed several base64-encoded photos/signatures inside their own HTML source;
 *      reading the finished PDF back and re-encoding the WHOLE FILE as base64 a SECOND time to
 *      build the data: URI produces a multi-MB string for any photo-heavy record, which silently
 *      stalls past Android WebView's practical data: URI length ceiling — no onError, it just
 *      never finishes loading.
 *   4. A Blob URL built in-page from bytes delivered over postMessage — sidesteps both access
 *      checks AND the size ceiling (postMessage isn't length-limited the way a URI is), and this
 *      confirmed working end-to-end (WebView reported success, no errors) — but nothing was
 *      actually visible: this device's WebView build has no inline PDF-rendering plugin wired up
 *      for an iframe pointed at a blob: URL with an application/pdf MIME type. Chromium's WebView
 *      package doesn't universally ship that the way desktop Chrome does.
 * PDF.js sidesteps all of the above by not depending on any browser/OS PDF capability at all — it
 * parses the PDF bytes itself in pure JS and paints pages to <canvas>, which every WebView
 * supports regardless of what PDF plugins happen to be installed.
 *
 * The PDF bytes still arrive over postMessage (not embedded in the initial HTML/URL) for the same
 * size reasons as approach 4 above.
 *
 * This pdfjs-dist version requires a real GlobalWorkerOptions.workerSrc — it throws
 * ("No GlobalWorkerOptions.workerSrc specified") rather than falling back to a main-thread "fake
 * worker" the way older versions did. Same problem as the PDF itself: there's no file to point a
 * worker script at inside a source={{html}} WebView with no base URL. Same fix, too — the worker's
 * source (pdfJsWorker.ts) is embedded as inert text (a <script type="text/plain"> block, never
 * executed directly), then turned into a Blob and instantiated from THAT blob: URL — Workers can
 * be constructed from blob: URLs, a standard technique for bundling one with no separate file, and
 * blob: URLs aren't subject to the file:///content:// restrictions that ruled out every other
 * approach here.
 */
export const PDF_VIEWER_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=5, user-scalable=yes" />
  <style>
    html, body { margin: 0; padding: 0; width: 100%; background: #525659; }
    #pages { width: 100%; padding: 8px 0; box-sizing: border-box; }
    canvas { display: block; margin: 0 auto 12px; background: #fff; box-shadow: 0 1px 4px rgba(0,0,0,0.4); }
  </style>
</head>
<body>
<div id="pages"></div>
<script id="pdfjs-worker-src" type="text/plain">${PDFJS_WORKER_SOURCE}</script>
<script>${PDFJS_LIB_SOURCE}</script>
<script>
  var workerBlob = new Blob(
    [document.getElementById('pdfjs-worker-src').textContent],
    { type: 'application/javascript' }
  );
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

  function post(message) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(message);
  }

  function base64ToBytes(base64) {
    var byteChars = atob(base64);
    var bytes = new Uint8Array(byteChars.length);
    for (var i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    return bytes;
  }

  async function renderPdf(base64) {
    try {
      var bytes = base64ToBytes(base64);
      var pdf = await window.pdfjsLib.getDocument({ data: bytes }).promise;
      var container = document.getElementById('pages');
      container.innerHTML = '';
      var containerWidth = document.documentElement.clientWidth || window.innerWidth;
      // Rendering the canvas's pixel buffer at CSS/logical width (then stretching it to fill
      // that same width via canvas.style) is exactly what made every page come out blurry on any
      // phone with a devicePixelRatio above 1 — which is effectively all of them. Multiplying the
      // render scale by devicePixelRatio draws at the screen's actual physical pixel density; the
      // CSS width/height are set separately so the on-screen SIZE is unchanged, only the sharpness.
      //
      // Native screen density alone is only enough to look sharp at 1x — the viewport's own
      // pinch-to-zoom (maximum-scale=5 below) then stretches that same raster past its native
      // resolution just like zooming into any photo beyond its pixel count, so a page rendered
      // at exactly the screen's density still goes soft the moment someone actually uses the
      // "Pinch to zoom" hint this screen shows. ZOOM_HEADROOM renders extra resolution up front —
      // more than the screen needs at 1x — so zooming in stays legible instead of degrading
      // immediately; kept modest since it costs canvas memory roughly with its square.
      var dpr = window.devicePixelRatio || 1;
      var ZOOM_HEADROOM = 2.5;
      var renderScale = dpr * ZOOM_HEADROOM;
      var pagesFailed = 0;

      for (var pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        try {
          var page = await pdf.getPage(pageNum);
          var unscaledViewport = page.getViewport({ scale: 1 });
          var cssScale = containerWidth / unscaledViewport.width;
          var renderViewport = page.getViewport({ scale: cssScale * renderScale });

          var canvas = document.createElement('canvas');
          canvas.width = renderViewport.width;
          canvas.height = renderViewport.height;
          canvas.style.width = containerWidth + 'px';
          canvas.style.height = (renderViewport.height / renderScale) + 'px';
          container.appendChild(canvas);

          var ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport: renderViewport }).promise;
        } catch (pageError) {
          // One page's content stream tripping up PDF.js shouldn't take down every other page —
          // show a plain placeholder for just this page and keep going.
          pagesFailed++;
          var errorBox = document.createElement('div');
          errorBox.style.cssText = 'width:' + containerWidth + 'px;padding:24px 12px;margin:0 auto 12px;' +
            'background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.4);box-sizing:border-box;' +
            'font-family:sans-serif;font-size:13px;color:#5B6B73;text-align:center;';
          errorBox.textContent = 'Page ' + pageNum + ' could not be displayed.';
          container.appendChild(errorBox);
        }
      }

      if (pagesFailed > 0 && pagesFailed === pdf.numPages) {
        post('error:Could not render any page of this report');
      } else {
        post('rendered');
      }
    } catch (e) {
      post('error:' + (e && e.message ? e.message : String(e)));
    }
  }

  function onNativeMessage(event) {
    void renderPdf(event.data);
  }

  // react-native-webview delivers postMessage on 'document' on Android and 'window' on iOS —
  // listening on both is the documented cross-platform workaround.
  document.addEventListener('message', onNativeMessage);
  window.addEventListener('message', onNativeMessage);

  post('ready');
</script>
</body>
</html>
`;
