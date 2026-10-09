// PDF.js's viewer component reads the library from globalThis.pdfjsLib, so
// this module must be imported before 'pdfjs-dist/web/pdf_viewer.mjs'.
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
(globalThis as any).pdfjsLib = pdfjs;

export { pdfjs };
